//! A minimal order-preserving JSON model, used to edit a user's `.mcp.json` and
//! `.claude/settings.json` without reordering or re-escaping anything virage did not write.
//!
//! `serde_json`'s default map sorts keys, so a round trip through `serde_json::Value` would
//! rewrite the whole file in alphabetical order. This model keeps object keys in file order and
//! keeps scalars and strings exactly as written; only the container structure is editable.
//! Output uses two-space indentation, matching `JSON.stringify(value, null, 2)`.

#[derive(Debug, Clone, PartialEq)]
pub enum OJson {
    /// `null`, `true`, `false` or a number, as written.
    Scalar(String),
    /// A string as written, including its quotes (escapes untouched).
    Str(String),
    Array(Vec<OJson>),
    /// Keys are kept as written, including quotes.
    Object(Vec<(String, OJson)>),
}

/// The input is not a JSON document this model can represent.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ParseError;

const MAX_DEPTH: usize = 128;

struct Parser<'a> {
    s: &'a str,
    i: usize,
}

impl<'a> Parser<'a> {
    fn bytes(&self) -> &'a [u8] {
        self.s.as_bytes()
    }

    fn peek(&self) -> Option<u8> {
        self.bytes().get(self.i).copied()
    }

    fn skip_ws(&mut self) {
        while matches!(self.peek(), Some(b' ' | b'\t' | b'\n' | b'\r')) {
            self.i += 1;
        }
    }

    fn string(&mut self) -> Result<String, ParseError> {
        let start = self.i;
        self.i += 1; // opening quote
        loop {
            match self.peek() {
                None => return Err(ParseError),
                Some(b'\\') => self.i += 2,
                Some(b'"') => {
                    self.i += 1;
                    return self
                        .s
                        .get(start..self.i)
                        .map(str::to_string)
                        .ok_or(ParseError);
                }
                Some(_) => self.i += 1,
            }
        }
    }

    fn scalar(&mut self) -> Result<OJson, ParseError> {
        let start = self.i;
        while let Some(b) = self.peek() {
            if matches!(b, b',' | b'}' | b']' | b' ' | b'\t' | b'\n' | b'\r') {
                break;
            }
            self.i += 1;
        }
        let token = self.s.get(start..self.i).ok_or(ParseError)?;
        match serde_json::from_str::<serde_json::Value>(token) {
            Ok(
                serde_json::Value::Null | serde_json::Value::Bool(_) | serde_json::Value::Number(_),
            ) => Ok(OJson::Scalar(token.to_string())),
            _ => Err(ParseError),
        }
    }

    fn value(&mut self, depth: usize) -> Result<OJson, ParseError> {
        if depth > MAX_DEPTH {
            return Err(ParseError);
        }
        self.skip_ws();
        match self.peek().ok_or(ParseError)? {
            b'{' => {
                self.i += 1;
                let mut fields = Vec::new();
                self.skip_ws();
                if self.peek() == Some(b'}') {
                    self.i += 1;
                    return Ok(OJson::Object(fields));
                }
                loop {
                    self.skip_ws();
                    if self.peek() != Some(b'"') {
                        return Err(ParseError);
                    }
                    let key = self.string()?;
                    self.skip_ws();
                    if self.peek() != Some(b':') {
                        return Err(ParseError);
                    }
                    self.i += 1;
                    let v = self.value(depth + 1)?;
                    fields.push((key, v));
                    self.skip_ws();
                    match self.peek() {
                        Some(b',') => self.i += 1,
                        Some(b'}') => {
                            self.i += 1;
                            return Ok(OJson::Object(fields));
                        }
                        _ => return Err(ParseError),
                    }
                }
            }
            b'[' => {
                self.i += 1;
                let mut items = Vec::new();
                self.skip_ws();
                if self.peek() == Some(b']') {
                    self.i += 1;
                    return Ok(OJson::Array(items));
                }
                loop {
                    items.push(self.value(depth + 1)?);
                    self.skip_ws();
                    match self.peek() {
                        Some(b',') => self.i += 1,
                        Some(b']') => {
                            self.i += 1;
                            return Ok(OJson::Array(items));
                        }
                        _ => return Err(ParseError),
                    }
                }
            }
            b'"' => Ok(OJson::Str(self.string()?)),
            _ => self.scalar(),
        }
    }
}

/// Parse a complete JSON document.
pub fn parse(text: &str) -> Result<OJson, ParseError> {
    let mut p = Parser { s: text, i: 0 };
    let v = p.value(0)?;
    p.skip_ws();
    if p.i == text.len() {
        Ok(v)
    } else {
        Err(ParseError)
    }
}

fn write(v: &OJson, level: usize, out: &mut String) {
    let pad = |n: usize| "  ".repeat(n);
    match v {
        OJson::Scalar(s) | OJson::Str(s) => out.push_str(s),
        OJson::Array(items) if items.is_empty() => out.push_str("[]"),
        OJson::Array(items) => {
            out.push_str("[\n");
            for (n, item) in items.iter().enumerate() {
                out.push_str(&pad(level + 1));
                write(item, level + 1, out);
                out.push_str(if n + 1 < items.len() { ",\n" } else { "\n" });
            }
            out.push_str(&pad(level));
            out.push(']');
        }
        OJson::Object(fields) if fields.is_empty() => out.push_str("{}"),
        OJson::Object(fields) => {
            out.push_str("{\n");
            for (n, (key, value)) in fields.iter().enumerate() {
                out.push_str(&pad(level + 1));
                out.push_str(key);
                out.push_str(": ");
                write(value, level + 1, out);
                out.push_str(if n + 1 < fields.len() { ",\n" } else { "\n" });
            }
            out.push_str(&pad(level));
            out.push('}');
        }
    }
}

/// Two-space-indented JSON (no trailing newline).
pub fn to_pretty(v: &OJson) -> String {
    let mut out = String::new();
    write(v, 0, &mut out);
    out
}

/// Does the object key `raw` (as written, with quotes) equal `name`?
pub fn key_is(raw: &str, name: &str) -> bool {
    raw.len() == name.len() + 2 && &raw[1..raw.len() - 1] == name
}

/// The decoded value of a string node.
pub fn string_value(v: &OJson) -> Option<String> {
    match v {
        OJson::Str(raw) => serde_json::from_str::<String>(raw).ok(),
        _ => None,
    }
}

/// The value stored under `name` in an object node.
pub fn get<'a>(v: &'a OJson, name: &str) -> Option<&'a OJson> {
    match v {
        OJson::Object(fields) => fields.iter().find(|(k, _)| key_is(k, name)).map(|(_, v)| v),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_keeps_order_and_scalars() {
        let src = r#"{"z":1,"a":{"y":[1,2.5e3,true,null,"s\"qé"],"b":{}},"e":[]}"#;
        let v = parse(src).unwrap();
        let pretty = to_pretty(&v);
        // Same document, same key order, strings untouched.
        assert_eq!(parse(&pretty).unwrap(), v);
        assert!(pretty.find("\"z\"").unwrap() < pretty.find("\"a\"").unwrap());
        assert!(pretty.contains(r#""s\"qé""#));
        assert!(pretty.contains("2.5e3"));
        assert!(pretty.contains("\"e\": []"));
        assert!(pretty.contains("\"b\": {}"));
    }

    #[test]
    fn pretty_matches_two_space_json_stringify() {
        let v = parse(r#"{"a":[1,{"b":2}],"c":"d"}"#).unwrap();
        assert_eq!(
            to_pretty(&v),
            "{\n  \"a\": [\n    1,\n    {\n      \"b\": 2\n    }\n  ],\n  \"c\": \"d\"\n}"
        );
    }

    #[test]
    fn accepts_whitespace_and_rejects_garbage() {
        assert!(parse(" \n{ \"a\" : [ 1 , 2 ] }\n").is_ok());
        for bad in [
            "",
            "{",
            "{\"a\":}",
            "[1,]",
            "{a:1}",
            "{\"a\":1} x",
            "nul",
            "\"open",
            "[1 2]",
        ] {
            assert!(parse(bad).is_err(), "{bad:?} should not parse");
        }
        let deep = format!("{}{}", "[".repeat(200), "]".repeat(200));
        assert!(parse(&deep).is_err());
    }

    #[test]
    fn helpers_read_keys_and_strings() {
        let v = parse(r#"{"command":"a\"b","n":1}"#).unwrap();
        assert_eq!(
            string_value(get(&v, "command").unwrap()).as_deref(),
            Some("a\"b")
        );
        assert!(get(&v, "n").is_some());
        assert!(string_value(get(&v, "n").unwrap()).is_none());
        assert!(get(&v, "missing").is_none());
        assert!(key_is("\"hooks\"", "hooks"));
        assert!(!key_is("\"hook\"", "hooks"));
    }
}
