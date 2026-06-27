# Changelog

## [0.1.98](https://github.com/vivantel/virage/compare/virage-cli@v0.1.97...virage-cli@v0.1.98) (2026-06-27)


### Features

* **eval,cli,dashboard:** Eval restructure, CLI aliases, dashboard LanceDB + search + log ([cc9021c](https://github.com/vivantel/virage/commit/cc9021c968524074ba1d35b5d7cce7f11778036e))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-core bumped from >=0.2.62 to >=0.2.63

## [0.1.97](https://github.com/vivantel/virage/compare/virage-cli@v0.1.96...virage-cli@v0.1.97) (2026-06-26)


### Features

* **benchmark:** Fix --samples radix bug, add chunker/reranker sub-commands, switch to tokens/sec ([9d41944](https://github.com/vivantel/virage/commit/9d41944a220f2e0e27a44ce4c324b0e53b5bc0ed))
* **init:** Store plugin versions as ~x.y.z tilde ranges for patch auto-update ([73c4aa8](https://github.com/vivantel/virage/commit/73c4aa889ed33ac7abb5b1e66a79b7bb34b07a40))

## [0.1.96](https://github.com/vivantel/virage/compare/virage-cli@v0.1.95...virage-cli@v0.1.96) (2026-06-26)


### Documentation

* **adr:** Add ADR-039, supersede ADR-006, rename INDEX.md, update CLI ([e725ea5](https://github.com/vivantel/virage/commit/e725ea5841123883c31dbf92e0071027e7c6849d))

## [0.1.95](https://github.com/vivantel/virage/compare/virage-cli@v0.1.94...virage-cli@v0.1.95) (2026-06-26)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-core bumped from >=0.2.61 to >=0.2.62

## [0.1.94](https://github.com/vivantel/virage/compare/virage-cli@v0.1.93...virage-cli@v0.1.94) (2026-06-26)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-core bumped from >=0.2.60 to >=0.2.61

## [0.1.93](https://github.com/vivantel/virage/compare/virage-cli@v0.1.92...virage-cli@v0.1.93) (2026-06-26)


### Features

* **core:** Add per-chunker include/ignore path filters ([dc36997](https://github.com/vivantel/virage/commit/dc369973af14e74210ddb281d1af61f176c46b41))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-core bumped from >=0.2.59 to >=0.2.60

## [0.1.92](https://github.com/vivantel/virage/compare/virage-cli@v0.1.91...virage-cli@v0.1.92) (2026-06-26)


### Features

* Implement three-field flat model with generator IDs (ADR-036/037/038) ([94783cd](https://github.com/vivantel/virage/commit/94783cd55d9f0d7de8c7d7b8a4b14a5406541ad6))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-core bumped from >=0.2.58 to >=0.2.59

## [0.1.91](https://github.com/vivantel/virage/compare/virage-cli@v0.1.90...virage-cli@v0.1.91) (2026-06-26)


### Features

* **core:** Four-artifact chunk model with plugin-only chunkers ([453ef4c](https://github.com/vivantel/virage/commit/453ef4c227b53109f5a42b43b941597cccd59b52))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-core bumped from >=0.2.0 <0.3.0 to >=0.2.58

## [0.1.90](https://github.com/vivantel/virage/compare/virage-cli@v0.1.89...virage-cli@v0.1.90) (2026-06-25)


### Features

* **cli:** Switch init to CE chunker packages with semver and strategyOptions support ([00c5641](https://github.com/vivantel/virage/commit/00c564122412a679da77faf7aecd206cca7b3e3c))

## [0.1.89](https://github.com/vivantel/virage/compare/virage-cli@v0.1.88...virage-cli@v0.1.89) (2026-06-24)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-core bumped from 0.2.56 to 0.2.57

## [0.1.88](https://github.com/vivantel/virage/compare/virage-cli@v0.1.87...virage-cli@v0.1.88) (2026-06-23)


### Bug Fixes

* **cli:** Eval reliability, logging guardrails, cross-encoder batch inference ([27a0811](https://github.com/vivantel/virage/commit/27a08114200719a37cb30ec617cb051e394b9a47))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-core bumped from 0.2.55 to 0.2.56

## [0.1.87](https://github.com/vivantel/virage/compare/virage-cli@v0.1.86...virage-cli@v0.1.87) (2026-06-22)


### Bug Fixes

* **deps:** Add tar@^7.5.16 to virage-cli; drop @types/tar from virage-core ([6683106](https://github.com/vivantel/virage/commit/66831067eb9ff06a16b48ec735e8a167dfdeb871))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-core bumped from 0.2.54 to 0.2.55

## [0.1.86](https://github.com/vivantel/virage/compare/virage-cli@v0.1.85...virage-cli@v0.1.86) (2026-06-22)


### Bug Fixes

* **cli:** Restore suggestedIndexes output in runStorePerf; route out.warn to console.warn ([2f9492c](https://github.com/vivantel/virage/commit/2f9492c17a7184f19a6ef0deef33a90ea7f17aab))

## [0.1.85](https://github.com/vivantel/virage/compare/virage-cli@v0.1.84...virage-cli@v0.1.85) (2026-06-22)


### Features

* **cli:** Unified verbosity-aware output system with spinner and telemetry ([4d4ff69](https://github.com/vivantel/virage/commit/4d4ff696088576cb41622be6d09b209056fb168c))


### Bug Fixes

* **cli:** Use out.divider with cyan color in query-cmd; add color param to divider() ([c93baf8](https://github.com/vivantel/virage/commit/c93baf820f415f84a9da2633eee5b9bcf5dd95d9))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-core bumped from 0.2.53 to 0.2.54

## [0.1.84](https://github.com/vivantel/virage/compare/virage-cli@v0.1.83...virage-cli@v0.1.84) (2026-06-22)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-core bumped from 0.2.52 to 0.2.53

## [0.1.83](https://github.com/vivantel/virage/compare/virage-cli@v0.1.82...virage-cli@v0.1.83) (2026-06-21)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-core bumped from 0.2.51 to 0.2.52

## [0.1.82](https://github.com/vivantel/virage/compare/virage-cli@v0.1.81...virage-cli@v0.1.82) (2026-06-21)


### Features

* **eval:** Incremental verbosity for eval-suite run (-v … -vvvv) ([4c0e5c1](https://github.com/vivantel/virage/commit/4c0e5c1bcddeb467a31a96c758674da8769b1b5b))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-core bumped from 0.2.50 to 0.2.51

## [0.1.81](https://github.com/vivantel/virage/compare/virage-cli@v0.1.80...virage-cli@v0.1.81) (2026-06-21)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-core bumped from 0.2.49 to 0.2.50

## [0.1.80](https://github.com/vivantel/virage/compare/virage-cli@v0.1.79...virage-cli@v0.1.80) (2026-06-21)


### Bug Fixes

* Resolve npm ENOENT on Windows by using npm.cmd + shell:true ([7ad0c98](https://github.com/vivantel/virage/commit/7ad0c98f959df977b0b7faf050e8c8ae3258fba7))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-core bumped from 0.2.48 to 0.2.49

## [0.1.79](https://github.com/vivantel/virage/compare/virage-cli@v0.1.78...virage-cli@v0.1.79) (2026-06-21)


### Bug Fixes

* **eval:** Fix terminated error, refactor suite.json with filesets, add CLI self-update ([da78c29](https://github.com/vivantel/virage/commit/da78c291853a0108e80acef438d6d2734a799b7b))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-core bumped from 0.2.47 to 0.2.48

## [0.1.78](https://github.com/vivantel/virage/compare/virage-cli@v0.1.77...virage-cli@v0.1.78) (2026-06-21)


### Features

* **eval:** Multi-config eval-suite runner, golden dataset, and eval-matrix script ([0ffb07c](https://github.com/vivantel/virage/commit/0ffb07c2a3a9c6e21919a3ebd3ada4a99dd4cf47))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-core bumped from 0.2.46 to 0.2.47

## [0.1.77](https://github.com/vivantel/virage/compare/virage-cli@v0.1.76...virage-cli@v0.1.77) (2026-06-20)


### Features

* **cli:** Add --config to update/dashboard, consistent output, vector-store-first caching, query matrix script ([736475a](https://github.com/vivantel/virage/commit/736475a2d60dc88abccc07bf3574af6d20f7b613))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-core bumped from 0.2.45 to 0.2.46

## [0.1.76](https://github.com/vivantel/virage/compare/virage-cli@v0.1.75...virage-cli@v0.1.76) (2026-06-20)


### Bug Fixes

* **mcp:** Apply prettier formatting to searchConfig type ([939f477](https://github.com/vivantel/virage/commit/939f4776813e4daba1a4d65427d20da51ee311b7))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-agent-claude bumped from 0.2.25 to 0.2.26
    * @vivantel/virage-core bumped from 0.2.44 to 0.2.45
    * @vivantel/virage-skills bumped from 0.1.8 to 0.1.9

## [0.1.75](https://github.com/vivantel/virage/compare/virage-cli@v0.1.74...virage-cli@v0.1.75) (2026-06-20)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-agent-claude bumped from 0.2.24 to 0.2.25

## [0.1.74](https://github.com/vivantel/virage/compare/virage-cli@v0.1.73...virage-cli@v0.1.74) (2026-06-20)


### Features

* **reranker,core,cli,mcp:** Sigmoid score calibration and candidate oversampling ([9e896dc](https://github.com/vivantel/virage/commit/9e896dc7cd98f476127ab95d64f0cbde661ac7ef))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-core bumped from 0.2.43 to 0.2.44

## [0.1.73](https://github.com/vivantel/virage/compare/virage-cli@v0.1.72...virage-cli@v0.1.73) (2026-06-20)


### Bug Fixes

* **cli,core,reranker:** Correct plugin spawn, reranker scoring, RRF normalization, and up-to-date messaging ([5f67d65](https://github.com/vivantel/virage/commit/5f67d65f693c78204cdd8498ae129ef3f8650c84))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-core bumped from 0.2.42 to 0.2.43

## [0.1.72](https://github.com/vivantel/virage/compare/virage-cli@v0.1.71...virage-cli@v0.1.72) (2026-06-20)


### Bug Fixes

* **cli,core,reranker:** Resolve 6 post-release bugs ([4c75455](https://github.com/vivantel/virage/commit/4c75455b3b9214ff2ab856b8a7c8f2b49bcb1dcd))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-core bumped from 0.2.41 to 0.2.42

## [0.1.71](https://github.com/vivantel/virage/compare/virage-cli@v0.1.70...virage-cli@v0.1.71) (2026-06-20)


### Bug Fixes

* **cli:** Resolve UX and correctness bugs across init/update/index/query ([3ee74b5](https://github.com/vivantel/virage/commit/3ee74b58d707f2050517fb860389c650a47584ae))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-core bumped from 0.2.40 to 0.2.41

## [0.1.70](https://github.com/vivantel/virage/compare/virage-cli@v0.1.69...virage-cli@v0.1.70) (2026-06-20)


### Features

* Incremental indexing, semaphore back pressure, keyboard nav, and UX fixes ([098a3d9](https://github.com/vivantel/virage/commit/098a3d93f151bef3ff74c78f5da0ec566723151b))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-core bumped from 0.2.39 to 0.2.40

## [0.1.69](https://github.com/vivantel/virage/compare/virage-cli@v0.1.68...virage-cli@v0.1.69) (2026-06-20)


### Features

* UX, back pressure, validate, and banner improvements ([ea2b239](https://github.com/vivantel/virage/commit/ea2b23973c8fc5933829bc75ea7f27b63500e847))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-core bumped from 0.2.38 to 0.2.39

## [0.1.68](https://github.com/vivantel/virage/compare/virage-cli@v0.1.67...virage-cli@v0.1.68) (2026-06-20)


### Bug Fixes

* Prettier formatting fixes after chunking/exclude changes ([640a168](https://github.com/vivantel/virage/commit/640a168d1c7a3b7ec716b353eb8074d65d9429b4))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-core bumped from 0.2.37 to 0.2.38

## [0.1.67](https://github.com/vivantel/virage/compare/virage-cli@v0.1.66...virage-cli@v0.1.67) (2026-06-20)


### Features

* **virage-core:** Chunking exclude patterns, parallel scanning/chunking, global model dir, GPU support ([f91c1c8](https://github.com/vivantel/virage/commit/f91c1c8a4e0e27ddadf4228a45faf0a862bd3d88))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-core bumped from 0.2.36 to 0.2.37

## [0.1.66](https://github.com/vivantel/virage/compare/virage-cli@v0.1.65...virage-cli@v0.1.66) (2026-06-20)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-core bumped from 0.2.35 to 0.2.36

## [0.1.65](https://github.com/vivantel/virage/compare/virage-cli@v0.1.64...virage-cli@v0.1.65) (2026-06-19)


### Documentation

* Add virage-code-chunk-chunker to README pluginVersions examples ([a1c7693](https://github.com/vivantel/virage/commit/a1c769343202b681130c56ee3dcf4082b7f266f5))

## [0.1.64](https://github.com/vivantel/virage/compare/virage-cli@v0.1.63...virage-cli@v0.1.64) (2026-06-19)


### Features

* **virage-cli,virage-core:** Plugin dir storage + init wizard refactor ([d4e02fa](https://github.com/vivantel/virage/commit/d4e02fa8c222f01bbdba21a27a196a5b4d5809da))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-core bumped from 0.2.34 to 0.2.35

## [0.1.63](https://github.com/vivantel/virage/compare/virage-cli@v0.1.62...virage-cli@v0.1.63) (2026-06-19)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-core bumped from 0.2.33 to 0.2.34

## [0.1.62](https://github.com/vivantel/virage/compare/virage-cli@v0.1.61...virage-cli@v0.1.62) (2026-06-19)


### Features

* **virage-core:** Add SourceRepository abstraction and switch to blob SHA tracking ([2458899](https://github.com/vivantel/virage/commit/245889997fbf2677f7523e6916155d373c905d08))


### Bug Fixes

* **virage:** Hide cursor during progress, fix embedding cache, fix model progress ([394f949](https://github.com/vivantel/virage/commit/394f9495c79a02fef907ebaa119add954c9c402b))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-core bumped from 0.2.32 to 0.2.33

## [0.1.61](https://github.com/vivantel/virage/compare/virage-cli@v0.1.60...virage-cli@v0.1.61) (2026-06-19)


### Bug Fixes

* **virage-cli:** Eliminate scanning flicker and remove Processed/Total column ([68102e1](https://github.com/vivantel/virage/commit/68102e1676707612bed645a3a77703dd1c47ee01))

## [0.1.60](https://github.com/vivantel/virage/compare/virage-cli@v0.1.59...virage-cli@v0.1.60) (2026-06-19)


### Bug Fixes

* **virage-cli:** Progress display polish ([918c84d](https://github.com/vivantel/virage/commit/918c84d7200730b37eecd6df1a76e4c2fc97a233))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-core bumped from 0.2.31 to 0.2.32

## [0.1.59](https://github.com/vivantel/virage/compare/virage-cli@v0.1.58...virage-cli@v0.1.59) (2026-06-19)


### Features

* **virage-cli:** Progress reporting overhaul ([e5a960d](https://github.com/vivantel/virage/commit/e5a960dc0d56d6312c308f35071e8df736591d60))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-core bumped from 0.2.30 to 0.2.31

## [0.1.58](https://github.com/vivantel/virage/compare/virage-cli@v0.1.57...virage-cli@v0.1.58) (2026-06-19)


### Features

* **virage-cli:** Add hybrid search step to init wizard; fix global package resolution ([9accf69](https://github.com/vivantel/virage/commit/9accf6911bdc642bb71021f027d0d8e145a9c803))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-core bumped from 0.2.29 to 0.2.30

## [0.1.57](https://github.com/vivantel/virage/compare/virage-cli@v0.1.56...virage-cli@v0.1.57) (2026-06-18)


### Bug Fixes

* **virage-reranker-cross-encoder:** Wire up vitest and add unit tests ([90bb477](https://github.com/vivantel/virage/commit/90bb477a5059f2cce28e5f37c8dd8beef256218f))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-agent-claude bumped from 0.2.23 to 0.2.24
    * @vivantel/virage-core bumped from 0.2.28 to 0.2.29
    * @vivantel/virage-skills bumped from 0.1.7 to 0.1.8

## [0.1.56](https://github.com/vivantel/virage/compare/virage-cli@v0.1.55...virage-cli@v0.1.56) (2026-06-18)


### Bug Fixes

* **chore:** Correct PreToolUse hook syntax and apply Prettier formatting ([357c1c6](https://github.com/vivantel/virage/commit/357c1c6abf60e6eb979b91eb7db6637881a5632a))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-agent-claude bumped from 0.2.22 to 0.2.23

## [0.1.55](https://github.com/vivantel/virage/compare/virage-cli@v0.1.54...virage-cli@v0.1.55) (2026-06-18)


### Features

* **cli,dashboard,agent-claude:** Chunker discovery, claude mcp add, dashboard fixes ([00f6287](https://github.com/vivantel/virage/commit/00f6287857af85828421044b2b0b4c502f577cb3))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-agent-claude bumped from 0.2.21 to 0.2.22

## [0.1.54](https://github.com/vivantel/virage/compare/virage-cli@v0.1.53...virage-cli@v0.1.54) (2026-06-18)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-agent-claude bumped from 0.2.20 to 0.2.21

## [0.1.53](https://github.com/vivantel/virage/compare/virage-cli@v0.1.52...virage-cli@v0.1.53) (2026-06-17)


### Features

* Init defaults, reranker releases, Honeycomb telemetry proxy ([b3f1347](https://github.com/vivantel/virage/commit/b3f134740c5e7621f54dd14ed081e55fb3dbc9f6))

## [0.1.52](https://github.com/vivantel/virage/compare/virage-cli@v0.1.51...virage-cli@v0.1.52) (2026-06-17)


### Documentation

* Update READMEs for eval command consolidation and CLI aliases ([7f88390](https://github.com/vivantel/virage/commit/7f88390934066e28b448086855a58ff1c70e66b4))

## [0.1.51](https://github.com/vivantel/virage/compare/virage-cli@v0.1.50...virage-cli@v0.1.51) (2026-06-17)


### Features

* **cli:** Consolidate eval commands, add aliases, fix update + dashboard ([23ef66a](https://github.com/vivantel/virage/commit/23ef66aaa77a000f86732bd796cb4a5c941362f1))

## [0.1.50](https://github.com/vivantel/virage/compare/virage-cli@v0.1.49...virage-cli@v0.1.50) (2026-06-17)


### Bug Fixes

* Use indirect dynamic import for optional reranker package ([c71cb4d](https://github.com/vivantel/virage/commit/c71cb4d7bc7f794017c073c87766cb3424996c40))

## [0.1.49](https://github.com/vivantel/virage/compare/virage-cli@v0.1.48...virage-cli@v0.1.49) (2026-06-17)


### Bug Fixes

* Add virage-reranker-cross-encoder as devDep to virage-cli for type resolution ([0b62b85](https://github.com/vivantel/virage/commit/0b62b85b21f85cbcfcd0cb769131acf9370c95c0))

## [0.1.48](https://github.com/vivantel/virage/compare/virage-cli@v0.1.47...virage-cli@v0.1.48) (2026-06-17)


### Bug Fixes

* Apply prettier and eslint formatting to new files ([87d882e](https://github.com/vivantel/virage/commit/87d882ec7661dcfcf7e570b067cbd6bc28d661e3))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-core bumped from 0.2.27 to 0.2.28

## [0.1.47](https://github.com/vivantel/virage/compare/virage-cli@v0.1.46...virage-cli@v0.1.47) (2026-06-17)


### Features

* Hybrid search, re-ranking layer, and query analytics ([4a64c64](https://github.com/vivantel/virage/commit/4a64c64fce7c68a75656a4e306997d87dcd6253d))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-core bumped from 0.2.26 to 0.2.27

## [0.1.46](https://github.com/vivantel/virage/compare/virage-cli@v0.1.45...virage-cli@v0.1.46) (2026-06-17)


### Bug Fixes

* Retrigger release pipeline ([bd6b99c](https://github.com/vivantel/virage/commit/bd6b99c1332397e92259a37097f44a556cdc1b7e))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-agent-claude bumped from 0.2.19 to 0.2.20
    * @vivantel/virage-core bumped from 0.2.25 to 0.2.26
    * @vivantel/virage-skills bumped from 0.1.6 to 0.1.7

## [0.1.45](https://github.com/vivantel/virage/compare/virage-cli@v0.1.44...virage-cli@v0.1.45) (2026-06-16)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-agent-claude bumped from 0.2.18 to 0.2.19

## [0.1.44](https://github.com/vivantel/virage/compare/virage-cli@v0.1.43...virage-cli@v0.1.44) (2026-06-16)


### Features

* **virage-agent-claude,virage-cli:** Proactive skill hooks, remove advice-giving ([19ad02d](https://github.com/vivantel/virage/commit/19ad02d3e076d48e17228865cbe5ad8269ce20ff))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-agent-claude bumped from 0.2.17 to 0.2.18
    * @vivantel/virage-skills bumped from 0.1.5 to 0.1.6

## [0.1.43](https://github.com/vivantel/virage/compare/virage-cli@v0.1.42...virage-cli@v0.1.43) (2026-06-15)


### Features

* **virage-core,virage-cli,virage-agent-claude:** Branch-aware RAG, search command & index slash command ([6888bef](https://github.com/vivantel/virage/commit/6888befb52373500627437a9fcc636048c0b5719))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-agent-claude bumped from 0.2.16 to 0.2.17
    * @vivantel/virage-core bumped from 0.2.24 to 0.2.25

## [0.1.42](https://github.com/vivantel/virage/compare/virage-cli@v0.1.41...virage-cli@v0.1.42) (2026-06-15)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-agent-claude bumped from 0.2.15 to 0.2.16

## [0.1.41](https://github.com/vivantel/virage/compare/virage-cli@v0.1.40...virage-cli@v0.1.41) (2026-06-15)


### Features

* **virage-agent-claude:** Token efficiency, skill routing & recency search (v1.2.1) ([b91395b](https://github.com/vivantel/virage/commit/b91395bc51e8777151c37a5694d0f53c76cbcc44))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-agent-claude bumped from 0.2.14 to 0.2.15
    * @vivantel/virage-core bumped from 0.2.23 to 0.2.24
    * @vivantel/virage-skills bumped from 0.1.4 to 0.1.5

## [0.1.40](https://github.com/vivantel/virage/compare/virage-cli@v0.1.39...virage-cli@v0.1.40) (2026-06-14)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-agent-claude bumped from 0.2.13 to 0.2.14

## [0.1.39](https://github.com/vivantel/virage/compare/virage-cli@v0.1.38...virage-cli@v0.1.39) (2026-06-14)


### Bug Fixes

* **virage-cli:** Add missing README (package.json files field references it) ([25e3c6d](https://github.com/vivantel/virage/commit/25e3c6df8618f46981aa4ce046160978d4ca54f1))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-agent-claude bumped from 0.2.12 to 0.2.13

## [0.1.38](https://github.com/vivantel/virage/compare/virage-cli@v0.1.37...virage-cli@v0.1.38) (2026-06-14)


### Bug Fixes

* **virage-agent-claude:** Fix session_usage table formatting; add virage usage CLI ([0a5419e](https://github.com/vivantel/virage/commit/0a5419e5afcad864c840985cc40c532eb26ee317))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-agent-claude bumped from 0.2.11 to 0.2.12

## [0.1.37](https://github.com/vivantel/virage/compare/virage-cli@v0.1.36...virage-cli@v0.1.37) (2026-06-14)


### Bug Fixes

* **virage-agent-claude:** Fix /usage command — wrong MCP tool name and missing auto-configure ([c9eed9d](https://github.com/vivantel/virage/commit/c9eed9d8d8cfc5a0bbfc1dbabc6780b67125e680))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-agent-claude bumped from 0.2.10 to 0.2.11

## [0.1.36](https://github.com/vivantel/virage/compare/virage-cli@v0.1.35...virage-cli@v0.1.36) (2026-06-14)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-agent-claude bumped from 0.2.9 to 0.2.10

## [0.1.35](https://github.com/vivantel/virage/compare/virage-cli@v0.1.34...virage-cli@v0.1.35) (2026-06-14)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-agent-claude bumped from 0.2.8 to 0.2.9

## [0.1.34](https://github.com/vivantel/virage/compare/virage-cli@v0.1.33...virage-cli@v0.1.34) (2026-06-14)


### Features

* **virage-agent:** Rename plugin identifier virage-agent → virage, fix virage-cli chmod ([426e4b5](https://github.com/vivantel/virage/commit/426e4b5f41e50f6f41405265658d5ee2fce2b13a))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-agent-claude bumped from 0.2.7 to 0.2.8

## [0.1.33](https://github.com/vivantel/virage/compare/virage-cli@v0.1.32...virage-cli@v0.1.33) (2026-06-13)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-agent-claude bumped from 0.2.6 to 0.2.7

## [0.1.32](https://github.com/vivantel/virage/compare/virage-cli@v0.1.31...virage-cli@v0.1.32) (2026-06-12)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-agent-claude bumped from 0.2.5 to 0.2.6

## [0.1.31](https://github.com/vivantel/virage/compare/virage-cli@v0.1.30...virage-cli@v0.1.31) (2026-06-12)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-agent-claude bumped from 0.2.4 to 0.2.5

## [0.1.30](https://github.com/vivantel/virage/compare/virage-cli@v0.1.29...virage-cli@v0.1.30) (2026-06-12)


### Bug Fixes

* **virage-agent:** Install claude plugin as skills-dir plugin; fix init UX ([70f368c](https://github.com/vivantel/virage/commit/70f368c889ce15ebd4a26c81cf4fd67a22db094f))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-agent-claude bumped from 0.2.3 to 0.2.4

## [0.1.29](https://github.com/vivantel/virage/compare/virage-cli@v0.1.28...virage-cli@v0.1.29) (2026-06-12)


### Bug Fixes

* **virage-cli:** Format init.ts and update.ts to satisfy prettier ([4cd72e9](https://github.com/vivantel/virage/commit/4cd72e9010286e2dc7269347b10543ad9dec2e59))

## [0.1.28](https://github.com/vivantel/virage/compare/virage-cli@v0.1.27...virage-cli@v0.1.28) (2026-06-12)


### Features

* **virage-agent:** Static file copier model for agent plugins (ADR-026) ([52dbd26](https://github.com/vivantel/virage/commit/52dbd26bda5b450011b0a82095f43f2c87e849a2))
* **virage-cli:** Add virage update command and confirmation step to init ([52dbd26](https://github.com/vivantel/virage/commit/52dbd26bda5b450011b0a82095f43f2c87e849a2))
* **virage-core:** Add agents field to config schema ([52dbd26](https://github.com/vivantel/virage/commit/52dbd26bda5b450011b0a82095f43f2c87e849a2))


### Documentation

* Update skill files, READMEs, INDEX.md, ROADMAP.md for ADR-026 batch ([52dbd26](https://github.com/vivantel/virage/commit/52dbd26bda5b450011b0a82095f43f2c87e849a2))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-agent-claude bumped from 0.2.2 to 0.2.3
    * @vivantel/virage-core bumped from 0.2.22 to 0.2.23
    * @vivantel/virage-skills bumped from 0.1.3 to 0.1.4

## [0.1.27](https://github.com/vivantel/virage/compare/virage-cli@v0.1.26...virage-cli@v0.1.27) (2026-06-12)


### Bug Fixes

* **virage-cli:** Format init.ts to satisfy prettier ([64f0f18](https://github.com/vivantel/virage/commit/64f0f182c54367c66ffa7aca42135cec1f14eadd))

## [0.1.26](https://github.com/vivantel/virage/compare/virage-cli@v0.1.25...virage-cli@v0.1.26) (2026-06-12)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-agent-claude bumped from 0.2.1 to 0.2.2
    * @vivantel/virage-skills bumped from 0.1.2 to 0.1.3

## [0.1.25](https://github.com/vivantel/virage/compare/virage-cli@v0.1.24...virage-cli@v0.1.25) (2026-06-11)


### Features

* **agents:** Add multi-agent hook plugin architecture with 4 vendor integrations ([f739031](https://github.com/vivantel/virage/commit/f7390319b8e5ad54cd1cb669ccd743c48c485725))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-agent-claude bumped from 0.1.2 to 0.2.1

## [0.1.24](https://github.com/vivantel/virage/compare/virage-cli@v0.1.23...virage-cli@v0.1.24) (2026-06-11)


### Features

* **virage-cli:** Rework init wizard step order and add coding agents step ([4706208](https://github.com/vivantel/virage/commit/470620822316aacabc865912083e70fdb0297812))

## [0.1.23](https://github.com/vivantel/virage/compare/virage-cli@v0.1.22...virage-cli@v0.1.23) (2026-06-10)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-agent-claude bumped from 0.1.1 to 0.1.2
    * @vivantel/virage-skills bumped from 0.1.1 to 0.1.2

## [0.1.22](https://github.com/vivantel/virage/compare/virage-cli@v0.1.21...virage-cli@v0.1.22) (2026-06-10)


### Features

* Add redistributable agent skills with Claude Code plugin ([70b5323](https://github.com/vivantel/virage/commit/70b5323b0f3de4476fc5218d61fd8b6054b06f01))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-agent-claude bumped from 0.1.0 to 0.1.1
    * @vivantel/virage-skills bumped from 0.1.0 to 0.1.1

## [0.1.21](https://github.com/vivantel/virage/compare/virage-cli@v0.1.20...virage-cli@v0.1.21) (2026-06-08)


### Bug Fixes

* Replace rm -rf with rimraf for cross-platform builds, revert lsof inspect hack ([17109b3](https://github.com/vivantel/virage/commit/17109b3fe31803b4e22868e968c8a37072c34504))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-core bumped from 0.2.21 to 0.2.22

## [0.1.20](https://github.com/vivantel/virage/compare/virage-cli@v0.1.19...virage-cli@v0.1.20) (2026-06-07)


### Code Refactoring

* **virage-cli:** Apply prettier formatting ([a74ffb2](https://github.com/vivantel/virage/commit/a74ffb26cebc0a6979dc1a0e0243381b741347fe))
* **virage-core:** Apply prettier formatting ([97c697a](https://github.com/vivantel/virage/commit/97c697a9a46697e6bb6c94977f74b6b56de1ab28))
* **virage-mcp:** Apply prettier formatting ([05428d5](https://github.com/vivantel/virage/commit/05428d56514a74e176e0d223aecdb459e60064ac))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-core bumped from 0.2.20 to 0.2.21

## [0.1.19](https://github.com/vivantel/virage/compare/virage-cli@v0.1.18...virage-cli@v0.1.19) (2026-06-07)


### Features

* Rename EmbeddingsDb→VirageDb, consolidate artifacts, add MCP telemetry system ([defc6a0](https://github.com/vivantel/virage/commit/defc6a0271a97bf930dcf379ccef15f36fa0c25d))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-core bumped from 0.2.19 to 0.2.20

## [0.1.18](https://github.com/vivantel/virage/compare/virage-cli@v0.1.17...virage-cli@v0.1.18) (2026-06-06)


### Features

* **virage-cli:** Use codeChunkAst for code files in init; fix index -vv progress bars ([0cfe3f9](https://github.com/vivantel/virage/commit/0cfe3f9a44dda0ab8a744808093a2367774a39d5))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-core bumped from 0.2.18 to 0.2.19

## [0.1.17](https://github.com/vivantel/virage/compare/virage-cli@v0.1.16...virage-cli@v0.1.17) (2026-06-06)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-core bumped from 0.2.17 to 0.2.18

## [0.1.16](https://github.com/vivantel/virage/compare/virage-cli@v0.1.15...virage-cli@v0.1.16) (2026-06-05)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-core bumped from 0.2.16 to 0.2.17

## [0.1.15](https://github.com/vivantel/virage/compare/virage-cli@v0.1.14...virage-cli@v0.1.15) (2026-06-05)


### Bug Fixes

* Use ./eval-dataset.json as default evaluation dataset path ([2d2ea03](https://github.com/vivantel/virage/commit/2d2ea0303fe881d1f96294bf68f454fa41f6841c))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-core bumped from 0.2.15 to 0.2.16

## [0.1.14](https://github.com/vivantel/virage/compare/virage-cli@v0.1.13...virage-cli@v0.1.14) (2026-06-05)

### Bug Fixes

- Await lancedb schema(), fix eval dataset path, single index bar, safe ETA ([54d50a3](https://github.com/vivantel/virage/commit/54d50a3c5713732ff7976b1817099f3862c29099))

## [0.1.13](https://github.com/vivantel/virage/compare/virage-cli@v0.1.12...virage-cli@v0.1.13) (2026-06-05)

### Bug Fixes

- **core:** Propagate embedder dimensions to vectorStore at config load time ([cbfb781](https://github.com/vivantel/virage/commit/cbfb78119b5383dcac426baf8345d1660fd150e2))

### Dependencies

- The following workspace dependencies were updated
  - dependencies
    - @vivantel/virage-core bumped from 0.2.14 to 0.2.15

## [0.1.12](https://github.com/vivantel/virage/compare/virage-cli@v0.1.11...virage-cli@v0.1.12) (2026-06-05)

### Dependencies

- The following workspace dependencies were updated
  - dependencies
    - @vivantel/virage-core bumped from 0.2.13 to 0.2.14

## [0.1.11](https://github.com/vivantel/virage/compare/virage-cli@v0.1.10...virage-cli@v0.1.11) (2026-06-05)

### Features

- Index command, ignorePatterns, lancedb CI, MCP reconnect, drop embeddings.json ([27b77eb](https://github.com/vivantel/virage/commit/27b77eb44cd670f42dd170dfba3e5772a1c2eef7))

### Dependencies

- The following workspace dependencies were updated
  - dependencies
    - @vivantel/virage-core bumped from 0.2.12 to 0.2.13

## [0.1.10](https://github.com/vivantel/virage/compare/virage-cli@v0.1.9...virage-cli@v0.1.10) (2026-06-05)

### Bug Fixes

- **dashboard:** Single WS, \_virage_meta table, source file in search, path normalization ([174aba0](https://github.com/vivantel/virage/commit/174aba0cf398dce4808e32625b30b01fbc94d700))

### Dependencies

- The following workspace dependencies were updated
  - dependencies
    - @vivantel/virage-core bumped from 0.2.11 to 0.2.12

## [0.1.9](https://github.com/vivantel/virage/compare/virage-cli@v0.1.8...virage-cli@v0.1.9) (2026-06-05)

### Bug Fixes

- **virage-cli:** Fix dashboard startup failures with Express 5 ([e2e75d0](https://github.com/vivantel/virage/commit/e2e75d0ae2ac9109b6890ad6312b2ba4e4254636))

## [0.1.8](https://github.com/vivantel/virage/compare/virage-cli@v0.1.7...virage-cli@v0.1.8) (2026-06-04)

### Features

- Generic embedder benchmark, virage-mcp package, and full dashboard ([2174585](https://github.com/vivantel/virage/commit/2174585107bcc5b22ecab8529bd23e5e11794c0f))

## [0.1.7](https://github.com/vivantel/virage/compare/virage-cli@v0.1.6...virage-cli@v0.1.7) (2026-06-04)

### Bug Fixes

- **virage-cli:** Gate verbose/debug/trace logs and add projected embed totals ([29c11e8](https://github.com/vivantel/virage/commit/29c11e84c1cdf3556ee3b9305ad901a203e594b3))

### Dependencies

- The following workspace dependencies were updated
  - dependencies
    - @vivantel/virage-core bumped from 0.2.10 to 0.2.11

## [0.1.6](https://github.com/vivantel/virage/compare/virage-cli@v0.1.5...virage-cli@v0.1.6) (2026-06-04)

### Bug Fixes

- **virage-cli:** Use MultiBar for simultaneous progress bar rendering ([7fe2fb5](https://github.com/vivantel/virage/commit/7fe2fb59799c29436e79c1f41f05151f9f30976d))

## [0.1.5](https://github.com/vivantel/virage/compare/virage-cli@v0.1.4...virage-cli@v0.1.5) (2026-06-04)

### Dependencies

- The following workspace dependencies were updated
  - dependencies
    - @vivantel/virage-core bumped from 0.2.9 to 0.2.10

## [0.1.4](https://github.com/vivantel/virage/compare/virage-cli@v0.1.3...virage-cli@v0.1.4) (2026-06-04)

### Features

- **virage-core:** Streaming pipeline + BLOB embedding schema ([34d9ce1](https://github.com/vivantel/virage/commit/34d9ce1ce43050b6ccb73481c6a636e692c0cd39))

### Dependencies

- The following workspace dependencies were updated
  - dependencies
    - @vivantel/virage-core bumped from 0.2.8 to 0.2.9

## [0.1.3](https://github.com/vivantel/virage/compare/virage-cli@v0.1.2...virage-cli@v0.1.3) (2026-06-04)

### Bug Fixes

- **virage-cli:** Add glob as direct dependency ([cde5913](https://github.com/vivantel/virage/commit/cde5913673803b4d23b9c3e5534c957b299e2fab))

## [0.1.2](https://github.com/vivantel/virage/compare/virage-cli@v0.1.1...virage-cli@v0.1.2) (2026-06-04)

### Features

- **dashboard:** Add multi-project tracking and switching ([9a9622c](https://github.com/vivantel/virage/commit/9a9622c099cf21ca260c97cc13d706d11c86c248))

### Dependencies

- The following workspace dependencies were updated
  - dependencies
    - @vivantel/virage-core bumped from \* to 0.2.8

## [0.1.1](https://github.com/vivantel/virage/compare/virage-cli@v0.1.0...virage-cli@v0.1.1) (2026-06-04)

### Features

- Split virage-core into library + CLI packages; add virage-dashboard ([08dcb95](https://github.com/vivantel/virage/commit/08dcb9551e834462fd2d94e0e8f6255dbda4e391))
- Test trusted publisher automation ([7fd08b9](https://github.com/vivantel/virage/commit/7fd08b96f32e7f7c2c2c02ec7e2eebb761d5fa7f))
- Test trusted publisher automation ([c524461](https://github.com/vivantel/virage/commit/c5244615cf7e5e91457446b43d62efdd7928273c))
