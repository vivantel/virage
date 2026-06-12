# Changelog

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
