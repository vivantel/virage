# Changelog

## [0.1.4](https://github.com/vivantel/virage/compare/virage-chunker-ce-lang@v0.1.3...virage-chunker-ce-lang@v0.1.4) (2026-07-09)


### Features

* **rust:** Phases 0–9 CE Rust migration, CLI binary, WASM plugin host, workflow refactor ([44c8063](https://github.com/vivantel/virage/commit/44c80633592f542dffc4ce839fe1fa5648ed0f37))


### Dependencies

* The following workspace dependencies were updated
  * peerDependencies
    * @vivantel/virage-core bumped from >=0.2 to >=0.4.11
    * @vivantel/virage-chunker-ce-ast bumped from >=0.1 to >=0.1.30

## [0.1.3](https://github.com/vivantel/virage/compare/virage-chunker-ce-lang@v0.1.2...virage-chunker-ce-lang@v0.1.3) (2026-07-04)


### Bug Fixes

* **chunker:** Add platform stub fallback to native binary loader ([2a97856](https://github.com/vivantel/virage/commit/2a97856bb532607c17e96bfe127a527ed60d6176))

## [0.1.2](https://github.com/vivantel/virage/compare/virage-chunker-ce-lang@v0.1.1...virage-chunker-ce-lang@v0.1.2) (2026-07-04)


### Bug Fixes

* **ci:** Drop darwin-x64; fix linux-arm64 cross-compile toolchain ([3edcf13](https://github.com/vivantel/virage/commit/3edcf130e77e0eeb6115eb72613efad5e6b93a26))

## [0.1.1](https://github.com/vivantel/virage/compare/virage-chunker-ce-lang@v0.1.0...virage-chunker-ce-lang@v0.1.1) (2026-07-03)


### Features

* **onnx-embedder:** Rewrite virage-embedder-onnx as Rust napi-rs native addon ([745c415](https://github.com/vivantel/virage/commit/745c415b3042431a6cd1caba17e1ab8982859b5c))
* **phase3:** Source architecture, label pipeline, and ce-lang chunker scaffold ([21af213](https://github.com/vivantel/virage/commit/21af21399087d1631701de143ef587e3124137bd))
* **virage-cli:** Replace strategy/strategyOptions with package/options in ExtGroup ([7b535d0](https://github.com/vivantel/virage/commit/7b535d0aa389e349cbe64f0c7461b4a022f0cd3c))


### Bug Fixes

* **ce-lang:** Apply cargo fmt to Rust source files ([57337e9](https://github.com/vivantel/virage/commit/57337e9d8062adc159d4df436dd76af2f93745e8))
* **mcp:** Apply prettier formatting to searchConfig type ([939f477](https://github.com/vivantel/virage/commit/939f4776813e4daba1a4d65427d20da51ee311b7))
* Retrigger release pipeline ([bd6b99c](https://github.com/vivantel/virage/commit/bd6b99c1332397e92259a37097f44a556cdc1b7e))
* **virage-reranker-cross-encoder:** Wire up vitest and add unit tests ([90bb477](https://github.com/vivantel/virage/commit/90bb477a5059f2cce28e5f37c8dd8beef256218f))


### Documentation

* **packages:** Add group docs + README stubs for all plugins ([65cf8a2](https://github.com/vivantel/virage/commit/65cf8a27f887a11a502979a53d8dc7cde2af4648))

## Changelog
