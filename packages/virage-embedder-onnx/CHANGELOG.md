# Changelog

## [1.0.6](https://github.com/vivantel/virage/compare/virage-embedder-onnx@v1.0.5...virage-embedder-onnx@v1.0.6) (2026-07-08)


### Bug Fixes

* **native:** Use cargo-zigbuild for linux-x64-gnu to target glibc 2.17 ([bfbe23b](https://github.com/vivantel/virage/commit/bfbe23b8363abf8ff2df0aca50b5640c404bf846))


### Dependencies

* The following workspace dependencies were updated
  * peerDependencies
    * @vivantel/virage-core bumped from >=0.2 to >=0.4.10

## [1.0.5](https://github.com/vivantel/virage/compare/virage-embedder-onnx@v1.0.4...virage-embedder-onnx@v1.0.5) (2026-07-04)


### Bug Fixes

* **ci:** Drop darwin-x64; fix linux-arm64 cross-compile toolchain ([3edcf13](https://github.com/vivantel/virage/commit/3edcf130e77e0eeb6115eb72613efad5e6b93a26))

## [1.0.4](https://github.com/vivantel/virage/compare/virage-embedder-onnx@v1.0.3...virage-embedder-onnx@v1.0.4) (2026-07-04)


### Bug Fixes

* **virage-embedder-onnx:** Add tls-native to download-binaries feature for ORT download ([148a323](https://github.com/vivantel/virage/commit/148a323a6d32f2e18daec4406b0317480243b698))

## [1.0.3](https://github.com/vivantel/virage/compare/virage-embedder-onnx@v1.0.2...virage-embedder-onnx@v1.0.3) (2026-07-04)


### Bug Fixes

* **virage-embedder-onnx:** Statically link ORT; add Rust-side logging callback ([c45d7cd](https://github.com/vivantel/virage/commit/c45d7cd973a3f9ac52dca5eb6467d704db1854be))

## [1.0.2](https://github.com/vivantel/virage/compare/virage-embedder-onnx@v1.0.1...virage-embedder-onnx@v1.0.2) (2026-07-04)


### Bug Fixes

* **virage-embedder-onnx:** Wire onProgress in preWarm, stream download with progress and timeout ([0f17f15](https://github.com/vivantel/virage/commit/0f17f15cafb15cb0b8b7f152685d8691aaad454d))

## [1.0.1](https://github.com/vivantel/virage/compare/virage-embedder-onnx@v1.0.0...virage-embedder-onnx@v1.0.1) (2026-07-04)


### Bug Fixes

* **virage-embedder-onnx:** Add defaultConfig to rag-plugin metadata; try onnx/ subdir for model download ([07d9e3e](https://github.com/vivantel/virage/commit/07d9e3e98180b6b072196542d893d02a92099da3))

## 1.0.0 (2026-07-02)


### Features

* **embedder-onnx:** New ONNX Runtime embedder plugin ([0a55d9b](https://github.com/vivantel/virage/commit/0a55d9b900fd6db84fdc6a92e11ef415ca5f68f4))
* **onnx-embedder:** Rewrite virage-embedder-onnx as Rust napi-rs native addon ([745c415](https://github.com/vivantel/virage/commit/745c415b3042431a6cd1caba17e1ab8982859b5c))


### Bug Fixes

* **mcp:** Apply prettier formatting to searchConfig type ([939f477](https://github.com/vivantel/virage/commit/939f4776813e4daba1a4d65427d20da51ee311b7))
* Retrigger release pipeline ([bd6b99c](https://github.com/vivantel/virage/commit/bd6b99c1332397e92259a37097f44a556cdc1b7e))
* **virage-reranker-cross-encoder:** Wire up vitest and add unit tests ([90bb477](https://github.com/vivantel/virage/commit/90bb477a5059f2cce28e5f37c8dd8beef256218f))
