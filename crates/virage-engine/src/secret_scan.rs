//! Pre-index secret scan (retrieval contract v0, `preIndexSecretScan`).
//!
//! Every file is scanned before it is chunked and embedded; a file with a finding is skipped. The
//! scan is a set of high-signal token shapes (private-key blocks, cloud and VCS tokens, JWTs) plus
//! a high-entropy value assigned to a secret-looking name. A finding names a *kind* only: the
//! matched text is never returned, logged or stored.
//!
//! Mirrors `packages/virage-core/src/secret-scan.ts`.

/// What was found. Never carries the matched text.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Finding {
    pub kind: &'static str,
}

/// Scan raw file content. Returns the first finding, if any.
pub fn scan(data: &[u8]) -> Option<Finding> {
    scan_private_key(data)
        .or_else(|| scan_prefixed_tokens(data))
        .or_else(|| scan_jwt(data))
        .or_else(|| scan_assignments(data))
        .map(|kind| Finding { kind })
}

fn is_alnum(b: u8) -> bool {
    b.is_ascii_alphanumeric()
}

fn is_token_char(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_' || b == b'-'
}

/// Length of the run of bytes starting at `start` that satisfy `pred`.
fn run_len(data: &[u8], start: usize, pred: fn(u8) -> bool) -> usize {
    data.get(start..)
        .map_or(0, |rest| rest.iter().take_while(|&&b| pred(b)).count())
}

/// All start offsets of `needle` in `data`.
fn find_all<'a>(data: &'a [u8], needle: &'a [u8]) -> impl Iterator<Item = usize> + 'a {
    let n = needle.len();
    (0..data.len().saturating_sub(n.saturating_sub(1)))
        .filter(move |&i| data[i..].starts_with(needle))
}

fn scan_private_key(data: &[u8]) -> Option<&'static str> {
    const BEGIN: &[u8] = b"-----BEGIN ";
    const END: &[u8] = b"PRIVATE KEY-----";
    for i in find_all(data, BEGIN) {
        let window = &data[i + BEGIN.len()..data.len().min(i + BEGIN.len() + 40)];
        if window.windows(END.len()).any(|w| w == END) {
            return Some("private-key");
        }
    }
    None
}

struct Rule {
    kind: &'static str,
    prefix: &'static [u8],
    /// Characters allowed in the token body after the prefix.
    body: fn(u8) -> bool,
    min_len: usize,
    /// If set, the body must be exactly this long (a word boundary must follow).
    exact: bool,
}

fn upper_digit(b: u8) -> bool {
    b.is_ascii_uppercase() || b.is_ascii_digit()
}

fn slack_char(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'-'
}

const RULES: &[Rule] = &[
    Rule {
        kind: "aws-access-key",
        prefix: b"AKIA",
        body: upper_digit,
        min_len: 16,
        exact: true,
    },
    Rule {
        kind: "aws-access-key",
        prefix: b"ASIA",
        body: upper_digit,
        min_len: 16,
        exact: true,
    },
    Rule {
        kind: "github-token",
        prefix: b"ghp_",
        body: is_alnum,
        min_len: 36,
        exact: false,
    },
    Rule {
        kind: "github-token",
        prefix: b"gho_",
        body: is_alnum,
        min_len: 36,
        exact: false,
    },
    Rule {
        kind: "github-token",
        prefix: b"ghu_",
        body: is_alnum,
        min_len: 36,
        exact: false,
    },
    Rule {
        kind: "github-token",
        prefix: b"ghs_",
        body: is_alnum,
        min_len: 36,
        exact: false,
    },
    Rule {
        kind: "github-token",
        prefix: b"ghr_",
        body: is_alnum,
        min_len: 36,
        exact: false,
    },
    Rule {
        kind: "github-token",
        prefix: b"github_pat_",
        body: is_token_char,
        min_len: 22,
        exact: false,
    },
    Rule {
        kind: "slack-token",
        prefix: b"xoxb-",
        body: slack_char,
        min_len: 20,
        exact: false,
    },
    Rule {
        kind: "slack-token",
        prefix: b"xoxp-",
        body: slack_char,
        min_len: 20,
        exact: false,
    },
    Rule {
        kind: "slack-token",
        prefix: b"xoxa-",
        body: slack_char,
        min_len: 20,
        exact: false,
    },
    Rule {
        kind: "slack-token",
        prefix: b"xoxr-",
        body: slack_char,
        min_len: 20,
        exact: false,
    },
    Rule {
        kind: "slack-token",
        prefix: b"xoxs-",
        body: slack_char,
        min_len: 20,
        exact: false,
    },
    Rule {
        kind: "google-api-key",
        prefix: b"AIza",
        body: is_token_char,
        min_len: 35,
        exact: true,
    },
    Rule {
        kind: "stripe-key",
        prefix: b"sk_live_",
        body: is_alnum,
        min_len: 24,
        exact: false,
    },
    Rule {
        kind: "stripe-key",
        prefix: b"rk_live_",
        body: is_alnum,
        min_len: 24,
        exact: false,
    },
    Rule {
        kind: "api-key",
        prefix: b"sk-",
        body: is_token_char,
        min_len: 32,
        exact: false,
    },
];

fn scan_prefixed_tokens(data: &[u8]) -> Option<&'static str> {
    for rule in RULES {
        for i in find_all(data, rule.prefix) {
            // The prefix must start a token, not sit in the middle of a longer identifier.
            if i > 0 && is_alnum(data[i - 1]) {
                continue;
            }
            let start = i + rule.prefix.len();
            let len = run_len(data, start, rule.body);
            let ok = if rule.exact {
                len == rule.min_len
            } else {
                len >= rule.min_len
            };
            if ok {
                return Some(rule.kind);
            }
        }
    }
    None
}

fn is_b64url(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_' || b == b'-'
}

fn scan_jwt(data: &[u8]) -> Option<&'static str> {
    for i in find_all(data, b"eyJ") {
        if i > 0 && is_alnum(data[i - 1]) {
            continue;
        }
        let a = run_len(data, i, is_b64url);
        if a < 11 || data.get(i + a) != Some(&b'.') {
            continue;
        }
        let b_start = i + a + 1;
        if !data[b_start..].starts_with(b"eyJ") {
            continue;
        }
        let b = run_len(data, b_start, is_b64url);
        if b < 11 || data.get(b_start + b) != Some(&b'.') {
            continue;
        }
        if run_len(data, b_start + b + 1, is_b64url) >= 8 {
            return Some("jwt");
        }
    }
    None
}

const SECRET_NAMES: &[&str] = &[
    "password",
    "passwd",
    "secret",
    "token",
    "api_key",
    "apikey",
    "api-key",
    "private_key",
    "access_key",
];

/// Substrings that mark a value as an obvious placeholder, not a credential.
const PLACEHOLDERS: &[&str] = &[
    "example",
    "your",
    "placeholder",
    "changeme",
    "change-me",
    "xxxx",
    "****",
    "dummy",
    "sample",
    "redacted",
    "todo",
    "fixme",
    "${",
    "{{",
    "<",
    ">",
    "process.env",
    "getenv",
    "secret_key_here",
];

fn is_value_char(b: u8) -> bool {
    b.is_ascii_alphanumeric()
        || matches!(
            b,
            b'+' | b'/'
                | b'='
                | b'_'
                | b'.'
                | b'-'
                | b'~'
                | b'!'
                | b'@'
                | b'#'
                | b'$'
                | b'%'
                | b'^'
                | b'&'
                | b'*'
        )
}

/// Shannon entropy in bits per byte.
fn entropy(bytes: &[u8]) -> f64 {
    let mut counts = [0usize; 256];
    for &b in bytes {
        counts[b as usize] += 1;
    }
    let n = bytes.len() as f64;
    counts
        .iter()
        .filter(|&&c| c > 0)
        .map(|&c| {
            let p = c as f64 / n;
            -p * p.log2()
        })
        .sum()
}

/// `name = "value"` / `name: 'value'` where `name` looks secret and `value` looks random.
fn scan_assignments(data: &[u8]) -> Option<&'static str> {
    let lower: Vec<u8> = data.iter().map(u8::to_ascii_lowercase).collect();
    for name in SECRET_NAMES {
        for i in find_all(&lower, name.as_bytes()) {
            let mut j = i + name.len();
            // Allow a closing quote and trailing identifier characters on the name (`_key`, `"`).
            j += run_len(data, j, |b| b.is_ascii_alphanumeric() || b == b'_');
            while data.get(j).is_some_and(|&b| b == b'"' || b == b'\'') {
                j += 1;
            }
            j += run_len(data, j, |b| b == b' ' || b == b'\t');
            match data.get(j) {
                Some(b':') | Some(b'=') => j += 1,
                _ => continue,
            }
            if data.get(j) == Some(&b'=') {
                j += 1;
            }
            j += run_len(data, j, |b| b == b' ' || b == b'\t');
            let Some(&quote) = data.get(j) else { continue };
            if quote != b'"' && quote != b'\'' {
                continue;
            }
            j += 1;
            let len = run_len(data, j, is_value_char);
            if len < 16 || data.get(j + len) != Some(&quote) {
                continue;
            }
            let value = &data[j..j + len];
            let lowered = String::from_utf8_lossy(&lower[j..j + len]);
            if PLACEHOLDERS.iter().any(|p| lowered.contains(p)) {
                continue;
            }
            if entropy(value) >= 3.5 {
                return Some("credential-assignment");
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    // Every credential-shaped string below is assembled at runtime from fragments, so no source
    // line contains a contiguous token that a repository secret scanner could flag.

    /// Deterministic, varied-looking tail of `n` characters drawn from `alphabet`.
    fn tail(alphabet: &str, n: usize) -> String {
        let chars: Vec<char> = alphabet.chars().collect();
        (0..n).map(|i| chars[(i * 7 + 3) % chars.len()]).collect()
    }

    fn join(parts: &[&str]) -> String {
        parts.concat()
    }

    const ALNUM: &str = "aB3dE5fG7hJ9kLmN2pQrS4tUvW6xYz01";
    const UPPER_DIGIT: &str = "Q7ZXN4HPW2KJM5T6RB3V";

    fn kind(text: &str) -> Option<&'static str> {
        scan(text.as_bytes()).map(|f| f.kind)
    }

    #[test]
    fn private_key_block() {
        let t = join(&["-----BEGIN ", "RSA PRIV", "ATE KEY-----\nabc\n"]);
        assert_eq!(kind(&t), Some("private-key"));
        let t = join(&["-----BEGIN ", "PRIV", "ATE KEY-----"]);
        assert_eq!(kind(&t), Some("private-key"));
        // A public certificate is not a secret.
        assert_eq!(kind("-----BEGIN CERTIFICATE-----\nMIIB\n"), None);
    }

    #[test]
    fn aws_access_key() {
        let t = format!("id = {}{}", join(&["AK", "IA"]), tail(UPPER_DIGIT, 16));
        assert_eq!(kind(&t), Some("aws-access-key"));
        // Too short / too long / inside an identifier: not a key.
        let short = format!("id = {}{}", join(&["AK", "IA"]), tail(UPPER_DIGIT, 10));
        assert_eq!(kind(&short), None);
        let long = format!("id = {}{}", join(&["AK", "IA"]), tail(UPPER_DIGIT, 30));
        assert_eq!(kind(&long), None);
        let inside = format!("MY{}{}", join(&["AK", "IA"]), tail(UPPER_DIGIT, 16));
        assert_eq!(kind(&inside), None);
    }

    #[test]
    fn github_tokens() {
        let t = format!("{}{}", join(&["gh", "p_"]), tail(ALNUM, 36));
        assert_eq!(kind(&t), Some("github-token"));
        let t = format!("{}{}", join(&["github", "_pat_"]), tail(ALNUM, 40));
        assert_eq!(kind(&t), Some("github-token"));
        let short = format!("{}{}", join(&["gh", "p_"]), tail(ALNUM, 8));
        assert_eq!(kind(&short), None);
    }

    #[test]
    fn slack_google_stripe_and_api_keys() {
        let t = format!("{}{}", join(&["xo", "xb-"]), tail("0123456789abcdef-", 24));
        assert_eq!(kind(&t), Some("slack-token"));
        let t = format!(
            "{}{}",
            join(&["AI", "za"]),
            tail("aB3dE5fG7hJ9kLmN2pQrS4tUvW6x-_", 35)
        );
        assert_eq!(kind(&t), Some("google-api-key"));
        let t = format!("{}{}", join(&["sk", "_live_"]), tail(ALNUM, 26));
        assert_eq!(kind(&t), Some("stripe-key"));
        let t = format!(
            "key={}{}",
            join(&["s", "k-"]),
            tail("aB3dE5fG7hJ9kLmN2pQrS4tUvW6x-_", 40)
        );
        assert_eq!(kind(&t), Some("api-key"));
        // Prose that merely mentions the prefix.
        assert_eq!(
            kind("use a key that starts with sk- and keep it safe"),
            None
        );
    }

    #[test]
    fn jwt() {
        let seg = |n: usize| format!("{}{}", join(&["ey", "J"]), tail(ALNUM, n));
        let t = format!("{}.{}.{}", seg(20), seg(24), tail(ALNUM, 20));
        assert_eq!(kind(&t), Some("jwt"));
        assert_eq!(kind(&format!("{}.{}", seg(20), seg(24))), None);
    }

    #[test]
    fn credential_assignment_needs_a_random_looking_value() {
        let value = tail("aB3dE5fG7hJ9kLmN2pQrS4tUvW6xYz01+/", 32);
        let t = format!("{} = \"{}\"", join(&["pass", "word"]), value);
        assert_eq!(kind(&t), Some("credential-assignment"));
        let t = format!("{{\"{}\": \"{}\"}}", join(&["api_", "key"]), value);
        assert_eq!(kind(&t), Some("credential-assignment"));
        // Low entropy, placeholder, short, and env-lookups are not secrets.
        assert_eq!(
            kind(&format!(
                "{} = \"aaaaaaaaaaaaaaaaaaaaaaaa\"",
                join(&["pass", "word"])
            )),
            None
        );
        assert_eq!(
            kind(&format!(
                "{} = \"your-password-here-please\"",
                join(&["pass", "word"])
            )),
            None
        );
        assert_eq!(
            kind(&format!("{} = \"short\"", join(&["pass", "word"]))),
            None
        );
        assert_eq!(
            kind(&format!("{} = process.env.{}", join(&["tok", "en"]), "X")),
            None
        );
    }

    #[test]
    fn ordinary_code_and_prose_pass() {
        let code =
            "fn main() {\n    let token_count = 3;\n    println!(\"hello {}\", token_count);\n}\n";
        assert_eq!(kind(code), None);
        assert_eq!(
            kind("# Setup\n\nRun `npm install` then `npm test`.\n"),
            None
        );
        assert_eq!(kind(""), None);
    }

    #[test]
    fn a_finding_never_carries_the_matched_text() {
        let secret = format!("{}{}", join(&["gh", "p_"]), tail(ALNUM, 36));
        let f = scan(secret.as_bytes()).unwrap();
        assert!(!format!("{f:?}").contains(&secret));
    }

    #[test]
    fn binary_data_does_not_panic() {
        let bytes: Vec<u8> = (0..=255u8).cycle().take(4096).collect();
        let _ = scan(&bytes);
        let _ = scan(&[]);
        let _ = scan(b"eyJ");
        let _ = scan(b"-----BEGIN ");
    }
}
