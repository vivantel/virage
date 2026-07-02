# Changelog

## [0.1.6](https://github.com/vivantel/virage/compare/virage-chunker-ce-latex@v0.1.5...virage-chunker-ce-latex@v0.1.6) (2026-07-02)


### Documentation

* **packages:** Add group docs + README stubs for all plugins ([65cf8a2](https://github.com/vivantel/virage/commit/65cf8a27f887a11a502979a53d8dc7cde2af4648))


### Dependencies

* The following workspace dependencies were updated
  * peerDependencies
    * @vivantel/virage-core bumped from >=0.2 to >=0.3.7
    * @vivantel/virage-chunker-ce-ast bumped from >=0.1 to >=0.1.15

## [0.1.5](https://github.com/vivantel/virage/compare/virage-chunker-ce-latex@v0.1.4...virage-chunker-ce-latex@v0.1.5) (2026-06-26)


### Bug Fixes

* **ci:** Fix package-lock, tsconfig.base.json, and lint paths after CE migration ([d9331f9](https://github.com/vivantel/virage/commit/d9331f90830723e375cfa7dde78e3fdf794617ed))
* **ci:** Pass with no tests for virage-chunker-ce-ts, fix repo URLs in CE packages ([51955a5](https://github.com/vivantel/virage/commit/51955a54c2453860fa8add49c7a980a8bd74976b))


### Dependencies

* The following workspace dependencies were updated
  * peerDependencies
    * @vivantel/virage-chunker-ce-ast bumped from >=0.1 to >=0.1.6

## [0.1.4](https://github.com/vivantel/virage/compare/virage-chunker-ce-latex@v0.1.3...virage-chunker-ce-latex@v0.1.4) (2026-06-26)


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

## [0.1.3](https://github.com/vivantel/virage-chunkers-ce/compare/virage-chunker-ce-latex@v0.1.2...virage-chunker-ce-latex@v0.1.3) (2026-06-26)


### Features

* Three-field flat ArtifactSet with generator IDs; add virage-chunker-ce-ts ([b4d4aed](https://github.com/vivantel/virage-chunkers-ce/commit/b4d4aed51498e785ea778a0be8aed9bf374cbbf6))


### Dependencies

* The following workspace dependencies were updated
  * peerDependencies
    * @vivantel/virage-chunker-ce-ast bumped from >=0.1 to >=0.1.4

## [0.1.2](https://github.com/vivantel/virage-chunkers-ce/compare/virage-chunker-ce-latex@v0.1.1...virage-chunker-ce-latex@v0.1.2) (2026-06-26)


### Bug Fixes

* Pass file path to Rust; no file bytes cross JS/Rust boundary ([2e304a7](https://github.com/vivantel/virage-chunkers-ce/commit/2e304a731e2fc28783a631fca20274ff9cda3142))


### Dependencies

* The following workspace dependencies were updated
  * peerDependencies
    * @vivantel/virage-chunker-ce-ast bumped from >=0.1 to >=0.1.3

## [0.1.1](https://github.com/vivantel/virage-chunkers-ce/compare/virage-chunker-ce-latex@v0.1.0...virage-chunker-ce-latex@v0.1.1) (2026-06-24)


### Features

* Add LaTeX chunker package ([e5c03c0](https://github.com/vivantel/virage-chunkers-ce/commit/e5c03c0126badf939872572751797ad2f1ae05a1))
* **ce-ast:** Port three-artifact model (ArtifactSet) + createNativeChunker factory ([3472e2c](https://github.com/vivantel/virage-chunkers-ce/commit/3472e2c5a354f69acfad0a4ba72a7737f7c3599f))
