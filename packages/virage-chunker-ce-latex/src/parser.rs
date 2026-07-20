use virage_vidoc::{DocNode, DocNodeAttrs, DocNodeType};

/// Parse LaTeX source into a ViDoc DocNode tree.
///
/// Strategy:
/// - Pre-scan preamble (before `\begin{document}`) for `\title`, `\author`.
/// - Parse body inside `\begin{document}...\end{document}` (or whole file if absent).
/// - Sectioning commands → heading nodes (chapter=1, section=2, subsection=3, …).
/// - `verbatim` / `lstlisting` environments → code nodes.
/// - `equation` / `align` / `$$` / `$` → formula nodes.
/// - `tabular` → table / table-row / table-cell nodes.
/// - Blank lines → paragraph boundary.
/// - Byte offsets are exact (byte position in the UTF-8 source string).
pub fn parse(src: &str) -> Result<DocNode, Box<dyn std::error::Error>> {
    let mut p = Parser::new(src);
    Ok(p.parse())
}

struct Parser<'a> {
    src: &'a str,
    /// Current byte position within `src`.
    pos: usize,
    title: Option<String>,
    author: Option<String>,
}

impl<'a> Parser<'a> {
    fn new(src: &'a str) -> Self {
        Self {
            src,
            pos: 0,
            title: None,
            author: None,
        }
    }

    // ──── low-level helpers ────────────────────────────────────────────────

    fn remaining(&self) -> &'a str {
        &self.src[self.pos..]
    }

    fn peek(&self) -> Option<char> {
        self.remaining().chars().next()
    }

    fn starts_with(&self, s: &str) -> bool {
        self.remaining().starts_with(s)
    }

    fn advance_char(&mut self) -> Option<char> {
        let c = self.remaining().chars().next()?;
        self.pos += c.len_utf8();
        Some(c)
    }

    fn advance_bytes(&mut self, n: usize) {
        self.pos += n;
    }

    /// Skip a `%` comment to end of line (caller has already consumed `%`).
    fn skip_comment_body(&mut self) {
        while let Some(c) = self.advance_char() {
            if c == '\n' {
                break;
            }
        }
    }

    fn skip_inline_whitespace(&mut self) {
        while matches!(self.peek(), Some(' ') | Some('\t')) {
            self.advance_char();
        }
    }

    /// Read a LaTeX command name after the leading `\` has been consumed.
    /// Returns the name (alphabetic run) or a single special character.
    fn read_command_name(&mut self) -> String {
        let mut name = String::new();
        match self.peek() {
            Some(c) if c.is_alphabetic() => {
                while matches!(self.peek(), Some(c) if c.is_alphabetic()) {
                    name.push(self.advance_char().unwrap());
                }
                // Consume optional trailing whitespace after alphabetic command.
                self.skip_inline_whitespace();
            }
            Some(c) => {
                name.push(c);
                self.advance_char();
            }
            None => {}
        }
        name
    }

    /// Read a required `{...}` argument; returns the inner text with commands stripped.
    fn read_braced_arg(&mut self) -> String {
        self.skip_inline_whitespace();
        if self.peek() != Some('{') {
            return String::new();
        }
        self.advance_char(); // consume '{'
        let mut depth = 1usize;
        let mut content = String::new();
        while self.pos < self.src.len() && depth > 0 {
            match self.peek() {
                Some('{') => {
                    self.advance_char();
                    depth += 1;
                    content.push('{');
                }
                Some('}') => {
                    self.advance_char();
                    depth -= 1;
                    if depth > 0 {
                        content.push('}');
                    }
                }
                Some('%') => {
                    self.advance_char();
                    self.skip_comment_body();
                }
                Some('\\') => {
                    self.advance_char();
                    let cmd = self.read_command_name();
                    match cmd.as_str() {
                        "{" => content.push('{'),
                        "}" => content.push('}'),
                        "%" => content.push('%'),
                        // Formatting commands: include their argument text.
                        "textbf" | "textit" | "texttt" | "emph" | "text" => {
                            let inner = self.read_braced_arg();
                            content.push_str(&inner);
                        }
                        _ => {} // skip other commands inside args
                    }
                }
                Some(c) => {
                    content.push(c);
                    self.advance_char();
                }
                None => break,
            }
        }
        content.trim().to_owned()
    }

    /// Read an optional `[...]` argument. Returns `None` if `[` not next.
    fn read_optional_arg(&mut self) -> Option<String> {
        self.skip_inline_whitespace();
        if self.peek() != Some('[') {
            return None;
        }
        self.advance_char(); // consume '['
        let mut depth = 1usize;
        let mut content = String::new();
        while self.pos < self.src.len() && depth > 0 {
            match self.peek() {
                Some('[') => {
                    depth += 1;
                    content.push('[');
                    self.advance_char();
                }
                Some(']') => {
                    depth -= 1;
                    self.advance_char();
                    if depth > 0 {
                        content.push(']');
                    }
                }
                Some(c) => {
                    content.push(c);
                    self.advance_char();
                }
                None => break,
            }
        }
        Some(content)
    }

    /// Read the body of an environment verbatim until `\end{env_name}`.
    fn read_env_body_verbatim(&mut self, env_name: &str) -> String {
        let end_marker = format!("\\end{{{}}}", env_name);
        let mut body = String::new();
        while self.pos < self.src.len() {
            if self.starts_with(&end_marker) {
                self.advance_bytes(end_marker.len());
                break;
            }
            body.push(self.advance_char().unwrap());
        }
        body
    }

    // ──── pre-scan ────────────────────────────────────────────────────────

    /// Extract `\title` and `\author` from the preamble without advancing `self.pos`.
    fn prescan_metadata(&mut self) {
        let preamble_end = self.src.find("\\begin{document}").unwrap_or(self.src.len());
        let preamble = &self.src[..preamble_end];
        self.title = extract_command_arg(preamble, "title");
        self.author = extract_command_arg(preamble, "author");
    }

    // ──── main parse ──────────────────────────────────────────────────────

    fn parse(&mut self) -> DocNode {
        let src_len = self.src.len();

        self.prescan_metadata();

        // Seek to \begin{document} if present; treat whole file otherwise.
        let begin_doc = "\\begin{document}";
        if let Some(idx) = self.src.find(begin_doc) {
            self.pos = idx + begin_doc.len();
            // Consume the newline right after \begin{document}.
            if self.peek() == Some('\n') {
                self.advance_char();
            }
        }

        let mut children: Vec<DocNode> = Vec::new();

        // Metadata node (title / author) prepended to children.
        if self.title.is_some() || self.author.is_some() {
            let mut meta_parts = Vec::new();
            if let Some(t) = &self.title {
                meta_parts.push(format!("title: {}", t));
            }
            if let Some(a) = &self.author {
                meta_parts.push(format!("author: {}", a));
            }
            children.push(DocNode {
                node_type: DocNodeType::Metadata,
                text: Some(meta_parts.join("\n")),
                children: None,
                attrs: DocNodeAttrs {
                    byte_start: 0,
                    byte_end: src_len as u64,
                    ..Default::default()
                },
            });
        }

        let mut para_buf = String::new();
        let mut para_start = self.pos as u64;

        while self.pos < src_len {
            if self.starts_with("\\end{document}") {
                break;
            }

            match self.peek() {
                // ── comment ──────────────────────────────────────────────
                Some('%') => {
                    self.advance_char();
                    self.skip_comment_body();
                }

                // ── display math $$...$$  ─────────────────────────────
                Some('$') if self.starts_with("$$") => {
                    if let Some(n) = flush_para(&mut para_buf, &mut para_start, self.pos as u64) {
                        children.push(n);
                    }
                    let bs = self.pos as u64;
                    self.advance_bytes(2); // consume $$
                    let body = read_until_str(&mut self.pos, self.src, "$$");
                    children.push(DocNode {
                        node_type: DocNodeType::Formula,
                        text: Some(body.trim().to_owned()),
                        children: None,
                        attrs: DocNodeAttrs {
                            byte_start: bs,
                            byte_end: self.pos as u64,
                            ..Default::default()
                        },
                    });
                    para_start = self.pos as u64;
                }

                // ── inline math $...$ ─────────────────────────────────
                Some('$') => {
                    self.advance_char(); // consume $
                    let body = read_until_str(&mut self.pos, self.src, "$");
                    // Very short inline math (< 60 chars) → fold into paragraph text.
                    if body.len() < 60 {
                        para_buf.push('$');
                        para_buf.push_str(&body);
                        para_buf.push('$');
                    } else {
                        if let Some(n) = flush_para(&mut para_buf, &mut para_start, self.pos as u64)
                        {
                            children.push(n);
                        }
                        children.push(DocNode {
                            node_type: DocNodeType::Formula,
                            text: Some(body.trim().to_owned()),
                            children: None,
                            attrs: DocNodeAttrs {
                                byte_start: self.pos as u64 - body.len() as u64 - 2,
                                byte_end: self.pos as u64,
                                ..Default::default()
                            },
                        });
                        para_start = self.pos as u64;
                    }
                }

                // ── LaTeX command ─────────────────────────────────────
                Some('\\') => {
                    self.advance_char(); // consume '\'
                    let cmd_start = (self.pos - 1) as u64;
                    let name = self.read_command_name();

                    match name.as_str() {
                        // ── line breaks ─────────────────────────────
                        "\\" | "newline" => {
                            if !para_buf.ends_with(' ') {
                                para_buf.push(' ');
                            }
                        }

                        // ── sectioning ──────────────────────────────
                        "chapter" | "chapter*" => {
                            self.read_optional_arg();
                            if let Some(n) = flush_para(&mut para_buf, &mut para_start, cmd_start) {
                                children.push(n);
                            }
                            let title = self.read_braced_arg();
                            let be = self.pos as u64;
                            children.push(make_heading(title, 1, cmd_start, be));
                            para_start = be;
                        }
                        "section" | "section*" => {
                            self.read_optional_arg();
                            if let Some(n) = flush_para(&mut para_buf, &mut para_start, cmd_start) {
                                children.push(n);
                            }
                            let title = self.read_braced_arg();
                            let be = self.pos as u64;
                            children.push(make_heading(title, 2, cmd_start, be));
                            para_start = be;
                        }
                        "subsection" | "subsection*" => {
                            self.read_optional_arg();
                            if let Some(n) = flush_para(&mut para_buf, &mut para_start, cmd_start) {
                                children.push(n);
                            }
                            let title = self.read_braced_arg();
                            let be = self.pos as u64;
                            children.push(make_heading(title, 3, cmd_start, be));
                            para_start = be;
                        }
                        "subsubsection" | "subsubsection*" => {
                            self.read_optional_arg();
                            if let Some(n) = flush_para(&mut para_buf, &mut para_start, cmd_start) {
                                children.push(n);
                            }
                            let title = self.read_braced_arg();
                            let be = self.pos as u64;
                            children.push(make_heading(title, 4, cmd_start, be));
                            para_start = be;
                        }
                        "paragraph" | "paragraph*" => {
                            self.read_optional_arg();
                            if let Some(n) = flush_para(&mut para_buf, &mut para_start, cmd_start) {
                                children.push(n);
                            }
                            let title = self.read_braced_arg();
                            let be = self.pos as u64;
                            children.push(make_heading(title, 5, cmd_start, be));
                            para_start = be;
                        }
                        "subparagraph" | "subparagraph*" => {
                            self.read_optional_arg();
                            if let Some(n) = flush_para(&mut para_buf, &mut para_start, cmd_start) {
                                children.push(n);
                            }
                            let title = self.read_braced_arg();
                            let be = self.pos as u64;
                            children.push(make_heading(title, 6, cmd_start, be));
                            para_start = be;
                        }

                        // ── begin{env} ──────────────────────────────
                        "begin" => {
                            if let Some(n) = flush_para(&mut para_buf, &mut para_start, cmd_start) {
                                children.push(n);
                            }
                            let env = self.read_braced_arg();
                            let opt = self.read_optional_arg();

                            match env.as_str() {
                                // ── verbatim code ───────────────────
                                "verbatim" | "Verbatim" => {
                                    if self.peek() == Some('\n') {
                                        self.advance_char();
                                    }
                                    let body = self.read_env_body_verbatim(&env);
                                    let be = self.pos as u64;
                                    children.push(DocNode {
                                        node_type: DocNodeType::Code,
                                        text: Some(body.trim_end_matches('\n').to_owned()),
                                        children: None,
                                        attrs: DocNodeAttrs {
                                            byte_start: cmd_start,
                                            byte_end: be,
                                            ..Default::default()
                                        },
                                    });
                                }
                                "lstlisting" | "minted" => {
                                    let lang = opt
                                        .as_deref()
                                        .and_then(extract_listing_language)
                                        .map(str::to_owned);
                                    if self.peek() == Some('\n') {
                                        self.advance_char();
                                    }
                                    let body = self.read_env_body_verbatim(&env);
                                    let be = self.pos as u64;
                                    children.push(DocNode {
                                        node_type: DocNodeType::Code,
                                        text: Some(body.trim_end_matches('\n').to_owned()),
                                        children: None,
                                        attrs: DocNodeAttrs {
                                            byte_start: cmd_start,
                                            byte_end: be,
                                            code_language: lang,
                                            ..Default::default()
                                        },
                                    });
                                }

                                // ── display math environments ────────
                                "equation" | "equation*" | "align" | "align*" | "gather"
                                | "gather*" | "multline" | "multline*" | "eqnarray"
                                | "eqnarray*" | "math" => {
                                    let body = self.read_env_body_verbatim(&env);
                                    let be = self.pos as u64;
                                    children.push(DocNode {
                                        node_type: DocNodeType::Formula,
                                        text: Some(body.trim().to_owned()),
                                        children: None,
                                        attrs: DocNodeAttrs {
                                            byte_start: cmd_start,
                                            byte_end: be,
                                            ..Default::default()
                                        },
                                    });
                                }

                                // ── table environments ───────────────
                                "tabular" | "tabularx" | "longtable" | "array" => {
                                    self.read_braced_arg(); // column spec {lcr...}
                                    let body = self.read_env_body_verbatim(&env);
                                    let be = self.pos as u64;
                                    children.push(parse_tabular(&body, cmd_start, be));
                                }

                                // ── abstract ────────────────────────
                                "abstract" => {
                                    let body = self.read_env_body_verbatim(&env);
                                    let be = self.pos as u64;
                                    let text = collapse_whitespace(&body);
                                    if !text.is_empty() {
                                        children.push(DocNode {
                                            node_type: DocNodeType::Abstract,
                                            text: Some(text),
                                            children: None,
                                            attrs: DocNodeAttrs {
                                                byte_start: cmd_start,
                                                byte_end: be,
                                                ..Default::default()
                                            },
                                        });
                                    }
                                }

                                // ── figure / table float ─────────────
                                "figure" | "figure*" | "table" | "table*" | "wrapfigure" => {
                                    let body = self.read_env_body_verbatim(&env);
                                    let be = self.pos as u64;
                                    if let Some(cap) = extract_command_arg(&body, "caption") {
                                        children.push(DocNode {
                                            node_type: DocNodeType::Caption,
                                            text: Some(cap),
                                            children: None,
                                            attrs: DocNodeAttrs {
                                                byte_start: cmd_start,
                                                byte_end: be,
                                                ..Default::default()
                                            },
                                        });
                                    }
                                }

                                // ── skip other environments ──────────
                                _ => {
                                    let _ = self.read_env_body_verbatim(&env);
                                }
                            }
                            para_start = self.pos as u64;
                        }

                        // ── \end{...} (unmatched) ────────────────────
                        "end" => {
                            self.read_braced_arg();
                        }

                        // ── cross-references and labels ──────────────
                        "label" | "ref" | "pageref" | "eqref" | "vref" | "autoref" | "cref"
                        | "Cref" | "nameref" | "hyperref" => {
                            self.read_braced_arg();
                        }

                        // ── citations ────────────────────────────────
                        "cite" | "citep" | "citet" | "citealt" | "citeyear" | "citeauthor"
                        | "parencite" | "textcite" | "autocite" => {
                            self.read_optional_arg();
                            self.read_braced_arg();
                        }

                        // ── footnote ─────────────────────────────────
                        "footnote" => {
                            let text = self.read_braced_arg();
                            let be = self.pos as u64;
                            if !text.is_empty() {
                                children.push(DocNode {
                                    node_type: DocNodeType::Footnote,
                                    text: Some(text),
                                    children: None,
                                    attrs: DocNodeAttrs {
                                        byte_start: cmd_start,
                                        byte_end: be,
                                        ..Default::default()
                                    },
                                });
                            }
                        }
                        "footnotemark" => {}

                        // ── includegraphics ──────────────────────────
                        "includegraphics" => {
                            self.read_optional_arg();
                            let path = self.read_braced_arg();
                            let be = self.pos as u64;
                            children.push(DocNode {
                                node_type: DocNodeType::Image,
                                text: if path.is_empty() { None } else { Some(path) },
                                children: None,
                                attrs: DocNodeAttrs {
                                    byte_start: cmd_start,
                                    byte_end: be,
                                    ..Default::default()
                                },
                            });
                        }

                        // ── inline formatting → include content ──────
                        "textbf" | "textit" | "texttt" | "textsc" | "textsl" | "textrm"
                        | "emph" | "underline" | "uline" | "overline" | "textsuperscript"
                        | "textsubscript" | "mbox" | "hbox" => {
                            let content = self.read_braced_arg();
                            para_buf.push_str(&content);
                        }

                        // ── already-scanned metadata → skip ─────────
                        "title" | "author" | "date" | "keywords" | "abstract" => {
                            self.read_braced_arg();
                        }

                        // ── preamble / structural → skip ─────────────
                        "documentclass" | "usepackage" | "newcommand" | "renewcommand"
                        | "providecommand" | "newenvironment" | "renewenvironment"
                        | "setlength" | "setcounter" | "addtocounter" | "pagestyle"
                        | "thispagestyle" | "pagenumbering" | "maketitle" | "tableofcontents"
                        | "listoffigures" | "listoftables" | "bibliography"
                        | "bibliographystyle" | "printbibliography" | "addbibresource"
                        | "clearpage" | "cleardoublepage" | "newpage" | "pagebreak" | "vspace"
                        | "hspace" | "vskip" | "hskip" | "medskip" | "smallskip" | "bigskip"
                        | "noindent" | "indent" | "centering" | "raggedright" | "raggedleft"
                        | "appendix" | "frontmatter" | "mainmatter" | "backmatter" | "input"
                        | "include" | "includeonly" | "selectfont" | "fontsize" | "linespread"
                        | "color" | "textcolor" | "colorbox" | "fcolorbox" => {
                            self.read_optional_arg();
                            self.read_braced_arg();
                        }

                        // ── escaped special chars → include in text ──
                        "%" => para_buf.push('%'),
                        "&" => para_buf.push('&'),
                        "$" => para_buf.push('$'),
                        "#" => para_buf.push('#'),
                        "_" => para_buf.push('_'),
                        "^" => para_buf.push('^'),
                        "~" => para_buf.push('~'),

                        // ── everything else ───────────────────────────
                        _ => {
                            // If followed by a braced arg, speculatively include its text.
                            if self.peek() == Some('{') {
                                let content = self.read_braced_arg();
                                if content
                                    .chars()
                                    .all(|c| !c.is_control() || c == '\n' || c == '\t')
                                {
                                    para_buf.push_str(&content);
                                }
                            }
                        }
                    }
                }

                // ── blank line → paragraph boundary ──────────────────
                Some('\n') => {
                    self.advance_char();
                    if self.peek() == Some('\n') {
                        // Consume additional blank lines.
                        while self.peek() == Some('\n') {
                            self.advance_char();
                        }
                        if let Some(n) = flush_para(&mut para_buf, &mut para_start, self.pos as u64)
                        {
                            children.push(n);
                        }
                        para_start = self.pos as u64;
                    } else if !para_buf.ends_with(' ') && !para_buf.is_empty() {
                        para_buf.push(' ');
                    }
                }

                // ── opening brace → include inner text (e.g. {text}) ─
                Some('{') => {
                    self.advance_char();
                    // Treat '{' as transparent grouping: just continue into it.
                    // The closing '}' will be consumed below.
                }
                Some('}') => {
                    self.advance_char(); // close of a group — skip silently
                }
                Some('&') => {
                    self.advance_char(); // stray & outside table — skip
                }

                Some(c) => {
                    para_buf.push(c);
                    self.advance_char();
                }
                None => break,
            }
        }

        // Flush any trailing paragraph text.
        if let Some(n) = flush_para(&mut para_buf, &mut para_start, self.pos as u64) {
            children.push(n);
        }

        DocNode {
            node_type: DocNodeType::Document,
            children: Some(children),
            text: None,
            attrs: DocNodeAttrs {
                byte_start: 0,
                byte_end: src_len as u64,
                source_format: Some("latex".to_string()),
                ..Default::default()
            },
        }
    }
}

// ──── free functions ──────────────────────────────────────────────────────────

/// Flush the paragraph buffer into a `Paragraph` node.
fn flush_para(buf: &mut String, start: &mut u64, current_pos: u64) -> Option<DocNode> {
    let text = collapse_whitespace(buf);
    buf.clear();
    if text.is_empty() {
        *start = current_pos;
        return None;
    }
    let node = DocNode {
        node_type: DocNodeType::Paragraph,
        text: Some(text),
        children: None,
        attrs: DocNodeAttrs {
            byte_start: *start,
            byte_end: current_pos,
            ..Default::default()
        },
    };
    *start = current_pos;
    Some(node)
}

fn make_heading(title: String, level: u8, byte_start: u64, byte_end: u64) -> DocNode {
    DocNode {
        node_type: DocNodeType::Heading,
        text: Some(title),
        children: None,
        attrs: DocNodeAttrs {
            heading_level: Some(level),
            byte_start,
            byte_end,
            ..Default::default()
        },
    }
}

/// Normalize whitespace: collapse runs of spaces/tabs/newlines to a single space.
fn collapse_whitespace(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Advance `pos` past the delimiter `needle` and return everything before it.
fn read_until_str(pos: &mut usize, src: &str, needle: &str) -> String {
    let rest = &src[*pos..];
    if let Some(idx) = rest.find(needle) {
        let content = rest[..idx].to_owned();
        *pos += idx + needle.len();
        content
    } else {
        // Needle not found — consume to end.
        let content = rest.to_owned();
        *pos = src.len();
        content
    }
}

/// Extract `\cmd{...}` from a string slice (used for preamble scan and captions).
fn extract_command_arg(src: &str, cmd: &str) -> Option<String> {
    let pattern = format!("\\{}", cmd);
    let idx = src.find(&pattern)?;
    let after = &src[idx + pattern.len()..];
    // Skip optional [...]
    let after = after.trim_start_matches([' ', '\t']);
    let after = if after.starts_with('[') {
        &after[after.find(']').map(|i| i + 1).unwrap_or(after.len())..]
    } else {
        after
    };
    let after = after.trim_start_matches([' ', '\t']);
    if !after.starts_with('{') {
        return None;
    }
    let mut depth = 1usize;
    let mut content = String::new();
    for c in after[1..].chars() {
        match c {
            '{' => {
                depth += 1;
                content.push(c);
            }
            '}' => {
                depth -= 1;
                if depth == 0 {
                    break;
                }
                content.push(c);
            }
            _ => content.push(c),
        }
    }
    let content = content.trim().to_owned();
    if content.is_empty() {
        None
    } else {
        Some(content)
    }
}

/// Extract programming language from an lstlisting/minted optional argument.
/// Handles `language=rust`, `language=Python,frame=lines`, or bare `rust`.
fn extract_listing_language(opt_arg: &str) -> Option<&str> {
    if let Some(idx) = opt_arg.find("language=") {
        let after = &opt_arg[idx + "language=".len()..];
        let end = after.find([',', ']']).unwrap_or(after.len());
        let lang = after[..end].trim();
        if !lang.is_empty() {
            return Some(lang);
        }
    }
    // Bare option with no `=` → treat the whole thing as language name.
    let trimmed = opt_arg.trim();
    if !trimmed.is_empty() && !trimmed.contains('=') {
        Some(trimmed)
    } else {
        None
    }
}

/// Parse a `tabular` environment body into a `Table` DocNode.
fn parse_tabular(body: &str, byte_start: u64, byte_end: u64) -> DocNode {
    // Detect whether first content row is a header (indicated by leading \hline).
    let has_header = body.trim_start().starts_with("\\hline");

    let mut row_nodes: Vec<DocNode> = Vec::new();
    let mut row_idx = 0usize;
    let mut col_idx = 0usize;
    let mut cell_buf = String::new();
    let mut cell_nodes: Vec<DocNode> = Vec::new();

    // Approximate byte offsets within the body (relative to byte_start).
    let mut cur: u64 = byte_start;
    let mut row_bs = byte_start;
    let mut cell_bs = byte_start;

    for ch in body.chars() {
        let ch_len = ch.len_utf8() as u64;
        match ch {
            '&' => {
                let text = collapse_whitespace(&cell_buf);
                cell_buf.clear();
                cell_nodes.push(DocNode {
                    node_type: DocNodeType::TableCell,
                    text: if text.is_empty() { None } else { Some(text) },
                    children: None,
                    attrs: DocNodeAttrs {
                        table_row: Some(row_idx as u32),
                        table_col: Some(col_idx as u32),
                        is_header: if row_idx == 0 && has_header {
                            Some(true)
                        } else {
                            None
                        },
                        byte_start: cell_bs,
                        byte_end: cur,
                        ..Default::default()
                    },
                });
                col_idx += 1;
                cell_bs = cur + ch_len;
                cur += ch_len;
            }
            _ => {
                cur += ch_len;
                cell_buf.push(ch);
            }
        }

        // Detect \\ row terminator inside cell_buf.
        if cell_buf.ends_with("\\\\") {
            // Flush cell (strip the \\).
            let raw = cell_buf.trim_end_matches("\\\\").to_owned();
            let text = collapse_whitespace(&raw);
            cell_buf.clear();
            cell_nodes.push(DocNode {
                node_type: DocNodeType::TableCell,
                text: if text.is_empty() { None } else { Some(text) },
                children: None,
                attrs: DocNodeAttrs {
                    table_row: Some(row_idx as u32),
                    table_col: Some(col_idx as u32),
                    is_header: if row_idx == 0 && has_header {
                        Some(true)
                    } else {
                        None
                    },
                    byte_start: cell_bs,
                    byte_end: cur,
                    ..Default::default()
                },
            });

            if !cell_nodes.is_empty() {
                let cells = std::mem::take(&mut cell_nodes);
                row_nodes.push(DocNode {
                    node_type: DocNodeType::TableRow,
                    children: Some(cells),
                    text: None,
                    attrs: DocNodeAttrs {
                        table_row: Some(row_idx as u32),
                        is_header: if row_idx == 0 && has_header {
                            Some(true)
                        } else {
                            None
                        },
                        byte_start: row_bs,
                        byte_end: cur,
                        ..Default::default()
                    },
                });
                row_idx += 1;
                col_idx = 0;
                row_bs = cur;
                cell_bs = cur;
            }
        }
    }

    DocNode {
        node_type: DocNodeType::Table,
        children: Some(row_nodes),
        text: None,
        attrs: DocNodeAttrs {
            byte_start,
            byte_end,
            ..Default::default()
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn headings_produce_correct_levels() {
        let src = r"
\section{Introduction}
Some text.

\subsection{Background}
More text here.
";
        let doc = parse(src).unwrap();
        let children = doc.children.unwrap();
        let headings: Vec<_> = children
            .iter()
            .filter(|n| n.node_type == DocNodeType::Heading)
            .collect();
        assert_eq!(headings.len(), 2);
        assert_eq!(headings[0].attrs.heading_level, Some(2));
        assert_eq!(headings[0].text.as_deref(), Some("Introduction"));
        assert_eq!(headings[1].attrs.heading_level, Some(3));
    }

    #[test]
    fn paragraph_text_is_extracted() {
        let src = r"
\section{Intro}
This is a paragraph with some text content here.

Another paragraph follows.
";
        let doc = parse(src).unwrap();
        let children = doc.children.unwrap();
        let paras: Vec<_> = children
            .iter()
            .filter(|n| n.node_type == DocNodeType::Paragraph)
            .collect();
        assert!(!paras.is_empty());
        assert!(paras[0]
            .text
            .as_deref()
            .unwrap_or("")
            .contains("paragraph with some text"));
    }

    #[test]
    fn verbatim_produces_code_node() {
        let src = "\\begin{verbatim}\nfn main() {}\n\\end{verbatim}";
        let doc = parse(src).unwrap();
        let children = doc.children.unwrap();
        let code_node = children
            .iter()
            .find(|n| n.node_type == DocNodeType::Code)
            .expect("expected a code node");
        assert!(code_node
            .text
            .as_deref()
            .unwrap_or("")
            .contains("fn main()"));
    }

    #[test]
    fn lstlisting_extracts_language() {
        let src = "\\begin{lstlisting}[language=rust]\nlet x = 1;\n\\end{lstlisting}";
        let doc = parse(src).unwrap();
        let children = doc.children.unwrap();
        let code_node = children
            .iter()
            .find(|n| n.node_type == DocNodeType::Code)
            .unwrap();
        assert_eq!(code_node.attrs.code_language.as_deref(), Some("rust"));
    }

    #[test]
    fn preamble_metadata_extracted() {
        let src = r"\documentclass{article}
\title{My Paper}
\author{Alice}
\begin{document}
Hello world.
\end{document}";
        let doc = parse(src).unwrap();
        let children = doc.children.unwrap();
        let meta = children
            .iter()
            .find(|n| n.node_type == DocNodeType::Metadata)
            .expect("expected metadata node");
        let text = meta.text.as_deref().unwrap_or("");
        assert!(text.contains("My Paper"));
        assert!(text.contains("Alice"));
    }

    #[test]
    fn display_math_produces_formula_node() {
        let src = "$$E = mc^2$$";
        let doc = parse(src).unwrap();
        let children = doc.children.unwrap();
        let formula = children
            .iter()
            .find(|n| n.node_type == DocNodeType::Formula)
            .expect("expected formula node");
        assert!(formula.text.as_deref().unwrap_or("").contains("mc^2"));
    }

    #[test]
    fn parse_empty_input_returns_document() {
        let doc = parse("").unwrap();
        assert_eq!(doc.node_type, DocNodeType::Document);
    }
}
