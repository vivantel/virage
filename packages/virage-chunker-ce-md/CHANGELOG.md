# Changelog

## [0.1.6](https://github.com/vivantel/virage/compare/virage-chunker-ce-md@v0.1.5...virage-chunker-ce-md@v0.1.6) (2026-06-26)


### Features

* **ce:** Migrate virage-chunkers-ce packages into virage monorepo ([b52df72](https://github.com/vivantel/virage/commit/b52df72253479e8166db8015c81cc15c92538f05))


### Bug Fixes

* **mcp:** Apply prettier formatting to searchConfig type ([939f477](https://github.com/vivantel/virage/commit/939f4776813e4daba1a4d65427d20da51ee311b7))
* Retrigger release pipeline ([bd6b99c](https://github.com/vivantel/virage/commit/bd6b99c1332397e92259a37097f44a556cdc1b7e))
* **virage-reranker-cross-encoder:** Wire up vitest and add unit tests ([90bb477](https://github.com/vivantel/virage/commit/90bb477a5059f2cce28e5f37c8dd8beef256218f))


### Code Refactoring

* **virage-cli:** Apply prettier formatting ([a74ffb2](https://github.com/vivantel/virage/commit/a74ffb26cebc0a6979dc1a0e0243381b741347fe))
* **virage-core:** Apply prettier formatting ([97c697a](https://github.com/vivantel/virage/commit/97c697a9a46697e6bb6c94977f74b6b56de1ab28))
* **virage-mcp:** Apply prettier formatting ([05428d5](https://github.com/vivantel/virage/commit/05428d56514a74e176e0d223aecdb459e60064ac))


### Dependencies

* The following workspace dependencies were updated
  * peerDependencies
    * @vivantel/virage-chunker-ce-ast bumped from >=0.1 to >=0.1.5

## [0.1.5](https://github.com/vivantel/virage-chunkers-ce/compare/virage-chunker-ce-md@v0.1.4...virage-chunker-ce-md@v0.1.5) (2026-06-26)


### Features

* Three-field flat ArtifactSet with generator IDs; add virage-chunker-ce-ts ([b4d4aed](https://github.com/vivantel/virage-chunkers-ce/commit/b4d4aed51498e785ea778a0be8aed9bf374cbbf6))


### Dependencies

* The following workspace dependencies were updated
  * peerDependencies
    * @vivantel/virage-chunker-ce-ast bumped from >=0.1 to >=0.1.4

## [0.1.4](https://github.com/vivantel/virage-chunkers-ce/compare/virage-chunker-ce-md@v0.1.3...virage-chunker-ce-md@v0.1.4) (2026-06-26)


### Bug Fixes

* Pass file path to Rust; no file bytes cross JS/Rust boundary ([2e304a7](https://github.com/vivantel/virage-chunkers-ce/commit/2e304a731e2fc28783a631fca20274ff9cda3142))


### Dependencies

* The following workspace dependencies were updated
  * peerDependencies
    * @vivantel/virage-chunker-ce-ast bumped from >=0.1 to >=0.1.3

## [0.1.3](https://github.com/vivantel/virage-chunkers-ce/compare/virage-chunker-ce-md@v0.1.2...virage-chunker-ce-md@v0.1.3) (2026-06-26)


### Bug Fixes

* **virage-chunker-ce-md:** Load native binding from platform stub when .node not beside dist/ ([23ce79c](https://github.com/vivantel/virage-chunkers-ce/commit/23ce79ca77b60ba43fa54beef07a31bb7ce677ce))

## [0.1.2](https://github.com/vivantel/virage-chunkers-ce/compare/virage-chunker-ce-md@v0.1.1...virage-chunker-ce-md@v0.1.2) (2026-06-24)


### Features

* Add DOCX chunker and Markdown chunker packages ([93af888](https://github.com/vivantel/virage-chunkers-ce/commit/93af888c32f5a27abc26f7988c4a4bc9b2bbdc73))
* **ce-ast:** Port three-artifact model (ArtifactSet) + createNativeChunker factory ([3472e2c](https://github.com/vivantel/virage-chunkers-ce/commit/3472e2c5a354f69acfad0a4ba72a7737f7c3599f))


### Bug Fixes

* **virage-chunker-ce-md:** Load from platform stub packages; bump to 0.1.1 ([b64e5da](https://github.com/vivantel/virage-chunkers-ce/commit/b64e5da05918f203b13ed0fb93e8bc737b747ebf))
