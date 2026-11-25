//! Endpoint discovery file (retrieval contract v0, part c):
//! `.go-getter/state/retrieval/virage.endpoint.json`.
//!
//! Written when the endpoint is ready, mode `0600`, and removed when the endpoint ends. It holds
//! the loopback address, a per-start bearer token (256 random bits here) and the pid, so a
//! short-lived hook can find and call the endpoint without starting it.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

use super::{CONTRACT_VERSION, TOOL_ID};

/// Project-relative POSIX path of the discovery file.
pub const ENDPOINT_PATH: &str = ".go-getter/state/retrieval/virage.endpoint.json";

pub fn endpoint_path(project_dir: &Path) -> PathBuf {
    project_dir.join(ENDPOINT_PATH)
}

/// 32 random bytes from the operating system, hex-encoded (256 bits).
pub fn generate_token() -> std::io::Result<String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|e| std::io::Error::other(e.to_string()))?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

/// `YYYY-MM-DDTHH:MM:SSZ` for a Unix timestamp (UTC).
pub fn iso8601_utc(unix_secs: u64) -> String {
    let days = (unix_secs / 86_400) as i64;
    let rem = unix_secs % 86_400;
    // Civil-from-days (proleptic Gregorian), after Howard Hinnant.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z",
        rem / 3_600,
        (rem % 3_600) / 60,
        rem % 60
    )
}

pub fn discovery_json(address: &str, token: &str, tool_version: &str) -> serde_json::Value {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    serde_json::json!({
        "contractVersion": CONTRACT_VERSION,
        "tool": TOOL_ID,
        "toolVersion": tool_version,
        "address": address,
        "token": token,
        "pid": std::process::id(),
        "startedAt": iso8601_utc(now),
    })
}

/// Owns the discovery file: removes it on drop, but only while it still holds this instance's
/// token (a newer instance's file is never deleted).
pub struct DiscoveryFile {
    path: PathBuf,
    token: String,
}

impl DiscoveryFile {
    /// Write the file (mode 0600 on Unix) via a temp file + rename, so a reader never sees a
    /// partial file.
    pub fn write(
        project_dir: &Path,
        address: &str,
        token: &str,
        tool_version: &str,
    ) -> std::io::Result<DiscoveryFile> {
        let path = endpoint_path(project_dir);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let tmp = path.with_extension("json.tmp");
        let _ = std::fs::remove_file(&tmp);
        let mut content =
            serde_json::to_string_pretty(&discovery_json(address, token, tool_version))
                .map_err(std::io::Error::other)?;
        content.push('\n');

        let mut opts = std::fs::OpenOptions::new();
        opts.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        let mut file = opts.open(&tmp)?;
        file.write_all(content.as_bytes())?;
        file.sync_all()?;
        drop(file);
        std::fs::rename(&tmp, &path)?;
        Ok(DiscoveryFile {
            path,
            token: token.to_string(),
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    fn holds_our_token(&self) -> bool {
        std::fs::read_to_string(&self.path)
            .ok()
            .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
            .and_then(|v| v.get("token").and_then(|t| t.as_str()).map(str::to_string))
            .is_some_and(|t| t == self.token)
    }
}

impl Drop for DiscoveryFile {
    fn drop(&mut self) {
        if self.holds_our_token() {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

/// If a discovery file exists and its endpoint answers `GET /v0/health`, return its address.
/// Blocking, with short timeouts: used once at start-up to avoid a second instance.
pub fn live_endpoint(project_dir: &Path) -> Option<String> {
    let raw = std::fs::read_to_string(endpoint_path(project_dir)).ok()?;
    let v: serde_json::Value = serde_json::from_str(&raw).ok()?;
    let address = v.get("address")?.as_str()?.to_string();
    let token = v.get("token")?.as_str()?.to_string();
    let addr: std::net::SocketAddr = address.parse().ok()?;
    if !addr.ip().is_loopback() {
        return None;
    }
    let mut stream =
        std::net::TcpStream::connect_timeout(&addr, Duration::from_millis(500)).ok()?;
    stream.set_read_timeout(Some(Duration::from_secs(1))).ok()?;
    stream
        .set_write_timeout(Some(Duration::from_secs(1)))
        .ok()?;
    let request = format!(
        "GET /v0/health HTTP/1.1\r\nHost: {address}\r\nAuthorization: Bearer {token}\r\nConnection: close\r\n\r\n"
    );
    stream.write_all(request.as_bytes()).ok()?;
    let mut head = [0u8; 16];
    stream.read_exact(&mut head).ok()?;
    head.starts_with(b"HTTP/1.1 200").then_some(address)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "virage-discovery-{name}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn token_is_at_least_128_bits_and_fresh() {
        let a = generate_token().unwrap();
        let b = generate_token().unwrap();
        assert!(a.len() >= 32, "128 bits is 32 hex chars");
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b);
    }

    #[test]
    fn iso8601_known_values() {
        assert_eq!(iso8601_utc(0), "1970-01-01T00:00:00Z");
        assert_eq!(iso8601_utc(951_782_400), "2000-02-29T00:00:00Z");
        assert_eq!(iso8601_utc(1_700_000_000), "2023-11-14T22:13:20Z");
    }

    #[test]
    fn discovery_json_has_the_contract_fields() {
        let v = discovery_json("127.0.0.1:49152", "tok", "1.2.3");
        assert_eq!(v["contractVersion"], 0);
        assert_eq!(v["tool"], "virage");
        assert_eq!(v["toolVersion"], "1.2.3");
        assert_eq!(v["address"], "127.0.0.1:49152");
        assert_eq!(v["token"], "tok");
        assert_eq!(v["pid"], std::process::id());
        assert!(v["startedAt"].as_str().unwrap().ends_with('Z'));
    }

    #[test]
    fn file_is_written_and_removed_on_drop() {
        let dir = tmp("write");
        let guard = DiscoveryFile::write(&dir, "127.0.0.1:1", "secret-token", "1.0.0").unwrap();
        let path = guard.path().to_path_buf();
        assert!(path.exists());
        assert!(!path.with_extension("json.tmp").exists());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600);
        }
        drop(guard);
        assert!(!path.exists());
    }

    #[test]
    fn a_newer_instances_file_is_not_removed() {
        let dir = tmp("newer");
        let first = DiscoveryFile::write(&dir, "127.0.0.1:1", "first", "1.0.0").unwrap();
        let second = DiscoveryFile::write(&dir, "127.0.0.1:2", "second", "1.0.0").unwrap();
        drop(first);
        assert!(
            second.path().exists(),
            "the first guard must not delete the second's file"
        );
        drop(second);
    }

    #[test]
    fn no_live_endpoint_without_a_file_or_with_a_dead_address() {
        let dir = tmp("live");
        assert!(live_endpoint(&dir).is_none());
        // Port 1 on loopback: nothing listens there.
        let _guard = DiscoveryFile::write(&dir, "127.0.0.1:1", "t", "1.0.0").unwrap();
        assert!(live_endpoint(&dir).is_none());
    }
}
