//! Remove the host registrations virage wrote, for `virage uninstall`:
//!
//! - the `virage` entry (and the older `virage-agent` name) in `.mcp.json`;
//! - the hooks virage wrote to `.claude/settings.json` (the `inject-context` UserPromptSubmit hook
//!   and anything carrying virage's `[Virage]` marker);
//! - the retrieval declaration `.go-getter/retrieval/virage.json`.
//!
//! Only virage's own entries are touched: every other server, hook and key stays, in place and in
//! order (files are edited through [`super::ordered_json`], not `serde_json::Value`, which would
//! sort keys). A file that cannot be parsed is left alone. Mirrors
//! `packages/virage-core/src/host-config-cleanup.ts`.

use std::path::Path;

use super::declaration_path;
use super::ordered_json::{get, key_is, parse, string_value, to_pretty, OJson};

/// Names virage has registered its MCP server under.
const MCP_NAMES: [&str; 2] = ["virage", "virage-agent"];

/// Marker virage puts in the command or status message of hooks it manages.
const HOOK_MARKER: &str = "[Virage]";

#[derive(Debug, Default, PartialEq, Eq)]
pub struct Removal {
    /// MCP server names removed from `.mcp.json`.
    pub mcp_entries: Vec<String>,
    /// Hook entries removed from `.claude/settings.json`.
    pub hooks: usize,
    /// Whether `.go-getter/retrieval/virage.json` was (or would be) removed.
    pub declaration: bool,
    /// Project-relative files that exist but could not be parsed (left untouched).
    pub unreadable: Vec<&'static str>,
}

impl Removal {
    pub fn is_empty(&self) -> bool {
        self.mcp_entries.is_empty() && self.hooks == 0 && !self.declaration
    }
}

/// Is this hook entry one virage wrote?
pub fn is_virage_hook(hook: &OJson) -> bool {
    if !matches!(hook, OJson::Object(_)) {
        return false;
    }
    let text = |name: &str| get(hook, name).and_then(string_value).unwrap_or_default();
    let command = text("command");
    let message = text("statusMessage");
    command.contains(HOOK_MARKER)
        || message.contains(HOOK_MARKER)
        || (command.contains("inject-context") && command.contains("virage"))
}

/// Remove virage's MCP servers from a parsed `.mcp.json`. Returns the names removed.
pub fn strip_mcp_entries(root: &mut OJson) -> Vec<String> {
    let OJson::Object(top) = root else {
        return Vec::new();
    };
    let Some(idx) = top.iter().position(|(k, _)| key_is(k, "mcpServers")) else {
        return Vec::new();
    };
    let mut removed = Vec::new();
    let mut now_empty = false;
    if let OJson::Object(servers) = &mut top[idx].1 {
        for name in MCP_NAMES {
            if let Some(pos) = servers.iter().position(|(k, _)| key_is(k, name)) {
                servers.remove(pos);
                removed.push(name.to_string());
            }
        }
        now_empty = !removed.is_empty() && servers.is_empty();
    }
    if now_empty {
        top.remove(idx);
    }
    removed
}

/// Remove virage's hooks from parsed Claude Code settings. Returns how many hook entries were
/// removed. Containers emptied by the removal are pruned; everything else is left as it was.
pub fn strip_virage_hooks(root: &mut OJson) -> usize {
    let OJson::Object(top) = root else {
        return 0;
    };
    let Some(idx) = top.iter().position(|(k, _)| key_is(k, "hooks")) else {
        return 0;
    };
    let mut removed = 0;
    let mut hooks_now_empty = false;
    if let OJson::Object(events) = &mut top[idx].1 {
        let mut e = 0;
        while e < events.len() {
            let mut event_now_empty = false;
            if let OJson::Array(matchers) = &mut events[e].1 {
                let mut changed = false;
                let mut m = 0;
                while m < matchers.len() {
                    let mut drop_matcher = false;
                    if let OJson::Object(fields) = &mut matchers[m] {
                        if let Some(pos) = fields.iter().position(|(k, _)| key_is(k, "hooks")) {
                            if let OJson::Array(list) = &mut fields[pos].1 {
                                let before = list.len();
                                list.retain(|h| !is_virage_hook(h));
                                let dropped = before - list.len();
                                if dropped > 0 {
                                    removed += dropped;
                                    changed = true;
                                    drop_matcher = list.is_empty();
                                }
                            }
                        }
                    }
                    if drop_matcher {
                        matchers.remove(m);
                    } else {
                        m += 1;
                    }
                }
                event_now_empty = changed && matchers.is_empty();
            }
            if event_now_empty {
                events.remove(e);
            } else {
                e += 1;
            }
        }
        hooks_now_empty = removed > 0 && events.is_empty();
    }
    if hooks_now_empty {
        top.remove(idx);
    }
    removed
}

enum Loaded {
    Missing,
    Unreadable,
    Doc(OJson),
}

fn load(path: &Path) -> Loaded {
    match std::fs::read_to_string(path) {
        Err(_) if !path.exists() => Loaded::Missing,
        Err(_) => Loaded::Unreadable,
        Ok(text) => match parse(&text) {
            Ok(doc @ OJson::Object(_)) => Loaded::Doc(doc),
            _ => Loaded::Unreadable,
        },
    }
}

fn save(path: &Path, doc: &OJson) -> std::io::Result<()> {
    let mut text = to_pretty(doc);
    text.push('\n');
    std::fs::write(path, text)
}

/// Remove virage's host registrations from a project. With `dry_run` nothing is written; the
/// result says what would be removed.
pub fn remove_host_registrations(project_dir: &Path, dry_run: bool) -> std::io::Result<Removal> {
    let mut result = Removal::default();

    let mcp_path = project_dir.join(".mcp.json");
    match load(&mcp_path) {
        Loaded::Missing => {}
        Loaded::Unreadable => result.unreadable.push(".mcp.json"),
        Loaded::Doc(mut doc) => {
            result.mcp_entries = strip_mcp_entries(&mut doc);
            if !result.mcp_entries.is_empty() && !dry_run {
                save(&mcp_path, &doc)?;
            }
        }
    }

    let settings_path = project_dir.join(".claude").join("settings.json");
    match load(&settings_path) {
        Loaded::Missing => {}
        Loaded::Unreadable => result.unreadable.push(".claude/settings.json"),
        Loaded::Doc(mut doc) => {
            result.hooks = strip_virage_hooks(&mut doc);
            if result.hooks > 0 && !dry_run {
                save(&settings_path, &doc)?;
            }
        }
    }

    let declaration = declaration_path(project_dir);
    if declaration.exists() {
        result.declaration = true;
        if !dry_run {
            std::fs::remove_file(&declaration)?;
        }
    }

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    const VIRAGE_HOOK: &str = r#"{"type":"command","command":"prompt=$(cat); npx --yes @vivantel/virage-agent-claude inject-context \"$prompt\" || true","statusMessage":"[Virage] Loading context..."}"#;
    const OTHER_HOOK: &str = r#"{"type":"command","command":"echo mine"}"#;

    fn doc(s: &str) -> OJson {
        parse(s).unwrap()
    }

    fn tmp(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "virage-host-config-{name}-{}-{}",
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
    fn recognises_virage_hooks_only() {
        assert!(is_virage_hook(&doc(VIRAGE_HOOK)));
        assert!(is_virage_hook(&doc(r#"{"command":"x [Virage] y"}"#)));
        assert!(is_virage_hook(&doc(
            r#"{"command":"npx virage-agent-claude inject-context"}"#
        )));
        assert!(!is_virage_hook(&doc(OTHER_HOOK)));
        assert!(!is_virage_hook(&doc(r#"{"command":"inject-context"}"#)));
        assert!(!is_virage_hook(&doc("5")));
    }

    #[test]
    fn mcp_entries_removed_others_kept_in_order() {
        let mut d = doc(
            r#"{"mcpServers":{"zeta":{"command":"z"},"virage":{"command":"npx"},"alpha":{},"virage-agent":{}},"keep":1}"#,
        );
        assert_eq!(strip_mcp_entries(&mut d), vec!["virage", "virage-agent"]);
        let out = to_pretty(&d);
        assert!(out.find("zeta").unwrap() < out.find("alpha").unwrap());
        assert!(!out.contains("virage"));
        assert!(out.contains("\"keep\": 1"));
    }

    #[test]
    fn emptied_mcp_servers_is_pruned() {
        let mut d = doc(r#"{"mcpServers":{"virage":{}},"keep":1}"#);
        assert_eq!(strip_mcp_entries(&mut d), vec!["virage"]);
        assert_eq!(to_pretty(&d), "{\n  \"keep\": 1\n}");
        let mut none = doc(r#"{"mcpServers":{"other":{}}}"#);
        assert!(strip_mcp_entries(&mut none).is_empty());
        assert!(strip_mcp_entries(&mut doc("{}")).is_empty());
    }

    #[test]
    fn hooks_removed_and_emptied_containers_pruned() {
        let mut d = doc(&format!(
            r#"{{"hooks":{{"UserPromptSubmit":[{{"hooks":[{VIRAGE_HOOK}]}}]}},"permissions":{{"allow":["Bash(ls)"]}}}}"#
        ));
        assert_eq!(strip_virage_hooks(&mut d), 1);
        let out = to_pretty(&d);
        assert!(!out.contains("hooks"));
        assert!(out.contains("Bash(ls)"));
    }

    #[test]
    fn other_hooks_are_kept() {
        let mut d = doc(&format!(
            r#"{{"hooks":{{"UserPromptSubmit":[{{"hooks":[{OTHER_HOOK},{VIRAGE_HOOK}]}},{{"hooks":[{OTHER_HOOK}]}}],"PreToolUse":[{{"matcher":"Bash","hooks":[{OTHER_HOOK}]}}]}}}}"#
        ));
        assert_eq!(strip_virage_hooks(&mut d), 1);
        let out = to_pretty(&d);
        assert_eq!(out.matches("echo mine").count(), 3);
        assert!(!out.contains("Virage"));
        assert!(out.contains("\"matcher\": \"Bash\""));
    }

    #[test]
    fn unrelated_and_malformed_shapes_are_left_alone() {
        let src = r#"{"hooks":{"Stop":"not-an-array","PreToolUse":[{"matcher":"x"},5]}}"#;
        let mut d = doc(src);
        let before = to_pretty(&d);
        assert_eq!(strip_virage_hooks(&mut d), 0);
        assert_eq!(to_pretty(&d), before);
        assert_eq!(strip_virage_hooks(&mut doc("{}")), 0);
        assert_eq!(strip_virage_hooks(&mut doc("[]")), 0);
    }

    #[test]
    fn removes_all_three_from_a_project() {
        let dir = tmp("all");
        std::fs::write(
            dir.join(".mcp.json"),
            r#"{"mcpServers":{"zeta":{"command":"z"},"virage":{"command":"npx"}}}"#,
        )
        .unwrap();
        std::fs::create_dir_all(dir.join(".claude")).unwrap();
        std::fs::write(
            dir.join(".claude/settings.json"),
            format!(r#"{{"env":{{"A":"1"}},"hooks":{{"UserPromptSubmit":[{{"hooks":[{VIRAGE_HOOK}]}}]}}}}"#),
        )
        .unwrap();
        super::super::write_declaration(&dir, "1.0.0").unwrap();

        let dry = remove_host_registrations(&dir, true).unwrap();
        assert_eq!(dry.mcp_entries, vec!["virage"]);
        assert_eq!(dry.hooks, 1);
        assert!(dry.declaration);
        assert!(declaration_path(&dir).exists(), "dry run must not delete");

        let done = remove_host_registrations(&dir, false).unwrap();
        assert_eq!(done, dry);
        let mcp = std::fs::read_to_string(dir.join(".mcp.json")).unwrap();
        assert!(mcp.contains("zeta") && !mcp.contains("virage"));
        let settings = std::fs::read_to_string(dir.join(".claude/settings.json")).unwrap();
        assert!(settings.contains("\"A\": \"1\"") && !settings.contains("hooks"));
        assert!(!declaration_path(&dir).exists());

        // Idempotent.
        assert!(remove_host_registrations(&dir, false).unwrap().is_empty());
    }

    #[test]
    fn unparseable_files_are_untouched_and_reported() {
        let dir = tmp("bad");
        std::fs::write(dir.join(".mcp.json"), "{ not json").unwrap();
        let r = remove_host_registrations(&dir, false).unwrap();
        assert_eq!(r.unreadable, vec![".mcp.json"]);
        assert_eq!(
            std::fs::read_to_string(dir.join(".mcp.json")).unwrap(),
            "{ not json"
        );
    }

    #[test]
    fn another_tools_declaration_is_not_touched() {
        let dir = tmp("other");
        std::fs::create_dir_all(dir.join(".go-getter/retrieval")).unwrap();
        let other = dir.join(".go-getter/retrieval/other-tool.json");
        std::fs::write(&other, "{}").unwrap();
        remove_host_registrations(&dir, false).unwrap();
        assert!(other.exists());
    }

    #[test]
    fn a_bare_project_is_a_no_op() {
        assert!(remove_host_registrations(&tmp("bare"), false)
            .unwrap()
            .is_empty());
    }
}
