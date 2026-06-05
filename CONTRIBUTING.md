# Contributing to Virage

## Prerequisites

- Node.js ≥ 18
- npm ≥ 9

## Setup

```bash
git clone https://github.com/vivantel/virage.git
cd virage
npm install          # installs all workspace packages
npm run build:all    # compile every package
```

## Development commands

| Command                                            | What it does                                              |
| -------------------------------------------------- | --------------------------------------------------------- |
| `npm run build:all`                                | Compile all packages                                      |
| `npm run build -w @vivantel/<pkg>`                 | Compile one package                                       |
| `npm run fix`                                      | ESLint auto-fix + Prettier format (run before committing) |
| `npm run lint`                                     | Lint check only                                           |
| `npm run type-check:ci`                            | TypeScript check across all packages                      |
| `npm test -w @vivantel/<pkg>`                      | Run unit tests for one package                            |
| `npm run test:acceptance -w @vivantel/virage-core` | Run acceptance tests                                      |
| `npm run test:coverage -w @vivantel/<pkg>`         | Test with coverage report                                 |

A pre-commit hook runs `npm run fix && npm run lint && npm run type-check:ci` automatically — do not skip it.

## Commit format

This repo uses [Conventional Commits](https://www.conventionalcommits.org/) — automated releases and changelogs are driven by commit messages.

| Prefix              | When to use                                     |
| ------------------- | ----------------------------------------------- |
| `feat:`             | New user-facing feature                         |
| `fix:`              | Bug fix                                         |
| `chore:`            | Tooling, deps, CI — no production change        |
| `docs:`             | Documentation only                              |
| `feat!:` or `fix!:` | Breaking change (triggers a major version bump) |

## Code style

- TypeScript throughout; all packages use ES modules (`"type": "module"`)
- Internal imports use `.js` extensions even for `.ts` source files (NodeNext requirement)
- ESLint + Prettier enforced — run `npm run fix` to auto-format

## Testing

- Add unit tests for any new behaviour in the relevant package's `src/` tests
- Tests use [vitest](https://vitest.dev/)
- Acceptance tests in `virage-core` exercise the full pipeline end-to-end against a real SQLite embeddings cache

## Opening a pull request

1. Fork the repo and create a feature branch
2. Make your changes with tests
3. Run `npm run fix && npm run type-check:ci && npm test --workspaces --if-present` to verify locally
4. Open a PR against `master` with a clear description of the change and the motivation
5. Link any related issues

## Architecture decisions

Significant design changes — new abstractions, new package boundaries, breaking interface changes — require an entry in [`docs/ADR.md`](docs/ADR.md) before implementation. Check existing ADRs for context and format.

## Deeper documentation

The [`docs/ai/INDEX.md`](docs/ai/INDEX.md) index contains skill files covering the package lifecycle, CI/CD pipeline, test strategy, and more. These are the primary reference for contributors working on the internals.
