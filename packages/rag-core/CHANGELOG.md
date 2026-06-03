# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.4.1](https://github.com/vivantel/rag_core/compare/rag-core@v3.4.0...rag-core@v3.4.1) (2026-06-03)


### Bug Fixes

* Pass date to consola _log to prevent FancyReporter crash ([0575afc](https://github.com/vivantel/rag_core/commit/0575afce4195110e6846d60cae5b8e6111ce2328))

## [3.4.0](https://github.com/vivantel/rag_core/compare/rag-core@v3.3.3...rag-core@v3.4.0) (2026-06-03)


### Features

* Add Logger abstraction with consola and -v verbosity flag ([cf69a0a](https://github.com/vivantel/rag_core/commit/cf69a0a903fc54d1b45ab093d2d32e75b68ebc39))

## [3.3.3](https://github.com/vivantel/rag_core/compare/rag-core@v3.3.2...rag-core@v3.3.3) (2026-06-02)


### Bug Fixes

* Upload always skipped; fastembed cacheDir mkdir creates parent only ([3c196d5](https://github.com/vivantel/rag_core/commit/3c196d565c2e1bc88597aefc9ae310ab1019381f))

## [3.3.2](https://github.com/vivantel/rag_core/compare/rag-core@v3.3.1...rag-core@v3.3.2) (2026-06-02)


### Bug Fixes

* Re-entrancy after embedding failure; fastembed cacheDir mkdir ([4e71959](https://github.com/vivantel/rag_core/commit/4e71959a10fb7164c1a9e0957d728b78590764b5))

## [3.3.1](https://github.com/vivantel/rag_core/compare/rag-core@v3.3.0...rag-core@v3.3.1) (2026-06-02)


### Bug Fixes

* **rag-store-chromadb:** Use IncludeEnum values for chromadb v1.10.5 type compatibility ([fde41a5](https://github.com/vivantel/rag_core/commit/fde41a519d8f93f9fc5b26fbc3a5130faa19f57b))

## [3.3.0](https://github.com/vivantel/rag_core/compare/rag-core@v3.2.0...rag-core@v3.3.0) (2026-06-02)


### Features

* E2e CLI tests, store diagnostics for all packages, experiment list command ([e3b15df](https://github.com/vivantel/rag_core/commit/e3b15dfe68995edff0f69d4a2d7c9dcb048043f3))

## [3.2.0](https://github.com/vivantel/rag_core/compare/rag-core@v3.1.0...rag-core@v3.2.0) (2026-06-02)


### Features

* Plugin-first init wizard with LanceDB and ChromaDB stores ([9b8b77d](https://github.com/vivantel/rag_core/commit/9b8b77d327069d921e438bdb3e4c689ee7ccda7f))

## [3.1.0](https://github.com/vivantel/rag_core/compare/rag-core@v3.0.0...rag-core@v3.1.0) (2026-06-02)


### Features

* **rag-store-qdrant:** Add local file mode via path option ([50f0fe9](https://github.com/vivantel/rag_core/commit/50f0fe92e510ce4a3e649370910583e73e6536eb))

## [3.0.0](https://github.com/vivantel/rag_core/compare/rag-core@v2.5.0...rag-core@v3.0.0) (2026-06-02)


### ⚠ BREAKING CHANGES

* TypeScript config files (rag.config.ts) are no longer supported. loadConfig() throws a ConfigError with a migration hint when given a .ts path. tsx removed from runtime dependencies. Default CLI config path changed from rag.config.ts to rag.config.json. gitignore updated accordingly.

### Features

* Add rag-store-qdrant, overhaul init wizard, drop rag.config.ts support ([cf32f27](https://github.com/vivantel/rag_core/commit/cf32f27aabd43d92c05e344cf73fc4ad8a1cbd97))

## [2.5.0](https://github.com/vivantel/rag_core/compare/rag-core@v2.4.0...rag-core@v2.5.0) (2026-06-02)


### Features

* Implement ROADMAP v2.0 — Quality & Observability ([e2db9ed](https://github.com/vivantel/rag_core/commit/e2db9ed73c6a96fe19eed2259e9b0300e1defe6d))


### Bug Fixes

* Avoid static type resolution for optional rag-embedder-transformers import ([732f979](https://github.com/vivantel/rag_core/commit/732f97946a3cfdb2e15bb2c2b4fb03247ce75960))
* Fix formatting errors ([840de63](https://github.com/vivantel/rag_core/commit/840de6348353b756da7b44906bcf7cc4d18a89cf))

## [2.4.0](https://github.com/vivantel/rag_core/compare/rag-core@v2.3.0...rag-core@v2.4.0) (2026-06-01)


### Features

* Replace rag-store-supabase with rag-store-postgres ([9f97807](https://github.com/vivantel/rag_core/commit/9f97807067c1d0cd732257d8f9da2bd824d57169))
* Test trusted publisher automation ([7fd08b9](https://github.com/vivantel/rag_core/commit/7fd08b96f32e7f7c2c2c02ec7e2eebb761d5fa7f))
* Test trusted publisher automation ([c524461](https://github.com/vivantel/rag_core/commit/c5244615cf7e5e91457446b43d62efdd7928273c))


### Bug Fixes

* Post-restructuring audit fixes ([2708505](https://github.com/vivantel/rag_core/commit/2708505f5ec18a316e704b0393252153c9718970))
* Remove prepare script from workspace packages ([d00e877](https://github.com/vivantel/rag_core/commit/d00e877fb782230ac3f81648fb9a08b209a3d739))
* Use variable import specifier for optional @vivantel/rag-strategies ([59ee02a](https://github.com/vivantel/rag_core/commit/59ee02a2a287594b547ba8ba1ebb55e8f31e6c3e))

## [2.3.0](https://github.com/vivantel/rag_core/compare/v2.2.0...v2.3.0) (2026-06-01)


### Features

* cap rate-limit wait with maxRetryWaitMs in GitHubModelsEmbedder ([2996d8d](https://github.com/vivantel/rag_core/commit/2996d8d9efea7b9ce41604dcb25145cc657c978b))
* commit-hash file-level embedding skip + GitHub Models batch optimization ([8945a1d](https://github.com/vivantel/rag_core/commit/8945a1df448bc5d5daf1ce52931454d545ca0f56))
* rate-limit-aware GitHub Models embedder + incremental checkpoint saves ([0cf30c0](https://github.com/vivantel/rag_core/commit/0cf30c055120669d9c01392063aea881446c8269))


### Bug Fixes

* apply prettier ([e4c2714](https://github.com/vivantel/rag_core/commit/e4c27142415741f1551b46a4e85faace75eec5e7))
* apply prettier ([352faa3](https://github.com/vivantel/rag_core/commit/352faa358efd9915c70b49d59db07ebea5f5ff02))
* correct GitHub Models endpoint and model name ([079b4c2](https://github.com/vivantel/rag_core/commit/079b4c2a99da6a193c021178dcf3fb6aea61f05a))
* correct GitHub Models endpoint in rag.config.ts; gitignore docs/rag/ ([de21720](https://github.com/vivantel/rag_core/commit/de217204b373d07233da23f4bebd3f6bda577103))
* only save RAG cache on pipeline success ([bf2e174](https://github.com/vivantel/rag_core/commit/bf2e1748a0cc74ce08428b2a73dd2d2052dd9774))
* show response body in embed errors; revert to MODELS_TOKEN secret ([6c745b7](https://github.com/vivantel/rag_core/commit/6c745b78d43cd2eab86e15d667e062e39beaed20))

## [2.2.0](https://github.com/vivantel/rag_core/compare/v2.1.3...v2.2.0) (2026-05-31)


### Features

* add RAG pipeline job to CI ([de0ddd2](https://github.com/vivantel/rag_core/commit/de0ddd29c0b138e0a256cff79ba8e90e45747fd6))


### Bug Fixes

* remove GITHUB_ prefix for github secret ([bdf2426](https://github.com/vivantel/rag_core/commit/bdf2426cf71f53d77bdf151bbe9f4beec531dd08))
* use GITHUB_MODELS_TOKEN for GitHub Models API ([df3b4ad](https://github.com/vivantel/rag_core/commit/df3b4ad77b33f0fc0a5a423b415361995c37ff85))
* use tsx/esm/api to load .ts config files; lazy Supabase client ([5c012a4](https://github.com/vivantel/rag_core/commit/5c012a40f6078ed8e2bc3a4c1e4c80afdc0a1e82))

## [2.1.3](https://github.com/vivantel/rag_core/compare/v2.1.2...v2.1.3) (2026-05-31)


### Bug Fixes

* exclude build artifacts and deps from glob in GitTracker ([6cd0c01](https://github.com/vivantel/rag_core/commit/6cd0c0156e656b1b2782d9749b96f9cd93c676db))

## [2.1.2](https://github.com/vivantel/rag_core/compare/v2.1.1...v2.1.2) (2026-05-31)


### Bug Fixes

* add prepare script to build dist on install ([ade0043](https://github.com/vivantel/rag_core/commit/ade00434aa7a01c0597dca870c833bb30e9f441e))

## [2.1.1](https://github.com/vivantel/rag_core/compare/v2.1.0...v2.1.1) (2026-05-31)


### Bug Fixes

* use import type for interface-only imports in generated configs ([d91114b](https://github.com/vivantel/rag_core/commit/d91114bd22acef7d1db7ef8485cf04c118ca08b1))

## [2.1.0](https://github.com/vivantel/rag_core/compare/v2.0.0...v2.1.0) (2026-05-31)


### Features

* per-pattern strategy shorthand in createChunker + smart init auto-detection ([41b0e8e](https://github.com/vivantel/rag_core/commit/41b0e8e505f8299075c2510a9aee67232ecdf842))

## [2.0.0](https://github.com/vivantel/rag_core/compare/v1.1.3...v2.0.0) (2026-05-31)


### ⚠ BREAKING CHANGES

* v2.0.0 — plugin ecosystem, monorepo, watch mode, config validation

### Features

* v1.2.0 — CLI init/validate commands, error classes, dry-run, examples ([d192b89](https://github.com/vivantel/rag_core/commit/d192b894dbf5fcf711322cf14e5defe51bcec311))
* v1.3.0 — retry, parallel embeddings, resume, telemetry, notifications ([da2280f](https://github.com/vivantel/rag_core/commit/da2280f331defefc8d90f53b1f471cd3180a7b9b))
* v2.0.0 — plugin ecosystem, monorepo, watch mode, config validation ([554d196](https://github.com/vivantel/rag_core/commit/554d1967c1f9dd52b1dd54a812d5a597c737e39c))

## [1.1.3](https://github.com/vivantel/rag_core/compare/v1.1.2...v1.1.3) (2026-05-31)


### Bug Fixes

* resolve correctness bugs, error handling, and publish configuration ([1bbd19f](https://github.com/vivantel/rag_core/commit/1bbd19f3c795f0804c2627b339804ee4d5bf9096))

## [1.1.2](https://github.com/vivantel/rag_core/compare/v1.1.1...v1.1.2) (2026-05-31)


### Bug Fixes

* add repository.url to package.json for npm provenance ([01f8164](https://github.com/vivantel/rag_core/commit/01f816412ce5643eaa1cc1acb6a689fa48c20bfc))

## [1.1.1](https://github.com/vivantel/rag_core/compare/v1.1.0...v1.1.1) (2026-05-31)


### Bug Fixes

* add repository.url to package.json for npm provenance ([c468d1f](https://github.com/vivantel/rag_core/commit/c468d1f819579524795cf2f533871efe9931dd6f))

## [1.1.0](https://github.com/vivantel/rag_core/compare/v1.0.0...v1.1.0) (2026-05-31)


### Features

* test trusted publisher automation ([7fd08b9](https://github.com/vivantel/rag_core/commit/7fd08b96f32e7f7c2c2c02ec7e2eebb761d5fa7f))

## 1.0.0 (2026-05-31)


### Features

* test trusted publisher automation ([8a8cf1f](https://github.com/vivantel/rag_core/commit/8a8cf1f05ab420ebfcaba5653819d0d5e5c5fc2f))
* test trusted publisher automation ([b2638cd](https://github.com/vivantel/rag_core/commit/b2638cd58abbfe073db51ef2fd0146594a99c55f))
* test trusted publisher automation ([c524461](https://github.com/vivantel/rag_core/commit/c5244615cf7e5e91457446b43d62efdd7928273c))

## [Unreleased]

### Added
- Initial release

### Changed

### Deprecated

### Removed

### Fixed

### Security
