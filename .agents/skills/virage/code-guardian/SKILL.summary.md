# Skill: Code Guardian (summary)

Use when: reviewing code changes for correctness/security/quality, resolving lint or type-check errors before a commit, auditing a PR for vulnerabilities, checking for active guardrail violations.

**Full skill cost:** ~2,012 tokens. Load with `read_skill('code-guardian')` for the full guardrail checklist.

## Key outputs
- Ordered finding list with severity (critical/warning/info), file:line reference
- Remediation action per finding
- Pre-commit gate status (pass/fail)
