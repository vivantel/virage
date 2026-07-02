# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.10](https://github.com/vivantel/virage/compare/virage-core@v0.3.9...virage-core@v0.3.10) (2026-07-02)


### Bug Fixes

* **ci:** Add patch-lockfile-stubs step to publish job ([867d028](https://github.com/vivantel/virage/commit/867d0289e2c1c90f9d2fa977117a90fc9b527cb7))

## [0.3.9](https://github.com/vivantel/virage/compare/virage-core@v0.3.8...virage-core@v0.3.9) (2026-07-02)


### Bug Fixes

* **core:** Prevent false force-reindex when providerDimensions is null in existing DB ([e053846](https://github.com/vivantel/virage/commit/e053846fdb31311b131dd39e6da60314bee9e33f))

## [0.3.8](https://github.com/vivantel/virage/compare/virage-core@v0.3.7...virage-core@v0.3.8) (2026-07-02)


### Bug Fixes

* Repair existingHashes caching, zero-chunk loop, and ETA display ([4a32312](https://github.com/vivantel/virage/commit/4a32312e05d377669eafa4ed91b5085798f6a7ba))

## [0.3.7](https://github.com/vivantel/virage/compare/virage-core@v0.3.6...virage-core@v0.3.7) (2026-07-02)


### Features

* **index:** Cache-aware embedding, skipped count display, debug logging, timestamps ([77917f4](https://github.com/vivantel/virage/commit/77917f4621ff935716024f9354b4974192beb4ae))

## [0.3.6](https://github.com/vivantel/virage/compare/virage-core@v0.3.5...virage-core@v0.3.6) (2026-07-01)


### Features

* **phase3:** Source architecture, label pipeline, and ce-lang chunker scaffold ([21af213](https://github.com/vivantel/virage/commit/21af21399087d1631701de143ef587e3124137bd))

## [0.3.5](https://github.com/vivantel/virage/compare/virage-core@v0.3.4...virage-core@v0.3.5) (2026-07-01)


### Features

* **eval:** Add galileo-ai/ragbench HuggingFace retrieval evaluation ([611d39a](https://github.com/vivantel/virage/commit/611d39aebc7061fde5bb8392ae9a482ebf77239d))

## [0.3.4](https://github.com/vivantel/virage/compare/virage-core@v0.3.3...virage-core@v0.3.4) (2026-07-01)


### Features

* **core,cli,ci:** Multi-item cleanup and improvements ([29d3f97](https://github.com/vivantel/virage/commit/29d3f97bdc81eb6e7aa4df4d4037015944c5ff33))

## [0.3.3](https://github.com/vivantel/virage/compare/virage-core@v0.3.2...virage-core@v0.3.3) (2026-07-01)


### Bug Fixes

* **quality:** Read chunks from vector store instead of virage.db ([de0d4c2](https://github.com/vivantel/virage/commit/de0d4c220e884ef689a99d2fe532e348bdcad058))

## [0.3.2](https://github.com/vivantel/virage/compare/virage-core@v0.3.1...virage-core@v0.3.2) (2026-07-01)


### Bug Fixes

* **quality:** Keep chunks in virage.db after upload for quality assessment ([5489ac1](https://github.com/vivantel/virage/commit/5489ac19f8611548b994f06a48bbf65653f8148c))

## [0.3.1](https://github.com/vivantel/virage/compare/virage-core@v0.3.0...virage-core@v0.3.1) (2026-06-30)


### Bug Fixes

* **format:** Reformat 10 files with prettier 3.9.4 ([f671170](https://github.com/vivantel/virage/commit/f6711705cc288da907d63ce329a18695fe077808))

## [0.3.0](https://github.com/vivantel/virage/compare/virage-core@v0.2.63...virage-core@v0.3.0) (2026-06-30)


### ⚠ BREAKING CHANGES

* consolidate eval/benchmark/eval-suite into virage quality command with 26-metric self-assessment

### Features

* Consolidate eval/benchmark/eval-suite into virage quality command with 26-metric self-assessment ([224f679](https://github.com/vivantel/virage/commit/224f679e4d797532a183def4dec1cff0ccb08443))

## [0.2.63](https://github.com/vivantel/virage/compare/virage-core@v0.2.62...virage-core@v0.2.63) (2026-06-27)


### Features

* **eval,cli,dashboard:** Eval restructure, CLI aliases, dashboard LanceDB + search + log ([cc9021c](https://github.com/vivantel/virage/commit/cc9021c968524074ba1d35b5d7cce7f11778036e))

## [0.2.62](https://github.com/vivantel/virage/compare/virage-core@v0.2.61...virage-core@v0.2.62) (2026-06-26)


### Bug Fixes

* **eval:** Correctness fixes for recallAtK, adaptive tuner, and suite-runner ([2c566e0](https://github.com/vivantel/virage/commit/2c566e049e2393f142cfa944ee97d0823d48957b))

## [0.2.61](https://github.com/vivantel/virage/compare/virage-core@v0.2.60...virage-core@v0.2.61) (2026-06-26)


### Bug Fixes

* **core:** Abort pipeline and exit non-zero on first embed chain error ([c9a0d84](https://github.com/vivantel/virage/commit/c9a0d8444131e7ab50b7a313868d3e36c403ab9f))

## [0.2.60](https://github.com/vivantel/virage/compare/virage-core@v0.2.59...virage-core@v0.2.60) (2026-06-26)


### Features

* **core:** Add per-chunker include/ignore path filters ([dc36997](https://github.com/vivantel/virage/commit/dc369973af14e74210ddb281d1af61f176c46b41))

## [0.2.59](https://github.com/vivantel/virage/compare/virage-core@v0.2.58...virage-core@v0.2.59) (2026-06-26)


### Features

* Implement three-field flat model with generator IDs (ADR-036/037/038) ([94783cd](https://github.com/vivantel/virage/commit/94783cd55d9f0d7de8c7d7b8a4b14a5406541ad6))


### Bug Fixes

* **virage-core:** Compute denseTextHash in ChunkProcessor if chunker omits it ([3cc67a0](https://github.com/vivantel/virage/commit/3cc67a01a759d65f51518bda65f48c7c29a19ebb))

## [0.2.58](https://github.com/vivantel/virage/compare/virage-core@v0.2.57...virage-core@v0.2.58) (2026-06-26)


### Features

* **core:** Four-artifact chunk model with plugin-only chunkers ([453ef4c](https://github.com/vivantel/virage/commit/453ef4c227b53109f5a42b43b941597cccd59b52))


### Documentation

* Update INDEX.md and virage-core README for four-artifact model ([dc351b6](https://github.com/vivantel/virage/commit/dc351b6915e5160beb34ec8b9646dbbc37ba74dc))

## [0.2.57](https://github.com/vivantel/virage/compare/virage-core@v0.2.56...virage-core@v0.2.57) (2026-06-24)


### Features

* **eval:** Add CE-Markdown chunker eval suite; extend config-loader for package-name strategies ([610c4b7](https://github.com/vivantel/virage/commit/610c4b7a2eef49198ad16a89dfb8eb5ee8ef1739))

## [0.2.56](https://github.com/vivantel/virage/compare/virage-core@v0.2.55...virage-core@v0.2.56) (2026-06-23)


### Bug Fixes

* **cli:** Eval reliability, logging guardrails, cross-encoder batch inference ([27a0811](https://github.com/vivantel/virage/commit/27a08114200719a37cb30ec617cb051e394b9a47))

## [0.2.55](https://github.com/vivantel/virage/compare/virage-core@v0.2.54...virage-core@v0.2.55) (2026-06-22)


### Bug Fixes

* **deps:** Add tar@^7.5.16 to virage-cli; drop @types/tar from virage-core ([6683106](https://github.com/vivantel/virage/commit/66831067eb9ff06a16b48ec735e8a167dfdeb871))

## [0.2.54](https://github.com/vivantel/virage/compare/virage-core@v0.2.53...virage-core@v0.2.54) (2026-06-22)


### Features

* **cli:** Unified verbosity-aware output system with spinner and telemetry ([4d4ff69](https://github.com/vivantel/virage/commit/4d4ff696088576cb41622be6d09b209056fb168c))

## [0.2.53](https://github.com/vivantel/virage/compare/virage-core@v0.2.52...virage-core@v0.2.53) (2026-06-22)


### Bug Fixes

* **eval:** Increase spawnSync maxBuffer to 50 MB for npm stderr ([46b558d](https://github.com/vivantel/virage/commit/46b558d92d7367c1f24ddef15b1abfa6275a8336))

## [0.2.52](https://github.com/vivantel/virage/compare/virage-core@v0.2.51...virage-core@v0.2.52) (2026-06-21)


### Bug Fixes

* **eval:** Ignore npm stdout in spawnSync to prevent buffer overflow ([fe22c66](https://github.com/vivantel/virage/commit/fe22c661fad46a20e39fc1cc2e318b4c19668b4d))

## [0.2.51](https://github.com/vivantel/virage/compare/virage-core@v0.2.50...virage-core@v0.2.51) (2026-06-21)


### Features

* **eval:** Incremental verbosity for eval-suite run (-v … -vvvv) ([4c0e5c1](https://github.com/vivantel/virage/commit/4c0e5c1bcddeb467a31a96c758674da8769b1b5b))

## [0.2.50](https://github.com/vivantel/virage/compare/virage-core@v0.2.49...virage-core@v0.2.50) (2026-06-21)


### Bug Fixes

* **eval:** Pass search config to EvalRunner so variants actually differ ([c86b224](https://github.com/vivantel/virage/commit/c86b224203763329fc3c4fab94e9db47669be21a))

## [0.2.49](https://github.com/vivantel/virage/compare/virage-core@v0.2.48...virage-core@v0.2.49) (2026-06-21)


### Bug Fixes

* Resolve npm ENOENT on Windows by using npm.cmd + shell:true ([7ad0c98](https://github.com/vivantel/virage/commit/7ad0c98f959df977b0b7faf050e8c8ae3258fba7))

## [0.2.48](https://github.com/vivantel/virage/compare/virage-core@v0.2.47...virage-core@v0.2.48) (2026-06-21)


### Bug Fixes

* **eval:** Fix terminated error, refactor suite.json with filesets, add CLI self-update ([da78c29](https://github.com/vivantel/virage/commit/da78c291853a0108e80acef438d6d2734a799b7b))

## [0.2.47](https://github.com/vivantel/virage/compare/virage-core@v0.2.46...virage-core@v0.2.47) (2026-06-21)


### Features

* **eval:** Multi-config eval-suite runner, golden dataset, and eval-matrix script ([0ffb07c](https://github.com/vivantel/virage/commit/0ffb07c2a3a9c6e21919a3ebd3ada4a99dd4cf47))
* **eval:** Plugin version isolation, config params output, eval roadmap ([ee137b7](https://github.com/vivantel/virage/commit/ee137b740667fca2b95427ccd19cf15a43e6c7a8))

## [0.2.46](https://github.com/vivantel/virage/compare/virage-core@v0.2.45...virage-core@v0.2.46) (2026-06-20)


### Features

* **cli:** Add --config to update/dashboard, consistent output, vector-store-first caching, query matrix script ([736475a](https://github.com/vivantel/virage/commit/736475a2d60dc88abccc07bf3574af6d20f7b613))

## [0.2.45](https://github.com/vivantel/virage/compare/virage-core@v0.2.44...virage-core@v0.2.45) (2026-06-20)


### Bug Fixes

* **mcp:** Apply prettier formatting to searchConfig type ([939f477](https://github.com/vivantel/virage/commit/939f4776813e4daba1a4d65427d20da51ee311b7))

## [0.2.44](https://github.com/vivantel/virage/compare/virage-core@v0.2.43...virage-core@v0.2.44) (2026-06-20)


### Features

* **reranker,core,cli,mcp:** Sigmoid score calibration and candidate oversampling ([9e896dc](https://github.com/vivantel/virage/commit/9e896dc7cd98f476127ab95d64f0cbde661ac7ef))

## [0.2.43](https://github.com/vivantel/virage/compare/virage-core@v0.2.42...virage-core@v0.2.43) (2026-06-20)


### Bug Fixes

* **cli,core,reranker:** Correct plugin spawn, reranker scoring, RRF normalization, and up-to-date messaging ([5f67d65](https://github.com/vivantel/virage/commit/5f67d65f693c78204cdd8498ae129ef3f8650c84))

## [0.2.42](https://github.com/vivantel/virage/compare/virage-core@v0.2.41...virage-core@v0.2.42) (2026-06-20)


### Bug Fixes

* **cli,core,reranker:** Resolve 6 post-release bugs ([4c75455](https://github.com/vivantel/virage/commit/4c75455b3b9214ff2ab856b8a7c8f2b49bcb1dcd))

## [0.2.41](https://github.com/vivantel/virage/compare/virage-core@v0.2.40...virage-core@v0.2.41) (2026-06-20)


### Bug Fixes

* **cli:** Resolve UX and correctness bugs across init/update/index/query ([3ee74b5](https://github.com/vivantel/virage/commit/3ee74b58d707f2050517fb860389c650a47584ae))

## [0.2.40](https://github.com/vivantel/virage/compare/virage-core@v0.2.39...virage-core@v0.2.40) (2026-06-20)


### Features

* Incremental indexing, semaphore back pressure, keyboard nav, and UX fixes ([098a3d9](https://github.com/vivantel/virage/commit/098a3d93f151bef3ff74c78f5da0ec566723151b))

## [0.2.39](https://github.com/vivantel/virage/compare/virage-core@v0.2.38...virage-core@v0.2.39) (2026-06-20)


### Features

* UX, back pressure, validate, and banner improvements ([ea2b239](https://github.com/vivantel/virage/commit/ea2b23973c8fc5933829bc75ea7f27b63500e847))

## [0.2.38](https://github.com/vivantel/virage/compare/virage-core@v0.2.37...virage-core@v0.2.38) (2026-06-20)


### Bug Fixes

* Prettier formatting fixes after chunking/exclude changes ([640a168](https://github.com/vivantel/virage/commit/640a168d1c7a3b7ec716b353eb8074d65d9429b4))

## [0.2.37](https://github.com/vivantel/virage/compare/virage-core@v0.2.36...virage-core@v0.2.37) (2026-06-20)


### Features

* **virage-core:** Chunking exclude patterns, parallel scanning/chunking, global model dir, GPU support ([f91c1c8](https://github.com/vivantel/virage/commit/f91c1c8a4e0e27ddadf4228a45faf0a862bd3d88))

## [0.2.36](https://github.com/vivantel/virage/compare/virage-core@v0.2.35...virage-core@v0.2.36) (2026-06-20)


### Bug Fixes

* **virage-core:** Resolve ESM-only plugins from plugin dirs by direct file URL ([b05dc32](https://github.com/vivantel/virage/commit/b05dc32efacb9d8453c60af540b28047de458c40))

## [0.2.35](https://github.com/vivantel/virage/compare/virage-core@v0.2.34...virage-core@v0.2.35) (2026-06-19)


### Features

* **virage-cli,virage-core:** Plugin dir storage + init wizard refactor ([d4e02fa](https://github.com/vivantel/virage/commit/d4e02fa8c222f01bbdba21a27a196a5b4d5809da))

## [0.2.34](https://github.com/vivantel/virage/compare/virage-core@v0.2.33...virage-core@v0.2.34) (2026-06-19)


### Bug Fixes

* **virage-git-isomorphic:** Apply prettier formatting to new files ([eb2a77d](https://github.com/vivantel/virage/commit/eb2a77d44b8fa220037870c6ba8bb63d076d6003))

## [0.2.33](https://github.com/vivantel/virage/compare/virage-core@v0.2.32...virage-core@v0.2.33) (2026-06-19)


### Features

* **virage-core:** Add SourceRepository abstraction and switch to blob SHA tracking ([2458899](https://github.com/vivantel/virage/commit/245889997fbf2677f7523e6916155d373c905d08))


### Bug Fixes

* **virage:** Hide cursor during progress, fix embedding cache, fix model progress ([394f949](https://github.com/vivantel/virage/commit/394f9495c79a02fef907ebaa119add954c9c402b))

## [0.2.32](https://github.com/vivantel/virage/compare/virage-core@v0.2.31...virage-core@v0.2.32) (2026-06-19)


### Bug Fixes

* **virage-cli:** Progress display polish ([918c84d](https://github.com/vivantel/virage/commit/918c84d7200730b37eecd6df1a76e4c2fc97a233))

## [0.2.31](https://github.com/vivantel/virage/compare/virage-core@v0.2.30...virage-core@v0.2.31) (2026-06-19)


### Features

* **virage-cli:** Progress reporting overhaul ([e5a960d](https://github.com/vivantel/virage/commit/e5a960dc0d56d6312c308f35071e8df736591d60))

## [0.2.30](https://github.com/vivantel/virage/compare/virage-core@v0.2.29...virage-core@v0.2.30) (2026-06-19)


### Features

* **virage-cli:** Add hybrid search step to init wizard; fix global package resolution ([9accf69](https://github.com/vivantel/virage/commit/9accf6911bdc642bb71021f027d0d8e145a9c803))

## [0.2.29](https://github.com/vivantel/virage/compare/virage-core@v0.2.28...virage-core@v0.2.29) (2026-06-18)


### Bug Fixes

* **virage-reranker-cross-encoder:** Wire up vitest and add unit tests ([90bb477](https://github.com/vivantel/virage/commit/90bb477a5059f2cce28e5f37c8dd8beef256218f))

## [0.2.28](https://github.com/vivantel/virage/compare/virage-core@v0.2.27...virage-core@v0.2.28) (2026-06-17)


### Bug Fixes

* Apply prettier and eslint formatting to new files ([87d882e](https://github.com/vivantel/virage/commit/87d882ec7661dcfcf7e570b067cbd6bc28d661e3))

## [0.2.27](https://github.com/vivantel/virage/compare/virage-core@v0.2.26...virage-core@v0.2.27) (2026-06-17)


### Features

* Hybrid search, re-ranking layer, and query analytics ([4a64c64](https://github.com/vivantel/virage/commit/4a64c64fce7c68a75656a4e306997d87dcd6253d))

## [0.2.26](https://github.com/vivantel/virage/compare/virage-core@v0.2.25...virage-core@v0.2.26) (2026-06-17)


### Bug Fixes

* Retrigger release pipeline ([bd6b99c](https://github.com/vivantel/virage/commit/bd6b99c1332397e92259a37097f44a556cdc1b7e))

## [0.2.25](https://github.com/vivantel/virage/compare/virage-core@v0.2.24...virage-core@v0.2.25) (2026-06-15)


### Features

* **virage-core,virage-cli,virage-agent-claude:** Branch-aware RAG, search command & index slash command ([6888bef](https://github.com/vivantel/virage/commit/6888befb52373500627437a9fcc636048c0b5719))


### Bug Fixes

* **virage-core:** Deduplicate upload batch by contentHash to prevent LanceDB merge-insert conflict ([d546293](https://github.com/vivantel/virage/commit/d546293c000514cd722cad99ce3d909d0bcf0f1d))

## [0.2.24](https://github.com/vivantel/virage/compare/virage-core@v0.2.23...virage-core@v0.2.24) (2026-06-15)


### Features

* **virage-agent-claude:** Token efficiency, skill routing & recency search (v1.2.1) ([b91395b](https://github.com/vivantel/virage/commit/b91395bc51e8777151c37a5694d0f53c76cbcc44))

## [0.2.23](https://github.com/vivantel/virage/compare/virage-core@v0.2.22...virage-core@v0.2.23) (2026-06-12)


### Features

* **virage-agent:** Static file copier model for agent plugins (ADR-026) ([52dbd26](https://github.com/vivantel/virage/commit/52dbd26bda5b450011b0a82095f43f2c87e849a2))
* **virage-cli:** Add virage update command and confirmation step to init ([52dbd26](https://github.com/vivantel/virage/commit/52dbd26bda5b450011b0a82095f43f2c87e849a2))
* **virage-core:** Add agents field to config schema ([52dbd26](https://github.com/vivantel/virage/commit/52dbd26bda5b450011b0a82095f43f2c87e849a2))


### Documentation

* Update skill files, READMEs, INDEX.md, ROADMAP.md for ADR-026 batch ([52dbd26](https://github.com/vivantel/virage/commit/52dbd26bda5b450011b0a82095f43f2c87e849a2))

## [0.2.22](https://github.com/vivantel/virage/compare/virage-core@v0.2.21...virage-core@v0.2.22) (2026-06-08)


### Bug Fixes

* Replace rm -rf with rimraf for cross-platform builds, revert lsof inspect hack ([17109b3](https://github.com/vivantel/virage/commit/17109b3fe31803b4e22868e968c8a37072c34504))

## [0.2.21](https://github.com/vivantel/virage/compare/virage-core@v0.2.20...virage-core@v0.2.21) (2026-06-07)


### Code Refactoring

* **virage-cli:** Apply prettier formatting ([a74ffb2](https://github.com/vivantel/virage/commit/a74ffb26cebc0a6979dc1a0e0243381b741347fe))
* **virage-core:** Apply prettier formatting ([97c697a](https://github.com/vivantel/virage/commit/97c697a9a46697e6bb6c94977f74b6b56de1ab28))
* **virage-mcp:** Apply prettier formatting ([05428d5](https://github.com/vivantel/virage/commit/05428d56514a74e176e0d223aecdb459e60064ac))

## [0.2.20](https://github.com/vivantel/virage/compare/virage-core@v0.2.19...virage-core@v0.2.20) (2026-06-07)


### Features

* Rename EmbeddingsDb→VirageDb, consolidate artifacts, add MCP telemetry system ([defc6a0](https://github.com/vivantel/virage/commit/defc6a0271a97bf930dcf379ccef15f36fa0c25d))

## [0.2.19](https://github.com/vivantel/virage/compare/virage-core@v0.2.18...virage-core@v0.2.19) (2026-06-06)


### Features

* **virage-cli:** Use codeChunkAst for code files in init; fix index -vv progress bars ([0cfe3f9](https://github.com/vivantel/virage/commit/0cfe3f9a44dda0ab8a744808093a2367774a39d5))

## [0.2.18](https://github.com/vivantel/virage/compare/virage-core@v0.2.17...virage-core@v0.2.18) (2026-06-06)


### Features

* **virage-code-chunk-chunker:** Add AST-aware code chunking package ([aa7d4c9](https://github.com/vivantel/virage/commit/aa7d4c9c3aa825752528f536cd33deb2f748df48))

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
