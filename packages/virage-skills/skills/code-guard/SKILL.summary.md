# Skill: Code Guard (summary)

Use when: reviewing code changes for correctness/security/quality, resolving code quality errors before a commit, auditing a PR for vulnerabilities, checking for active guardrail violations.

**Full skill cost:** ~600 tokens. Load with `read_skill('code-guard')` for the full guardrail checklist.

## Key outputs
- Ordered finding list: `<CRIT|WARN|INFO> <file>:<line> — <issue> → <fix>`
- Pre-commit gate status (pass/fail)
- Done when: all CRIT resolved, WARN acknowledged
