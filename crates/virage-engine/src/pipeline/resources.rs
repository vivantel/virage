//! Process resource readings for the run summary: CPU, memory and disk IO, read from `/proc` on
//! Linux and absent elsewhere. The pipeline overlaps its stages across workers and the ONNX
//! runtime computes on its own threads, so these are whole-process figures for the run (a
//! before/after delta), not per-stage; the per-stage view is wall time plus the byte counters in
//! `ProgressCounters`.

/// Linux reports `utime`/`stime` in clock ticks; `sysconf(_SC_CLK_TCK)` is 100 on every
/// mainstream Linux build, which is the value assumed here.
const CLOCK_TICKS_PER_SEC: f64 = 100.0;

#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct ProcSnapshot {
    pub cpu_user_secs: f64,
    pub cpu_sys_secs: f64,
    /// Resident set now, and the process's high-water mark since it started.
    pub rss_kb: u64,
    pub peak_rss_kb: u64,
    /// Bytes the process caused to be fetched from and sent to the storage layer (`read_bytes` and
    /// `write_bytes` of `/proc/self/io`); page-cache hits do not count as reads.
    pub disk_read_bytes: u64,
    pub disk_write_bytes: u64,
    /// Bytes moved through read and write syscalls (`rchar`, `wchar`), page cache included: the
    /// IO the process asked for, where `disk_*` is what reached the device.
    pub read_syscall_bytes: u64,
    pub write_syscall_bytes: u64,
}

impl ProcSnapshot {
    pub fn read() -> Option<Self> {
        let stat = std::fs::read_to_string("/proc/self/stat").ok()?;
        let status = std::fs::read_to_string("/proc/self/status").ok()?;
        // `/proc/self/io` can be unreadable under some sandboxes: report zeros then.
        let io = std::fs::read_to_string("/proc/self/io").unwrap_or_default();
        Some(parse(&stat, &status, &io)?)
    }
}

pub(crate) fn parse(stat: &str, status: &str, io: &str) -> Option<ProcSnapshot> {
    // The command name is in parentheses and may contain spaces: fields count from after the last ')'.
    let after = &stat[stat.rfind(')')? + 1..];
    let f: Vec<&str> = after.split_whitespace().collect();
    // After ')': state is field 3, utime is field 14, stime field 15 (1-based in proc(5)).
    let ticks = |i: usize| f.get(i)?.parse::<f64>().ok();
    let kb = |key: &str| -> u64 {
        status
            .lines()
            .find_map(|l| l.strip_prefix(key))
            .and_then(|v| v.split_whitespace().next())
            .and_then(|v| v.parse().ok())
            .unwrap_or(0)
    };
    let io_val = |key: &str| -> u64 {
        io.lines()
            .find_map(|l| l.strip_prefix(key))
            .and_then(|v| v.trim().parse().ok())
            .unwrap_or(0)
    };
    Some(ProcSnapshot {
        cpu_user_secs: ticks(11)? / CLOCK_TICKS_PER_SEC,
        cpu_sys_secs: ticks(12)? / CLOCK_TICKS_PER_SEC,
        rss_kb: kb("VmRSS:"),
        peak_rss_kb: kb("VmHWM:"),
        disk_read_bytes: io_val("read_bytes:"),
        disk_write_bytes: io_val("write_bytes:"),
        read_syscall_bytes: io_val("rchar:"),
        write_syscall_bytes: io_val("wchar:"),
    })
}

/// What one run used.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ResourceUsage {
    /// Present on Linux only.
    pub cpu_user_secs: Option<f64>,
    pub cpu_sys_secs: Option<f64>,
    /// CPU seconds over (wall seconds x logical cores): 1.0 means every core was busy all run.
    pub cpu_utilization: Option<f64>,
    pub rss_start_kb: Option<u64>,
    pub rss_end_kb: Option<u64>,
    /// High-water mark of the whole process, which includes anything before this run.
    pub peak_rss_kb: Option<u64>,
    pub disk_read_bytes: Option<u64>,
    pub disk_write_bytes: Option<u64>,
    pub read_syscall_bytes: Option<u64>,
    pub write_syscall_bytes: Option<u64>,
    /// Bytes the sources returned and the bytes handed to the store (text plus vectors).
    pub source_bytes_read: u64,
    pub store_bytes_written: u64,
    /// Time workers spent waiting for the embedder lock, summed over workers.
    pub embed_lock_wait_secs: f64,
}

pub(crate) fn usage(
    before: Option<ProcSnapshot>,
    after: Option<ProcSnapshot>,
    wall_secs: f64,
    cores: usize,
    source_bytes_read: u64,
    store_bytes_written: u64,
    embed_lock_wait_secs: f64,
) -> ResourceUsage {
    let mut u = ResourceUsage {
        source_bytes_read,
        store_bytes_written,
        embed_lock_wait_secs,
        ..Default::default()
    };
    if let (Some(b), Some(a)) = (before, after) {
        let user = (a.cpu_user_secs - b.cpu_user_secs).max(0.0);
        let sys = (a.cpu_sys_secs - b.cpu_sys_secs).max(0.0);
        u.cpu_user_secs = Some(user);
        u.cpu_sys_secs = Some(sys);
        if wall_secs > 0.0 && cores > 0 {
            u.cpu_utilization = Some((user + sys) / (wall_secs * cores as f64));
        }
        u.rss_start_kb = Some(b.rss_kb);
        u.rss_end_kb = Some(a.rss_kb);
        u.peak_rss_kb = Some(a.peak_rss_kb);
        u.disk_read_bytes = Some(a.disk_read_bytes.saturating_sub(b.disk_read_bytes));
        u.disk_write_bytes = Some(a.disk_write_bytes.saturating_sub(b.disk_write_bytes));
        u.read_syscall_bytes = Some(a.read_syscall_bytes.saturating_sub(b.read_syscall_bytes));
        u.write_syscall_bytes = Some(a.write_syscall_bytes.saturating_sub(b.write_syscall_bytes));
    }
    u
}

#[cfg(test)]
mod tests {
    use super::*;

    const STAT: &str =
        "42 (virage (dev)) S 1 42 42 0 -1 4194560 100 0 0 0 250 50 0 0 20 0 8 0 100 1000 200 0";
    const STATUS: &str = "Name:\tvirage\nVmHWM:\t  123456 kB\nVmRSS:\t   65432 kB\n";
    const IO: &str = "rchar: 1\nwchar: 2\nread_bytes: 4096\nwrite_bytes: 8192\n";

    #[test]
    fn parses_cpu_memory_and_io_even_with_parentheses_in_the_command_name() {
        let s = parse(STAT, STATUS, IO).unwrap();
        assert_eq!(s.cpu_user_secs, 2.5);
        assert_eq!(s.cpu_sys_secs, 0.5);
        assert_eq!((s.rss_kb, s.peak_rss_kb), (65432, 123456));
        assert_eq!((s.disk_read_bytes, s.disk_write_bytes), (4096, 8192));
        assert_eq!((s.read_syscall_bytes, s.write_syscall_bytes), (1, 2));
    }

    #[test]
    fn missing_io_file_reads_as_zero_not_as_failure() {
        let s = parse(STAT, STATUS, "").unwrap();
        assert_eq!((s.disk_read_bytes, s.disk_write_bytes), (0, 0));
    }

    #[test]
    fn utilization_is_cpu_over_wall_times_cores() {
        let b = ProcSnapshot::default();
        let a = ProcSnapshot {
            cpu_user_secs: 3.0,
            cpu_sys_secs: 1.0,
            rss_kb: 10,
            peak_rss_kb: 20,
            disk_read_bytes: 5,
            disk_write_bytes: 7,
            read_syscall_bytes: 0,
            write_syscall_bytes: 0,
        };
        let u = usage(Some(b), Some(a), 2.0, 4, 100, 200, 0.5);
        assert_eq!(u.cpu_utilization, Some(0.5));
        assert_eq!((u.disk_read_bytes, u.disk_write_bytes), (Some(5), Some(7)));
        let none = usage(None, None, 2.0, 4, 1, 2, 0.0);
        assert_eq!((none.cpu_utilization, none.peak_rss_kb), (None, None));
        assert_eq!((none.source_bytes_read, none.store_bytes_written), (1, 2));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn the_live_reading_works_on_linux() {
        let s = ProcSnapshot::read().expect("/proc/self is readable on Linux");
        assert!(s.rss_kb > 0 && s.peak_rss_kb >= s.rss_kb);
    }
}
