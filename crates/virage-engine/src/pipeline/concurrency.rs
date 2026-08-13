//! Resource-aware worker-count strategy (ADR-057, supersedes ADR-054's static
//! `available_parallelism()`-only default).
//!
//! `ADR-054` claimed "bounded channels prevent OOM" — true for how much work is *queued*, false
//! for how much memory each in-flight worker's embedding batch costs. A shared host's core count
//! says nothing about whether there's room for another worker; free memory does. `ConcurrencyStrategy`
//! is the pluggable signal the coordinator (`pipeline/coordinator.rs`) polls between items to
//! decide how many workers should be active right now.

use std::sync::Arc;

/// How many workers should be active, sampled once at startup and re-queried periodically
/// during the run (see `pipeline/coordinator.rs`'s worker self-check loop).
pub trait ConcurrencyStrategy: Send + Sync {
    /// Worker count to start the run with.
    fn initial_workers(&self) -> usize;
    /// Worker count that should be active right now. Called periodically by each worker
    /// between items — never mid-operation — so the coordinator never aborts in-flight work.
    fn current_workers(&self) -> usize;
}

// ─── FixedWorkers ───────────────────────────────────────────────────────────

/// Today's behavior, kept as an explicit opt-out: a constant worker count, derived from
/// `--workers N` or `std::thread::available_parallelism()`. Never scales down.
pub struct FixedWorkers {
    count: usize,
}

impl FixedWorkers {
    pub fn new(count: usize) -> Self {
        Self {
            count: count.max(1),
        }
    }
}

impl ConcurrencyStrategy for FixedWorkers {
    fn initial_workers(&self) -> usize {
        self.count
    }
    fn current_workers(&self) -> usize {
        self.count
    }
}

// ─── MemorySource — injectable so RamSampling is unit-testable without real sysinfo ────────

/// Reports free/available system memory, in bytes. Abstracted so tests can inject synthetic
/// values instead of depending on the real host's memory state (non-deterministic, and this
/// box's incident conditions — <500MB free — aren't reproducible in CI without a cgroup).
pub trait MemorySource: Send + Sync {
    fn available_bytes(&self) -> u64;
}

/// Real system memory via `sysinfo`. Refreshes only the memory counters on each call — cheap
/// relative to a full `System::refresh_all()`.
pub struct SysinfoMemorySource {
    sys: std::sync::Mutex<sysinfo::System>,
}

impl SysinfoMemorySource {
    pub fn new() -> Self {
        let mut sys = sysinfo::System::new();
        sys.refresh_memory();
        Self {
            sys: std::sync::Mutex::new(sys),
        }
    }
}

impl Default for SysinfoMemorySource {
    fn default() -> Self {
        Self::new()
    }
}

impl MemorySource for SysinfoMemorySource {
    fn available_bytes(&self) -> u64 {
        let mut sys = match self.sys.lock() {
            Ok(g) => g,
            Err(e) => e.into_inner(),
        };
        sys.refresh_memory();
        sys.available_memory()
    }
}

// ─── RamSampling ────────────────────────────────────────────────────────────

/// Threshold policy, in MB free:
///
/// - below `low_water_mb` free → 1 worker (fully sequential).
/// - at/above `high_water_mb` free → up to `max_workers`.
/// - linear step scale between the two watermarks.
///
/// `RamSampling::new()` (the production path — see `default_watermarks_mb`) scales these
/// proportionally to the host's *total* memory rather than using fixed absolute numbers: a
/// review of the original 512MB/1536MB constants (chosen against this box's specific 3.7GB-RAM
/// incident — see `docs/ai/facts/virage-indexing-oom-incident.md`, virage-ee) found they don't
/// generalize — a small 1GB container would sit permanently pinned at 1 worker even under a
/// trivial workload, and a large 64GB CI runner would never throttle even under a genuinely
/// oversized batch. `RamSampling::with_source` (used directly by tests) keeps fixed 512/1536
/// defaults for determinism; only the real `sysinfo`-backed constructor derives from actual host
/// size. `with_watermarks` still allows an explicit operator override either way.
pub struct RamSampling {
    source: Arc<dyn MemorySource>,
    max_workers: usize,
    low_water_mb: u64,
    high_water_mb: u64,
}

const MB: u64 = 1024 * 1024;

/// Derives `(low_water_mb, high_water_mb)` from a host's *total* memory, so the watermark
/// policy scales with the box RamSampling is actually running on instead of one incident host's
/// specific size. 15%/50% of total were chosen so the low-water floor still leaves meaningful
/// headroom below it (matches this box's 3.7GB total → ~555MB low-water, close to the original
/// hand-picked 512MB) while the high-water mark leaves half of total memory as the point past
/// which scaling to max workers is considered safe. Floors (128MB low / low+128MB high) keep the
/// policy sane on very small hosts instead of collapsing toward 0.
fn default_watermarks_mb(total_mb: u64) -> (u64, u64) {
    let low = ((total_mb as f64) * 0.15).round() as u64;
    let high = ((total_mb as f64) * 0.5).round() as u64;
    let low = low.max(128);
    let high = high.max(low + 128);
    (low, high)
}

impl RamSampling {
    /// Production entry point: samples the host's actual total memory (via `sysinfo`) to derive
    /// watermarks proportional to this host, rather than the fixed defaults `with_source` uses.
    pub fn new(max_workers: usize) -> Self {
        let mut sys = sysinfo::System::new();
        sys.refresh_memory();
        let total_mb = (sys.total_memory() / MB).max(1);
        let (low, high) = default_watermarks_mb(total_mb);
        Self::with_source(Arc::new(SysinfoMemorySource::new()), max_workers)
            .with_watermarks(low, high)
    }

    pub fn with_source(source: Arc<dyn MemorySource>, max_workers: usize) -> Self {
        Self {
            source,
            max_workers: max_workers.max(1),
            low_water_mb: 512,
            high_water_mb: 1536,
        }
    }

    /// Override the default watermarks (mainly for tests / operator tuning).
    pub fn with_watermarks(mut self, low_water_mb: u64, high_water_mb: u64) -> Self {
        self.low_water_mb = low_water_mb;
        self.high_water_mb = high_water_mb.max(low_water_mb + 1);
        self
    }

    fn workers_for(&self, available_mb: u64) -> usize {
        if available_mb <= self.low_water_mb {
            return 1;
        }
        if available_mb >= self.high_water_mb {
            return self.max_workers;
        }
        // Linear step scale between the two watermarks.
        let span = (self.high_water_mb - self.low_water_mb).max(1);
        let frac = (available_mb - self.low_water_mb) as f64 / span as f64;
        let scaled = 1.0 + frac * (self.max_workers.saturating_sub(1)) as f64;
        (scaled.round() as usize).clamp(1, self.max_workers)
    }
}

impl ConcurrencyStrategy for RamSampling {
    fn initial_workers(&self) -> usize {
        self.current_workers()
    }

    fn current_workers(&self) -> usize {
        let available_mb = self.source.available_bytes() / MB;
        self.workers_for(available_mb)
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    struct FakeMemorySource {
        bytes: AtomicU64,
    }

    impl FakeMemorySource {
        fn new(mb: u64) -> Arc<Self> {
            Arc::new(Self {
                bytes: AtomicU64::new(mb * MB),
            })
        }
        fn set_mb(&self, mb: u64) {
            self.bytes.store(mb * MB, Ordering::Relaxed);
        }
    }

    impl MemorySource for FakeMemorySource {
        fn available_bytes(&self) -> u64 {
            self.bytes.load(Ordering::Relaxed)
        }
    }

    #[test]
    fn fixed_workers_never_changes() {
        let s = FixedWorkers::new(8);
        assert_eq!(s.initial_workers(), 8);
        assert_eq!(s.current_workers(), 8);
    }

    #[test]
    fn fixed_workers_floors_at_one() {
        let s = FixedWorkers::new(0);
        assert_eq!(s.initial_workers(), 1);
    }

    #[test]
    fn ram_sampling_low_memory_forces_sequential() {
        let mem = FakeMemorySource::new(200); // below default 512MB low-water
        let strategy = RamSampling::with_source(mem, 8);
        assert_eq!(strategy.current_workers(), 1);
    }

    #[test]
    fn ram_sampling_ample_memory_uses_max_workers() {
        let mem = FakeMemorySource::new(4096); // above default 1536MB high-water
        let strategy = RamSampling::with_source(mem, 8);
        assert_eq!(strategy.current_workers(), 8);
    }

    #[test]
    fn ram_sampling_scales_between_watermarks() {
        let mem = FakeMemorySource::new(1024); // midpoint of 512..1536
        let strategy = RamSampling::with_source(mem, 8);
        let n = strategy.current_workers();
        assert!(n > 1 && n < 8, "expected mid-range worker count, got {n}");
    }

    #[test]
    fn ram_sampling_reacts_to_live_changes() {
        let mem = FakeMemorySource::new(4096);
        let strategy = RamSampling::with_source(mem.clone(), 8);
        assert_eq!(strategy.current_workers(), 8);
        mem.set_mb(100);
        assert_eq!(strategy.current_workers(), 1);
    }

    #[test]
    fn default_watermarks_scale_with_host_total_memory() {
        // Roughly reproduces the incident host (3.7GB total) → close to the original
        // hand-picked 512MB/1536MB constants.
        let (low, high) = default_watermarks_mb(3700);
        assert_eq!(low, 555);
        assert_eq!(high, 1850);

        // A small 1GB container doesn't collapse to a near-zero low-water floor.
        let (low_small, high_small) = default_watermarks_mb(1024);
        assert_eq!(low_small, 154);
        assert!(high_small > low_small);

        // A large 64GB host scales proportionally rather than reusing the small-host absolutes.
        let (low_large, high_large) = default_watermarks_mb(65536);
        assert_eq!(low_large, 9830);
        assert_eq!(high_large, 32768);
    }

    #[test]
    fn ram_sampling_respects_custom_watermarks() {
        let mem = FakeMemorySource::new(300);
        let strategy = RamSampling::with_source(mem, 4).with_watermarks(100, 200);
        // 300MB is above the custom 200MB high-water → max workers.
        assert_eq!(strategy.current_workers(), 4);
    }
}
