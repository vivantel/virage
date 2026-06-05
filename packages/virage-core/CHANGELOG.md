# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.17](https://github.com/vivantel/virage/compare/virage-core@v0.2.16...virage-core@v0.2.17) (2026-06-05)


### Bug Fixes

* **virage-core:** Include contentHash in document metadata for eval matching ([6e55d20](https://github.com/vivantel/virage/commit/6e55d2041b775df43151ee8a4d2bdca22b700210))

## [0.2.16](https://github.com/vivantel/virage/compare/virage-core@v0.2.15...virage-core@v0.2.16) (2026-06-05)


### Bug Fixes

* Use ./eval-dataset.json as default evaluation dataset path ([2d2ea03](https://github.com/vivantel/virage/commit/2d2ea0303fe881d1f96294bf68f454fa41f6841c))

## [0.2.15](https://github.com/vivantel/virage/compare/virage-core@v0.2.14...virage-core@v0.2.15) (2026-06-05)

### Bug Fixes

- **core:** Propagate embedder dimensions to vectorStore at config load time ([cbfb781](https://github.com/vivantel/virage/commit/cbfb78119b5383dcac426baf8345d1660fd150e2))

## [0.2.14](https://github.com/vivantel/virage/compare/virage-core@v0.2.13...virage-core@v0.2.14) (2026-06-05)

### Bug Fixes

- **core:** EmbeddingsDb creates parent directory if missing ([b9b0371](https://github.com/vivantel/virage/commit/b9b03715b93dd1b9adda8aa6e8a076a3362a1b88))

## [0.2.13](https://github.com/vivantel/virage/compare/virage-core@v0.2.12...virage-core@v0.2.13) (2026-06-05)

### Features

- Index command, ignorePatterns, lancedb CI, MCP reconnect, drop embeddings.json ([27b77eb](https://github.com/vivantel/virage/commit/27b77eb44cd670f42dd170dfba3e5772a1c2eef7))

## [0.2.12](https://github.com/vivantel/virage/compare/virage-core@v0.2.11...virage-core@v0.2.12) (2026-06-05)

### Bug Fixes

- **dashboard:** Single WS, \_virage_meta table, source file in search, path normalization ([174aba0](https://github.com/vivantel/virage/commit/174aba0cf398dce4808e32625b30b01fbc94d700))

## [0.2.11](https://github.com/vivantel/virage/compare/virage-core@v0.2.10...virage-core@v0.2.11) (2026-06-04)

### Bug Fixes

- **virage-cli:** Gate verbose/debug/trace logs and add projected embed totals ([29c11e8](https://github.com/vivantel/virage/commit/29c11e84c1cdf3556ee3b9305ad901a203e594b3))

## [0.2.10](https://github.com/vivantel/virage/compare/virage-core@v0.2.9...virage-core@v0.2.10) (2026-06-04)

### Bug Fixes

- **virage-core:** Floor embedded_at during embeddings→chunks migration ([02a484b](https://github.com/vivantel/virage/commit/02a484b2ce309693055f16560f4d29c41658df9d))

## [0.2.9](https://github.com/vivantel/virage/compare/virage-core@v0.2.8...virage-core@v0.2.9) (2026-06-04)

### Features

- **virage-core:** Streaming pipeline + BLOB embedding schema ([34d9ce1](https://github.com/vivantel/virage/commit/34d9ce1ce43050b6ccb73481c6a636e692c0cd39))

## [0.2.8](https://github.com/vivantel/virage/compare/virage-core@v0.2.7...virage-core@v0.2.8) (2026-06-04)

### Features

- **dashboard:** Add multi-project tracking and switching ([9a9622c](https://github.com/vivantel/virage/commit/9a9622c099cf21ca260c97cc13d706d11c86c248))

## [0.2.7](https://github.com/vivantel/virage/compare/virage-core@v0.2.6...virage-core@v0.2.7) (2026-06-04)

### Features

- Split virage-core into library + CLI packages; add virage-dashboard ([08dcb95](https://github.com/vivantel/virage/commit/08dcb9551e834462fd2d94e0e8f6255dbda4e391))

### Bug Fixes

- Remove unused EmbeddedChunk import; exclude virage-dashboard from workspaces ([39c6562](https://github.com/vivantel/virage/commit/39c6562043d1126c4408425302ae9a646a47684e))

## [0.2.6](https://github.com/vivantel/virage/compare/virage-core@v0.2.5...virage-core@v0.2.6) (2026-06-04)

### Bug Fixes

- Repair one-char sliding window in tokenStrategy and add comprehensive chunk strategy tests ([0cbd3a2](https://github.com/vivantel/virage/commit/0cbd3a22e635d477f29203b4f4d5204200d04cbb))

## [0.2.5](https://github.com/vivantel/virage/compare/virage-core@v0.2.4...virage-core@v0.2.5) (2026-06-03)

### Bug Fixes

- Read embeddings from SQLite, upload bar, suppress dotenv tip, fix bar teardown on error ([4c5272f](https://github.com/vivantel/virage/commit/4c5272f53d5ef11b93efaa051cf2ff93119f0df4))

## [0.2.4](https://github.com/vivantel/virage/compare/virage-core@v0.2.3...virage-core@v0.2.4) (2026-06-03)

### Features

- SQLite embeddings storage, fail-fast uploads, init UX improvements ([5281bc8](https://github.com/vivantel/virage/commit/5281bc8a03d2960dc2ea6019daeb67bb1f70ab20))

## [0.2.3](https://github.com/vivantel/virage/compare/virage-core@v0.2.2...virage-core@v0.2.3) (2026-06-03)

### Features

- Fix retries, remove GitHub Models, add progress bars, time-gate saves, skip dot-dirs ([5f83d4c](https://github.com/vivantel/virage/commit/5f83d4c64053540ba135b9e10223f40e2291f8bb))

## [0.2.2](https://github.com/vivantel/virage/compare/virage-core@v0.2.1...virage-core@v0.2.2) (2026-06-03)

### Bug Fixes

- Use .virage folder for plugin storage, fix blank log lines, unify file detection ([76c1303](https://github.com/vivantel/virage/commit/76c1303ed64b1dea6991e88a533fbcbfe4d5447b))

## [0.2.1](https://github.com/vivantel/virage/compare/virage-core@v0.2.0...virage-core@v0.2.1) (2026-06-03)

### Features

- Use .virage/ as default storage folder, support VIRAGE_DIR env var ([d831d8e](https://github.com/vivantel/virage/commit/d831d8e6b91fa6c1716bd507f834e1f837a3c947))

### Bug Fixes

- Eliminate redundant git scan, fix init overwrite/install prompts, rename rag.config.ci.json ([75dcdf3](https://github.com/vivantel/virage/commit/75dcdf33402e3b0b5718e6c0ee866b51544e1415))

## [0.2.0](https://github.com/vivantel/rag_core/compare/virage-core@v0.1.0...virage-core@v0.2.0) (2026-06-03)

### ⚠ BREAKING CHANGES

- all package names, CLI binary, and config filename changed

### Features

- Rebrand all packages from rag to virage, reset versions to 0.1.0 ([566e538](https://github.com/vivantel/rag_core/commit/566e538f7884b9b1d25341a366df422d9e2f058a))
- Test trusted publisher automation ([7fd08b9](https://github.com/vivantel/rag_core/commit/7fd08b96f32e7f7c2c2c02ec7e2eebb761d5fa7f))
- Test trusted publisher automation ([c524461](https://github.com/vivantel/rag_core/commit/c5244615cf7e5e91457446b43d62efdd7928273c))

## [4.0.0](https://github.com/vivantel/virage/compare/rag-core@v3.4.2...rag-core@v4.0.0) (2026-06-03)

### ⚠ BREAKING CHANGES

- remove deprecated GitHubModelsEmbedder and exclude acceptance tests from CI

### Features

- Acceptance test suite, rag-store-test package, and CLI update subcommand ([9270e62](https://github.com/vivantel/virage/commit/9270e629d3f80c28b6f0c29b22ee5d3b906d2dfe))
- Remove deprecated GitHubModelsEmbedder and exclude acceptance tests from CI ([bbd1daa](https://github.com/vivantel/virage/commit/bbd1daa094274d4e3d6da78b98047fb8503a5bf4))

## [3.4.2](https://github.com/vivantel/virage/compare/rag-core@v3.4.1...rag-core@v3.4.2) (2026-06-03)

### Bug Fixes

- Filter logger frames from trace stacks and include error in retry log ([80714b4](https://github.com/vivantel/virage/commit/80714b42b7b1a0c44ee52d5d570f8a3e199e91e7))

## [3.4.1](https://github.com/vivantel/virage/compare/rag-core@v3.4.0...rag-core@v3.4.1) (2026-06-03)

### Bug Fixes

- Pass date to consola \_log to prevent FancyReporter crash ([0575afc](https://github.com/vivantel/virage/commit/0575afce4195110e6846d60cae5b8e6111ce2328))

## [3.4.0](https://github.com/vivantel/virage/compare/rag-core@v3.3.3...rag-core@v3.4.0) (2026-06-03)

### Features

- Add Logger abstraction with consola and -v verbosity flag ([cf69a0a](https://github.com/vivantel/virage/commit/cf69a0a903fc54d1b45ab093d2d32e75b68ebc39))

## [3.3.3](https://github.com/vivantel/virage/compare/rag-core@v3.3.2...rag-core@v3.3.3) (2026-06-02)

### Bug Fixes

- Upload always skipped; fastembed cacheDir mkdir creates parent only ([3c196d5](https://github.com/vivantel/virage/commit/3c196d565c2e1bc88597aefc9ae310ab1019381f))

## [3.3.2](https://github.com/vivantel/virage/compare/rag-core@v3.3.1...rag-core@v3.3.2) (2026-06-02)

### Bug Fixes

- Re-entrancy after embedding failure; fastembed cacheDir mkdir ([4e71959](https://github.com/vivantel/virage/commit/4e71959a10fb7164c1a9e0957d728b78590764b5))

## [3.3.1](https://github.com/vivantel/virage/compare/rag-core@v3.3.0...rag-core@v3.3.1) (2026-06-02)

### Bug Fixes

- **rag-store-chromadb:** Use IncludeEnum values for chromadb v1.10.5 type compatibility ([fde41a5](https://github.com/vivantel/virage/commit/fde41a519d8f93f9fc5b26fbc3a5130faa19f57b))

## [3.3.0](https://github.com/vivantel/virage/compare/rag-core@v3.2.0...rag-core@v3.3.0) (2026-06-02)

### Features

- E2e CLI tests, store diagnostics for all packages, experiment list command ([e3b15df](https://github.com/vivantel/virage/commit/e3b15dfe68995edff0f69d4a2d7c9dcb048043f3))

## [3.2.0](https://github.com/vivantel/virage/compare/rag-core@v3.1.0...rag-core@v3.2.0) (2026-06-02)

### Features

- Plugin-first init wizard with LanceDB and ChromaDB stores ([9b8b77d](https://github.com/vivantel/virage/commit/9b8b77d327069d921e438bdb3e4c689ee7ccda7f))

## [3.1.0](https://github.com/vivantel/virage/compare/rag-core@v3.0.0...rag-core@v3.1.0) (2026-06-02)

### Features

- **rag-store-qdrant:** Add local file mode via path option ([50f0fe9](https://github.com/vivantel/virage/commit/50f0fe92e510ce4a3e649370910583e73e6536eb))

## [3.0.0](https://github.com/vivantel/virage/compare/rag-core@v2.5.0...rag-core@v3.0.0) (2026-06-02)

### ⚠ BREAKING CHANGES

- TypeScript config files (rag.config.ts) are no longer supported. loadConfig() throws a ConfigError with a migration hint when given a .ts path. tsx removed from runtime dependencies. Default CLI config path changed from rag.config.ts to rag.config.json. gitignore updated accordingly.

### Features

- Add rag-store-qdrant, overhaul init wizard, drop rag.config.ts support ([cf32f27](https://github.com/vivantel/virage/commit/cf32f27aabd43d92c05e344cf73fc4ad8a1cbd97))

## [2.5.0](https://github.com/vivantel/virage/compare/rag-core@v2.4.0...rag-core@v2.5.0) (2026-06-02)

### Features

- Implement ROADMAP v2.0 — Quality & Observability ([e2db9ed](https://github.com/vivantel/virage/commit/e2db9ed73c6a96fe19eed2259e9b0300e1defe6d))

### Bug Fixes

- Avoid static type resolution for optional rag-embedder-transformers import ([732f979](https://github.com/vivantel/virage/commit/732f97946a3cfdb2e15bb2c2b4fb03247ce75960))
- Fix formatting errors ([840de63](https://github.com/vivantel/virage/commit/840de6348353b756da7b44906bcf7cc4d18a89cf))

## [2.4.0](https://github.com/vivantel/virage/compare/rag-core@v2.3.0...rag-core@v2.4.0) (2026-06-01)

### Features

- Replace rag-store-supabase with rag-store-postgres ([9f97807](https://github.com/vivantel/virage/commit/9f97807067c1d0cd732257d8f9da2bd824d57169))
- Test trusted publisher automation ([7fd08b9](https://github.com/vivantel/virage/commit/7fd08b96f32e7f7c2c2c02ec7e2eebb761d5fa7f))
- Test trusted publisher automation ([c524461](https://github.com/vivantel/virage/commit/c5244615cf7e5e91457446b43d62efdd7928273c))

### Bug Fixes

- Post-restructuring audit fixes ([2708505](https://github.com/vivantel/virage/commit/2708505f5ec18a316e704b0393252153c9718970))
- Remove prepare script from workspace packages ([d00e877](https://github.com/vivantel/virage/commit/d00e877fb782230ac3f81648fb9a08b209a3d739))
- Use variable import specifier for optional @vivantel/rag-strategies ([59ee02a](https://github.com/vivantel/virage/commit/59ee02a2a287594b547ba8ba1ebb55e8f31e6c3e))

## [2.3.0](https://github.com/vivantel/virage/compare/v2.2.0...v2.3.0) (2026-06-01)

### Features

- cap rate-limit wait with maxRetryWaitMs in GitHubModelsEmbedder ([2996d8d](https://github.com/vivantel/virage/commit/2996d8d9efea7b9ce41604dcb25145cc657c978b))
- commit-hash file-level embedding skip + GitHub Models batch optimization ([8945a1d](https://github.com/vivantel/virage/commit/8945a1df448bc5d5daf1ce52931454d545ca0f56))
- rate-limit-aware GitHub Models embedder + incremental checkpoint saves ([0cf30c0](https://github.com/vivantel/virage/commit/0cf30c055120669d9c01392063aea881446c8269))

### Bug Fixes

- apply prettier ([e4c2714](https://github.com/vivantel/virage/commit/e4c27142415741f1551b46a4e85faace75eec5e7))
- apply prettier ([352faa3](https://github.com/vivantel/virage/commit/352faa358efd9915c70b49d59db07ebea5f5ff02))
- correct GitHub Models endpoint and model name ([079b4c2](https://github.com/vivantel/virage/commit/079b4c2a99da6a193c021178dcf3fb6aea61f05a))
- correct GitHub Models endpoint in rag.config.ts; gitignore docs/rag/ ([de21720](https://github.com/vivantel/virage/commit/de217204b373d07233da23f4bebd3f6bda577103))
- only save RAG cache on pipeline success ([bf2e174](https://github.com/vivantel/virage/commit/bf2e1748a0cc74ce08428b2a73dd2d2052dd9774))
- show response body in embed errors; revert to MODELS_TOKEN secret ([6c745b7](https://github.com/vivantel/virage/commit/6c745b78d43cd2eab86e15d667e062e39beaed20))

## [2.2.0](https://github.com/vivantel/virage/compare/v2.1.3...v2.2.0) (2026-05-31)

### Features

- add RAG pipeline job to CI ([de0ddd2](https://github.com/vivantel/virage/commit/de0ddd29c0b138e0a256cff79ba8e90e45747fd6))

### Bug Fixes

- remove GITHUB\_ prefix for github secret ([bdf2426](https://github.com/vivantel/virage/commit/bdf2426cf71f53d77bdf151bbe9f4beec531dd08))
- use GITHUB_MODELS_TOKEN for GitHub Models API ([df3b4ad](https://github.com/vivantel/virage/commit/df3b4ad77b33f0fc0a5a423b415361995c37ff85))
- use tsx/esm/api to load .ts config files; lazy Supabase client ([5c012a4](https://github.com/vivantel/virage/commit/5c012a40f6078ed8e2bc3a4c1e4c80afdc0a1e82))

## [2.1.3](https://github.com/vivantel/virage/compare/v2.1.2...v2.1.3) (2026-05-31)

### Bug Fixes

- exclude build artifacts and deps from glob in GitTracker ([6cd0c01](https://github.com/vivantel/virage/commit/6cd0c0156e656b1b2782d9749b96f9cd93c676db))

## [2.1.2](https://github.com/vivantel/virage/compare/v2.1.1...v2.1.2) (2026-05-31)

### Bug Fixes

- add prepare script to build dist on install ([ade0043](https://github.com/vivantel/virage/commit/ade00434aa7a01c0597dca870c833bb30e9f441e))

## [2.1.1](https://github.com/vivantel/virage/compare/v2.1.0...v2.1.1) (2026-05-31)

### Bug Fixes

- use import type for interface-only imports in generated configs ([d91114b](https://github.com/vivantel/virage/commit/d91114bd22acef7d1db7ef8485cf04c118ca08b1))

## [2.1.0](https://github.com/vivantel/virage/compare/v2.0.0...v2.1.0) (2026-05-31)

### Features

- per-pattern strategy shorthand in createChunker + smart init auto-detection ([41b0e8e](https://github.com/vivantel/virage/commit/41b0e8e505f8299075c2510a9aee67232ecdf842))

## [2.0.0](https://github.com/vivantel/virage/compare/v1.1.3...v2.0.0) (2026-05-31)

### ⚠ BREAKING CHANGES

- v2.0.0 — plugin ecosystem, monorepo, watch mode, config validation

### Features

- v1.2.0 — CLI init/validate commands, error classes, dry-run, examples ([d192b89](https://github.com/vivantel/virage/commit/d192b894dbf5fcf711322cf14e5defe51bcec311))
- v1.3.0 — retry, parallel embeddings, resume, telemetry, notifications ([da2280f](https://github.com/vivantel/virage/commit/da2280f331defefc8d90f53b1f471cd3180a7b9b))
- v2.0.0 — plugin ecosystem, monorepo, watch mode, config validation ([554d196](https://github.com/vivantel/virage/commit/554d1967c1f9dd52b1dd54a812d5a597c737e39c))

## [1.1.3](https://github.com/vivantel/virage/compare/v1.1.2...v1.1.3) (2026-05-31)

### Bug Fixes

- resolve correctness bugs, error handling, and publish configuration ([1bbd19f](https://github.com/vivantel/virage/commit/1bbd19f3c795f0804c2627b339804ee4d5bf9096))

## [1.1.2](https://github.com/vivantel/virage/compare/v1.1.1...v1.1.2) (2026-05-31)

### Bug Fixes

- add repository.url to package.json for npm provenance ([01f8164](https://github.com/vivantel/virage/commit/01f816412ce5643eaa1cc1acb6a689fa48c20bfc))

## [1.1.1](https://github.com/vivantel/virage/compare/v1.1.0...v1.1.1) (2026-05-31)

### Bug Fixes

- add repository.url to package.json for npm provenance ([c468d1f](https://github.com/vivantel/virage/commit/c468d1f819579524795cf2f533871efe9931dd6f))

## [1.1.0](https://github.com/vivantel/virage/compare/v1.0.0...v1.1.0) (2026-05-31)

### Features

- test trusted publisher automation ([7fd08b9](https://github.com/vivantel/virage/commit/7fd08b96f32e7f7c2c2c02ec7e2eebb761d5fa7f))

## 1.0.0 (2026-05-31)

### Features

- test trusted publisher automation ([8a8cf1f](https://github.com/vivantel/virage/commit/8a8cf1f05ab420ebfcaba5653819d0d5e5c5fc2f))
- test trusted publisher automation ([b2638cd](https://github.com/vivantel/virage/commit/b2638cd58abbfe073db51ef2fd0146594a99c55f))
- test trusted publisher automation ([c524461](https://github.com/vivantel/virage/commit/c5244615cf7e5e91457446b43d62efdd7928273c))

## [Unreleased]

### Added

- Initial release

### Changed

### Deprecated

### Removed

### Fixed

### Security
