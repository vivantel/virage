//! Warm query endpoint (retrieval contract v0, part c): loopback HTTP/1.1 + JSON.
//!
//! - `POST /v0/query` `{ query, maxChunks, maxChars, minSimilarity }` →
//!   `{ contractVersion: 0, chunks: [{ text, source, similarity }] }` (body <= 64 KiB, `source`
//!   required on every chunk);
//! - `GET /v0/health` → `{"ok": true}`;
//! - every other route (and method) is `404`; non-200 bodies are `{"error": "short message"}`;
//!   `401` is a bad token, `503` is not ready.
//!
//! Read-only: no write, index, delete or configuration route exists. Every request needs
//! `Authorization: Bearer <token>`. The server is not owned by a parent process: it ends after an
//! idle timeout or on the `shutdown` future (the command wires SIGTERM/SIGINT to it).
//!
//! The server never logs request or result text. Errors carry short fixed messages.

use std::future::Future;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Semaphore;

pub const MAX_QUERY_CHARS: usize = 2000;
pub const MAX_RESPONSE_BYTES: usize = 64 * 1024;

const MAX_BODY_BYTES: usize = 16 * 1024;
const MAX_HEADER_BYTES: usize = 16 * 1024;
const DEFAULT_MAX_CHUNKS: usize = 5;
/// The tool's own caps: lower than a request's ask wins (the contract allows this).
const CAP_MAX_CHUNKS: usize = 20;
const DEFAULT_MAX_CHARS: usize = 800;
const CAP_MAX_CHARS: usize = 4000;
const READ_TIMEOUT: Duration = Duration::from_secs(10);
const WRITE_TIMEOUT: Duration = Duration::from_secs(10);
const QUERY_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_CONNECTIONS: usize = 32;

// ─── Backend ──────────────────────────────────────────────────────────────────

/// A validated query.
#[derive(Debug, Clone, PartialEq)]
pub struct QueryParams {
    pub query: String,
    pub max_chunks: usize,
    pub max_chars: usize,
    pub min_similarity: Option<f32>,
}

/// One search hit before shaping.
#[derive(Debug, Clone, PartialEq)]
pub struct Hit {
    /// Source path as stored (may be absolute or `./`-prefixed); `None` if unknown.
    pub source_file: Option<String>,
    pub text: String,
    pub similarity: f32,
    pub line_start: Option<u64>,
    pub line_end: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BackendError {
    /// The engine is not ready yet (`503`).
    NotReady,
    /// A governance check refused the query (`403`). The message is short and fixed.
    Refused(String),
    /// Anything else (`500`). The detail is dropped: it could contain content.
    Failed,
}

#[async_trait::async_trait]
pub trait QueryBackend: Send + Sync {
    fn is_ready(&self) -> bool;
    /// Return up to `params.max_chunks` hits (the server shapes and caps them again).
    async fn query(&self, params: &QueryParams) -> Result<Vec<Hit>, BackendError>;
}

// ─── Response shaping ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
pub struct Chunk {
    pub text: String,
    pub source: String,
    pub similarity: f32,
}

/// Normalise a stored source path to a project-relative path with `/` separators. `None` if it is
/// empty, outside the project, or otherwise cannot be a project path.
pub fn normalize_source(raw: &str, project_root: &str) -> Option<String> {
    let mut p = raw.trim().replace('\\', "/");
    if p.is_empty() || p.contains('#') {
        return None;
    }
    let root = project_root.replace('\\', "/");
    let root = root.trim_end_matches('/');
    let is_absolute =
        p.starts_with('/') || (p.len() > 2 && p.as_bytes()[1] == b':' && p.as_bytes()[2] == b'/');
    if is_absolute {
        let rest = p.strip_prefix(root)?;
        p = rest.strip_prefix('/')?.to_string();
    }
    while let Some(rest) = p.strip_prefix("./") {
        p = rest.to_string();
    }
    if p.is_empty() || p.split('/').any(|seg| seg.is_empty() || seg == "..") {
        return None;
    }
    Some(p)
}

fn truncate_chars(s: &str, max_chars: usize) -> String {
    match s.char_indices().nth(max_chars) {
        Some((idx, _)) => s[..idx].to_string(),
        None => s.to_string(),
    }
}

/// Turn raw hits into contract chunks: drop hits without a usable project-relative source or below
/// `minSimilarity`, order by similarity, cap the count, truncate each text to `maxChars`.
pub fn shape_chunks(hits: Vec<Hit>, params: &QueryParams, project_root: &str) -> Vec<Chunk> {
    let mut chunks: Vec<Chunk> = hits
        .into_iter()
        .filter(|h| match params.min_similarity {
            Some(min) => h.similarity >= min,
            None => true,
        })
        .filter_map(|h| {
            let mut source = normalize_source(h.source_file.as_deref()?, project_root)?;
            if let Some(start) = h.line_start {
                source.push_str(&format!("#L{start}"));
                if let Some(end) = h.line_end.filter(|&e| e > start) {
                    source.push_str(&format!("-L{end}"));
                }
            }
            Some(Chunk {
                text: truncate_chars(&h.text, params.max_chars),
                source,
                similarity: h.similarity,
            })
        })
        .collect();
    chunks.sort_by(|a, b| {
        b.similarity
            .partial_cmp(&a.similarity)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    chunks.truncate(params.max_chunks);
    chunks
}

fn chunks_body(chunks: &[Chunk]) -> Vec<u8> {
    let list: Vec<serde_json::Value> = chunks
        .iter()
        .map(|c| {
            serde_json::json!({
                "text": c.text,
                "source": c.source,
                // Four decimals: an f32 widened to f64 would print as 0.8100000023841858.
                "similarity": (f64::from(c.similarity) * 10_000.0).round() / 10_000.0,
            })
        })
        .collect();
    serde_json::to_vec(&serde_json::json!({
        "contractVersion": super::CONTRACT_VERSION,
        "chunks": list,
    }))
    .unwrap_or_default()
}

/// Serialise chunks so the whole body is at most [`MAX_RESPONSE_BYTES`]: drop the lowest-ranked
/// chunks until it fits; if one chunk alone is still too large, shorten its text.
pub fn encode_response(mut chunks: Vec<Chunk>) -> Vec<u8> {
    loop {
        let body = chunks_body(&chunks);
        if body.len() <= MAX_RESPONSE_BYTES {
            return body;
        }
        if chunks.len() > 1 {
            chunks.pop();
            continue;
        }
        match chunks.first_mut() {
            Some(only) if !only.text.is_empty() => {
                let keep = only.text.chars().count() / 2;
                only.text = truncate_chars(&only.text, keep);
            }
            _ => return chunks_body(&[]),
        }
    }
}

// ─── Request parsing ──────────────────────────────────────────────────────────

struct Request {
    method: String,
    path: String,
    /// Header names lower-cased.
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

impl Request {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.as_str())
    }
}

#[derive(Debug, PartialEq, Eq)]
enum ReadError {
    Malformed(&'static str),
    HeadersTooLarge,
    BodyTooLarge,
    Closed,
}

impl ReadError {
    fn response(&self) -> (u16, &'static str) {
        match self {
            ReadError::Malformed(m) => (400, *m),
            ReadError::HeadersTooLarge => (431, "headers too large"),
            ReadError::BodyTooLarge => (413, "body too large"),
            ReadError::Closed => (400, "incomplete request"),
        }
    }
}

fn find_head_end(buf: &[u8]) -> Option<usize> {
    buf.windows(4).position(|w| w == b"\r\n\r\n")
}

fn parse_head(head: &[u8]) -> Result<(String, String, Vec<(String, String)>), ReadError> {
    let text = std::str::from_utf8(head).map_err(|_| ReadError::Malformed("malformed request"))?;
    let mut lines = text.split("\r\n");
    let request_line = lines
        .next()
        .ok_or(ReadError::Malformed("malformed request"))?;
    let mut parts = request_line.split(' ');
    let (Some(method), Some(target), Some(version), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return Err(ReadError::Malformed("malformed request"));
    };
    if version != "HTTP/1.1" && version != "HTTP/1.0" {
        return Err(ReadError::Malformed("unsupported http version"));
    }
    let path = target.split('?').next().unwrap_or("").to_string();
    let mut headers = Vec::new();
    for line in lines {
        let (name, value) = line
            .split_once(':')
            .ok_or(ReadError::Malformed("malformed header"))?;
        headers.push((name.trim().to_ascii_lowercase(), value.trim().to_string()));
    }
    Ok((method.to_string(), path, headers))
}

async fn read_request<R: AsyncReadExt + Unpin>(stream: &mut R) -> Result<Request, ReadError> {
    let mut buf: Vec<u8> = Vec::with_capacity(1024);
    let mut chunk = [0u8; 2048];
    let head_end = loop {
        if let Some(pos) = find_head_end(&buf) {
            break pos;
        }
        if buf.len() > MAX_HEADER_BYTES {
            return Err(ReadError::HeadersTooLarge);
        }
        let n = stream
            .read(&mut chunk)
            .await
            .map_err(|_| ReadError::Closed)?;
        if n == 0 {
            return Err(ReadError::Closed);
        }
        buf.extend_from_slice(&chunk[..n]);
    };

    let (method, path, headers) = parse_head(&buf[..head_end])?;
    if headers.iter().any(|(k, _)| k == "transfer-encoding") {
        return Err(ReadError::Malformed("unsupported transfer encoding"));
    }
    let content_length = match headers.iter().find(|(k, _)| k == "content-length") {
        None => 0,
        Some((_, v)) => v
            .parse::<usize>()
            .map_err(|_| ReadError::Malformed("bad content-length"))?,
    };
    if content_length > MAX_BODY_BYTES {
        return Err(ReadError::BodyTooLarge);
    }

    let mut body: Vec<u8> = buf[head_end + 4..].to_vec();
    while body.len() < content_length {
        let n = stream
            .read(&mut chunk)
            .await
            .map_err(|_| ReadError::Closed)?;
        if n == 0 {
            return Err(ReadError::Closed);
        }
        body.extend_from_slice(&chunk[..n]);
        if body.len() > MAX_BODY_BYTES {
            return Err(ReadError::BodyTooLarge);
        }
    }
    body.truncate(content_length);

    Ok(Request {
        method,
        path,
        headers,
        body,
    })
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────

fn error_body(message: &str) -> Vec<u8> {
    serde_json::to_vec(&serde_json::json!({ "error": message })).unwrap_or_default()
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        408 => "Request Timeout",
        413 => "Payload Too Large",
        431 => "Request Header Fields Too Large",
        500 => "Internal Server Error",
        503 => "Service Unavailable",
        504 => "Gateway Timeout",
        _ => "Error",
    }
}

/// Validate a `POST /v0/query` body.
fn parse_query_params(body: &[u8]) -> Result<QueryParams, &'static str> {
    let v: serde_json::Value = serde_json::from_slice(body).map_err(|_| "invalid json")?;
    let query = v
        .get("query")
        .and_then(|q| q.as_str())
        .ok_or("query is required")?;
    if query.trim().is_empty() {
        return Err("query is required");
    }
    if query.chars().count() > MAX_QUERY_CHARS {
        return Err("query too long");
    }
    let bound = |name: &str, default: usize, cap: usize| -> Result<usize, &'static str> {
        match v.get(name) {
            None | Some(serde_json::Value::Null) => Ok(default),
            Some(n) => match n.as_u64() {
                Some(n) if n >= 1 => Ok((n as usize).min(cap)),
                _ => Err("invalid bound"),
            },
        }
    };
    let max_chunks = bound("maxChunks", DEFAULT_MAX_CHUNKS, CAP_MAX_CHUNKS)?;
    let max_chars = bound("maxChars", DEFAULT_MAX_CHARS, CAP_MAX_CHARS)?;
    let min_similarity = match v.get("minSimilarity") {
        None | Some(serde_json::Value::Null) => None,
        Some(n) => Some(n.as_f64().ok_or("invalid bound")?.clamp(0.0, 1.0) as f32),
    };
    Ok(QueryParams {
        query: query.to_string(),
        max_chunks,
        max_chars,
        min_similarity,
    })
}

struct Ctx {
    token: String,
    project_root: String,
    backend: Arc<dyn QueryBackend>,
    start: Instant,
    last_activity_ms: std::sync::atomic::AtomicU64,
    active: AtomicUsize,
}

impl Ctx {
    fn touch(&self) {
        self.last_activity_ms
            .store(self.start.elapsed().as_millis() as u64, Ordering::Relaxed);
    }

    fn idle_for(&self) -> Duration {
        let now = self.start.elapsed().as_millis() as u64;
        Duration::from_millis(now.saturating_sub(self.last_activity_ms.load(Ordering::Relaxed)))
    }
}

fn authorized(req: &Request, token: &str) -> bool {
    req.header("authorization")
        .and_then(|v| v.strip_prefix("Bearer "))
        .is_some_and(|presented| constant_time_eq(presented.trim().as_bytes(), token.as_bytes()))
}

/// Reject a `Host` that is not a loopback name (defence against DNS rebinding; the token is the
/// real protection).
fn host_is_loopback(req: &Request) -> bool {
    match req.header("host") {
        None => true,
        Some(host) => {
            let name = host
                .strip_prefix('[')
                .and_then(|h| h.split(']').next())
                .unwrap_or_else(|| host.rsplit_once(':').map_or(host, |(h, _)| h));
            matches!(name, "127.0.0.1" | "::1" | "localhost")
        }
    }
}

async fn dispatch(req: Request, ctx: &Ctx) -> (u16, Vec<u8>) {
    #[derive(PartialEq)]
    enum Route {
        Query,
        Health,
    }
    // Only these two routes exist; any other path or method is a 404.
    let route = match (req.method.as_str(), req.path.as_str()) {
        ("POST", "/v0/query") => Route::Query,
        ("GET", "/v0/health") => Route::Health,
        _ => return (404, error_body("not found")),
    };
    if !authorized(&req, &ctx.token) {
        return (401, error_body("unauthorized"));
    }
    if !host_is_loopback(&req) {
        return (400, error_body("bad host"));
    }
    if !ctx.backend.is_ready() {
        return (503, error_body("not ready"));
    }
    if route == Route::Health {
        return (200, br#"{"ok":true}"#.to_vec());
    }

    let params = match parse_query_params(&req.body) {
        Ok(p) => p,
        Err(msg) => return (400, error_body(msg)),
    };
    match tokio::time::timeout(QUERY_TIMEOUT, ctx.backend.query(&params)).await {
        Err(_) => (504, error_body("query timed out")),
        Ok(Err(BackendError::NotReady)) => (503, error_body("not ready")),
        Ok(Err(BackendError::Refused(msg))) => (403, error_body(&msg)),
        Ok(Err(BackendError::Failed)) => (500, error_body("query failed")),
        Ok(Ok(hits)) => {
            let chunks = shape_chunks(hits, &params, &ctx.project_root);
            (200, encode_response(chunks))
        }
    }
}

async fn write_response<W: AsyncWriteExt + Unpin>(stream: &mut W, status: u16, body: &[u8]) {
    let head = format!(
        "HTTP/1.1 {status} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        reason(status),
        body.len()
    );
    let _ = tokio::time::timeout(WRITE_TIMEOUT, async {
        stream.write_all(head.as_bytes()).await?;
        stream.write_all(body).await?;
        stream.flush().await
    })
    .await;
}

async fn handle_connection(mut stream: TcpStream, ctx: Arc<Ctx>) {
    ctx.active.fetch_add(1, Ordering::Relaxed);
    ctx.touch();
    let (status, body) = match tokio::time::timeout(READ_TIMEOUT, read_request(&mut stream)).await {
        Ok(Ok(req)) => dispatch(req, &ctx).await,
        Ok(Err(e)) => {
            let (status, msg) = e.response();
            (status, error_body(msg))
        }
        Err(_) => (408, error_body("request timeout")),
    };
    write_response(&mut stream, status, &body).await;
    let _ = stream.shutdown().await;
    ctx.touch();
    ctx.active.fetch_sub(1, Ordering::Relaxed);
}

// ─── Server ───────────────────────────────────────────────────────────────────

pub struct ServerConfig {
    /// Bearer token every request must present.
    pub token: String,
    /// The server ends after this long with no request in flight.
    pub idle_timeout: Duration,
    /// Project root, used to turn stored absolute source paths into project-relative ones.
    pub project_root: PathBuf,
}

/// Accept connections until `idle_timeout` passes with no activity or `shutdown` resolves.
pub async fn serve(
    listener: TcpListener,
    config: ServerConfig,
    backend: Arc<dyn QueryBackend>,
    shutdown: impl Future<Output = ()>,
) -> std::io::Result<()> {
    let ctx = Arc::new(Ctx {
        token: config.token,
        project_root: config.project_root.to_string_lossy().into_owned(),
        backend,
        start: Instant::now(),
        last_activity_ms: std::sync::atomic::AtomicU64::new(0),
        active: AtomicUsize::new(0),
    });
    let permits = Arc::new(Semaphore::new(MAX_CONNECTIONS));
    let idle_timeout = config.idle_timeout;
    let check_every = (idle_timeout / 4).clamp(Duration::from_millis(20), Duration::from_secs(1));
    let mut ticker = tokio::time::interval(check_every);
    tokio::pin!(shutdown);

    loop {
        tokio::select! {
            _ = &mut shutdown => break,
            _ = ticker.tick() => {
                if ctx.active.load(Ordering::Relaxed) == 0 && ctx.idle_for() >= idle_timeout {
                    break;
                }
            }
            accepted = listener.accept() => {
                let Ok((mut stream, peer)) = accepted else { continue };
                if !peer.ip().is_loopback() {
                    continue;
                }
                ctx.touch();
                match permits.clone().try_acquire_owned() {
                    Ok(permit) => {
                        let ctx = ctx.clone();
                        tokio::spawn(async move {
                            handle_connection(stream, ctx).await;
                            drop(permit);
                        });
                    }
                    Err(_) => {
                        tokio::spawn(async move {
                            write_response(&mut stream, 503, &error_body("busy")).await;
                        });
                    }
                }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicBool;

    const TOKEN: &str = "test-token-0123456789abcdef";

    // ── shaping ──────────────────────────────────────────────────────────────

    fn params(max_chunks: usize, max_chars: usize, min: Option<f32>) -> QueryParams {
        QueryParams {
            query: "q".into(),
            max_chunks,
            max_chars,
            min_similarity: min,
        }
    }

    fn hit(source: Option<&str>, text: &str, similarity: f32) -> Hit {
        Hit {
            source_file: source.map(str::to_string),
            text: text.to_string(),
            similarity,
            line_start: None,
            line_end: None,
        }
    }

    #[test]
    fn source_paths_are_project_relative() {
        let root = "/work/proj";
        assert_eq!(
            normalize_source("docs/guide.md", root).as_deref(),
            Some("docs/guide.md")
        );
        assert_eq!(
            normalize_source("./docs/guide.md", root).as_deref(),
            Some("docs/guide.md")
        );
        assert_eq!(
            normalize_source("/work/proj/docs/guide.md", root).as_deref(),
            Some("docs/guide.md")
        );
        assert_eq!(
            normalize_source("docs\\guide.md", root).as_deref(),
            Some("docs/guide.md")
        );
        // Outside the project, traversal, empty, or already carrying a fragment: unusable.
        assert_eq!(normalize_source("/etc/passwd", root), None);
        assert_eq!(normalize_source("../x.md", root), None);
        assert_eq!(normalize_source("a/../../x.md", root), None);
        assert_eq!(normalize_source("", root), None);
        assert_eq!(normalize_source("a.md#frag", root), None);
    }

    #[test]
    fn chunks_without_a_usable_source_are_dropped() {
        let hits = vec![
            hit(None, "no source", 0.9),
            hit(Some("/elsewhere/x.md"), "outside", 0.8),
            hit(Some("ok.md"), "kept", 0.7),
        ];
        let out = shape_chunks(hits, &params(5, 800, None), "/work/proj");
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].source, "ok.md");
    }

    #[test]
    fn chunks_are_ordered_capped_filtered_and_truncated() {
        let hits = vec![
            hit(Some("c.md"), "ccc", 0.50),
            hit(Some("a.md"), "aaaaaaaaaa", 0.90),
            hit(Some("b.md"), "bbb", 0.70),
            hit(Some("d.md"), "ddd", 0.10),
        ];
        let out = shape_chunks(hits, &params(2, 4, Some(0.3)), "/p");
        assert_eq!(
            out.iter().map(|c| c.source.as_str()).collect::<Vec<_>>(),
            vec!["a.md", "b.md"]
        );
        assert_eq!(out[0].text, "aaaa");
    }

    #[test]
    fn truncation_is_by_characters_not_bytes() {
        let out = shape_chunks(
            vec![hit(Some("a.md"), "ééééé", 0.9)],
            &params(1, 3, None),
            "/p",
        );
        assert_eq!(out[0].text, "ééé");
    }

    #[test]
    fn line_numbers_become_a_fragment() {
        let mut h = hit(Some("a.rs"), "x", 0.9);
        h.line_start = Some(10);
        h.line_end = Some(14);
        let out = shape_chunks(vec![h], &params(1, 100, None), "/p");
        assert_eq!(out[0].source, "a.rs#L10-L14");
    }

    #[test]
    fn response_body_never_exceeds_64_kib() {
        let big = "x".repeat(40_000);
        let chunks: Vec<Chunk> = (0..5)
            .map(|i| Chunk {
                text: big.clone(),
                source: format!("f{i}.md"),
                similarity: 0.9 - i as f32 * 0.1,
            })
            .collect();
        let body = encode_response(chunks);
        assert!(body.len() <= MAX_RESPONSE_BYTES);
        let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(v["contractVersion"], 0);
        // Lowest-ranked chunks are dropped first.
        assert_eq!(v["chunks"][0]["source"], "f0.md");

        // One oversize chunk is shortened rather than dropped.
        let one = vec![Chunk {
            text: "y".repeat(200_000),
            source: "huge.md".into(),
            similarity: 0.9,
        }];
        let body = encode_response(one);
        assert!(body.len() <= MAX_RESPONSE_BYTES);
        let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(v["chunks"][0]["source"], "huge.md");
    }

    // ── request validation ───────────────────────────────────────────────────

    #[test]
    fn query_params_validation() {
        let ok = parse_query_params(br#"{"query":"hello"}"#).unwrap();
        assert_eq!(ok.max_chunks, DEFAULT_MAX_CHUNKS);
        assert_eq!(ok.max_chars, DEFAULT_MAX_CHARS);
        assert_eq!(ok.min_similarity, None);

        let capped = parse_query_params(
            br#"{"query":"q","maxChunks":999,"maxChars":999999,"minSimilarity":0.65}"#,
        )
        .unwrap();
        assert_eq!(capped.max_chunks, CAP_MAX_CHUNKS);
        assert_eq!(capped.max_chars, CAP_MAX_CHARS);
        assert_eq!(capped.min_similarity, Some(0.65));

        assert!(parse_query_params(b"not json").is_err());
        assert!(parse_query_params(br#"{}"#).is_err());
        assert!(parse_query_params(br#"{"query":"   "}"#).is_err());
        assert!(parse_query_params(br#"{"query":5}"#).is_err());
        assert!(parse_query_params(br#"{"query":"q","maxChunks":0}"#).is_err());
        assert!(parse_query_params(br#"{"query":"q","maxChunks":"3"}"#).is_err());
        let long = format!(r#"{{"query":"{}"}}"#, "a".repeat(MAX_QUERY_CHARS + 1));
        assert_eq!(parse_query_params(long.as_bytes()), Err("query too long"));
        let exact = format!(r#"{{"query":"{}"}}"#, "a".repeat(MAX_QUERY_CHARS));
        assert!(parse_query_params(exact.as_bytes()).is_ok());
    }

    #[test]
    fn constant_time_eq_behaves() {
        assert!(constant_time_eq(b"abc", b"abc"));
        assert!(!constant_time_eq(b"abc", b"abd"));
        assert!(!constant_time_eq(b"abc", b"ab"));
    }

    // ── over a real socket ───────────────────────────────────────────────────

    struct FakeBackend {
        ready: AtomicBool,
        hits: Vec<Hit>,
        error: Option<BackendError>,
    }

    impl FakeBackend {
        fn ready(hits: Vec<Hit>) -> Arc<Self> {
            Arc::new(Self {
                ready: AtomicBool::new(true),
                hits,
                error: None,
            })
        }
    }

    #[async_trait::async_trait]
    impl QueryBackend for FakeBackend {
        fn is_ready(&self) -> bool {
            self.ready.load(Ordering::Relaxed)
        }
        async fn query(&self, _params: &QueryParams) -> Result<Vec<Hit>, BackendError> {
            match &self.error {
                Some(e) => Err(e.clone()),
                None => Ok(self.hits.clone()),
            }
        }
    }

    struct Running {
        addr: std::net::SocketAddr,
        handle: tokio::task::JoinHandle<std::io::Result<()>>,
        stop: tokio::sync::oneshot::Sender<()>,
    }

    async fn start(backend: Arc<dyn QueryBackend>, idle: Duration) -> Running {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let (stop, rx) = tokio::sync::oneshot::channel::<()>();
        let handle = tokio::spawn(serve(
            listener,
            ServerConfig {
                token: TOKEN.to_string(),
                idle_timeout: idle,
                project_root: PathBuf::from("/work/proj"),
            },
            backend,
            async move {
                let _ = rx.await;
            },
        ));
        Running { addr, handle, stop }
    }

    /// Send a raw request, return (status, body).
    async fn request(addr: std::net::SocketAddr, raw: &str) -> (u16, String) {
        let mut s = TcpStream::connect(addr).await.unwrap();
        s.write_all(raw.as_bytes()).await.unwrap();
        let mut out = Vec::new();
        s.read_to_end(&mut out).await.unwrap();
        let text = String::from_utf8(out).unwrap();
        let status: u16 = text.split(' ').nth(1).unwrap().parse().unwrap();
        let body = text.split("\r\n\r\n").nth(1).unwrap_or("").to_string();
        (status, body)
    }

    fn post_query(token: Option<&str>, body: &str) -> String {
        let auth = token.map_or(String::new(), |t| format!("Authorization: Bearer {t}\r\n"));
        format!(
            "POST /v0/query HTTP/1.1\r\nHost: 127.0.0.1\r\n{auth}Content-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
            body.len()
        )
    }

    fn get(path: &str, token: Option<&str>) -> String {
        let auth = token.map_or(String::new(), |t| format!("Authorization: Bearer {t}\r\n"));
        format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\n{auth}\r\n")
    }

    #[tokio::test]
    async fn health_requires_the_token() {
        let r = start(FakeBackend::ready(vec![]), Duration::from_secs(30)).await;
        let (status, body) = request(r.addr, &get("/v0/health", Some(TOKEN))).await;
        assert_eq!((status, body.as_str()), (200, r#"{"ok":true}"#));
        let (status, body) = request(r.addr, &get("/v0/health", Some("wrong"))).await;
        assert_eq!(status, 401);
        assert_eq!(body, r#"{"error":"unauthorized"}"#);
        let (status, _) = request(r.addr, &get("/v0/health", None)).await;
        assert_eq!(status, 401);
        let _ = r.stop.send(());
        r.handle.await.unwrap().unwrap();
    }

    #[tokio::test]
    async fn query_returns_contract_shaped_chunks() {
        let hits = vec![
            hit(Some("docs/guide.md"), "low", 0.40),
            hit(Some("docs/guide.md"), "high", 0.81),
            hit(None, "sourceless", 0.99),
        ];
        let r = start(FakeBackend::ready(hits), Duration::from_secs(30)).await;
        let (status, body) = request(
            r.addr,
            &post_query(
                Some(TOKEN),
                r#"{"query":"how","maxChunks":5,"maxChars":800,"minSimilarity":0.65}"#,
            ),
        )
        .await;
        assert_eq!(status, 200);
        let v: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(v["contractVersion"], 0);
        assert_eq!(v["chunks"].as_array().unwrap().len(), 1);
        assert_eq!(v["chunks"][0]["text"], "high");
        assert_eq!(v["chunks"][0]["source"], "docs/guide.md");
        assert!(v["chunks"][0]["similarity"].as_f64().unwrap() > 0.8);
        let _ = r.stop.send(());
        r.handle.await.unwrap().unwrap();
    }

    #[tokio::test]
    async fn other_routes_and_methods_are_404() {
        let r = start(FakeBackend::ready(vec![]), Duration::from_secs(30)).await;
        for raw in [
            get("/", Some(TOKEN)),
            get("/v0/query", Some(TOKEN)),
            get("/v0/index", Some(TOKEN)),
            get("/v1/health", Some(TOKEN)),
            "DELETE /v0/query HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n".to_string(),
            "POST /v0/health HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 0\r\n\r\n".to_string(),
        ] {
            let (status, body) = request(r.addr, &raw).await;
            assert_eq!(status, 404, "{raw}");
            assert_eq!(body, r#"{"error":"not found"}"#);
        }
        let _ = r.stop.send(());
        r.handle.await.unwrap().unwrap();
    }

    #[tokio::test]
    async fn bad_requests_get_short_error_bodies() {
        let r = start(FakeBackend::ready(vec![]), Duration::from_secs(30)).await;
        let (status, body) = request(r.addr, &post_query(Some(TOKEN), "not json")).await;
        assert_eq!(
            (status, body.as_str()),
            (400, r#"{"error":"invalid json"}"#)
        );
        let long = format!(r#"{{"query":"{}"}}"#, "a".repeat(2001));
        let (status, _) = request(r.addr, &post_query(Some(TOKEN), &long)).await;
        assert_eq!(status, 400);
        let (status, _) = request(r.addr, &post_query(None, r#"{"query":"x"}"#)).await;
        assert_eq!(status, 401);
        // A rebinding-style Host is refused even with a valid token.
        let raw = "GET /v0/health HTTP/1.1\r\nHost: evil.example\r\nAuthorization: Bearer test-token-0123456789abcdef\r\n\r\n";
        let (status, _) = request(r.addr, raw).await;
        assert_eq!(status, 400);
        // Oversized declared body.
        let raw = format!(
            "POST /v0/query HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer {TOKEN}\r\nContent-Length: 1000000\r\n\r\n"
        );
        let (status, _) = request(r.addr, &raw).await;
        assert_eq!(status, 413);
        // Chunked bodies are not supported.
        let raw = format!(
            "POST /v0/query HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer {TOKEN}\r\nTransfer-Encoding: chunked\r\n\r\n"
        );
        let (status, _) = request(r.addr, &raw).await;
        assert_eq!(status, 400);
        let _ = r.stop.send(());
        r.handle.await.unwrap().unwrap();
    }

    #[tokio::test]
    async fn not_ready_is_503_and_backend_errors_map_to_statuses() {
        let backend = Arc::new(FakeBackend {
            ready: AtomicBool::new(false),
            hits: vec![],
            error: None,
        });
        let r = start(backend, Duration::from_secs(30)).await;
        let (status, body) = request(r.addr, &get("/v0/health", Some(TOKEN))).await;
        assert_eq!((status, body.as_str()), (503, r#"{"error":"not ready"}"#));
        let (status, _) = request(r.addr, &post_query(Some(TOKEN), r#"{"query":"x"}"#)).await;
        assert_eq!(status, 503);
        let _ = r.stop.send(());
        r.handle.await.unwrap().unwrap();

        for (err, expected) in [
            (BackendError::Refused("policy refused".into()), 403),
            (BackendError::Failed, 500),
            (BackendError::NotReady, 503),
        ] {
            let backend = Arc::new(FakeBackend {
                ready: AtomicBool::new(true),
                hits: vec![],
                error: Some(err),
            });
            let r = start(backend, Duration::from_secs(30)).await;
            let (status, body) =
                request(r.addr, &post_query(Some(TOKEN), r#"{"query":"x"}"#)).await;
            assert_eq!(status, expected);
            assert!(body.starts_with(r#"{"error":""#));
            let _ = r.stop.send(());
            r.handle.await.unwrap().unwrap();
        }
    }

    #[tokio::test]
    async fn server_ends_after_the_idle_timeout() {
        let r = start(FakeBackend::ready(vec![]), Duration::from_millis(150)).await;
        let ended = tokio::time::timeout(Duration::from_secs(5), r.handle).await;
        assert!(ended.is_ok(), "server should stop on its own after idling");
    }

    #[tokio::test]
    async fn activity_defers_the_idle_timeout() {
        let r = start(FakeBackend::ready(vec![]), Duration::from_millis(400)).await;
        for _ in 0..4 {
            tokio::time::sleep(Duration::from_millis(150)).await;
            let (status, _) = request(r.addr, &get("/v0/health", Some(TOKEN))).await;
            assert_eq!(
                status, 200,
                "server must still be up while it is being used"
            );
        }
        let _ = r.stop.send(());
        r.handle.await.unwrap().unwrap();
    }
}
