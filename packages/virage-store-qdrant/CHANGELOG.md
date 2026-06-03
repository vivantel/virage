# Changelog

## [2.2.3](https://github.com/vivantel/virage/compare/rag-store-qdrant@v2.2.2...rag-store-qdrant@v2.2.3) (2026-06-03)


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @vivantel/rag-core bumped from file:../rag-core to 4.0.0
  * peerDependencies
    * @vivantel/rag-core bumped from ^2.0.0 to ^4.0.0

## [2.2.2](https://github.com/vivantel/virage/compare/rag-store-qdrant@v2.2.1...rag-store-qdrant@v2.2.2) (2026-06-03)


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @vivantel/rag-core bumped from file:../rag-core to 3.4.2
  * peerDependencies
    * @vivantel/rag-core bumped from ^2.0.0 to ^3.4.2

## [2.2.1](https://github.com/vivantel/virage/compare/rag-store-qdrant@v2.2.0...rag-store-qdrant@v2.2.1) (2026-06-03)


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @vivantel/rag-core bumped from file:../rag-core to 3.4.1
  * peerDependencies
    * @vivantel/rag-core bumped from ^2.0.0 to ^3.4.1

## [2.2.0](https://github.com/vivantel/virage/compare/rag-store-qdrant@v2.1.5...rag-store-qdrant@v2.2.0) (2026-06-03)


### Features

* Add Logger abstraction with consola and -v verbosity flag ([cf69a0a](https://github.com/vivantel/virage/commit/cf69a0a903fc54d1b45ab093d2d32e75b68ebc39))


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @vivantel/rag-core bumped from file:../rag-core to 3.4.0
  * peerDependencies
    * @vivantel/rag-core bumped from ^2.0.0 to ^3.4.0

## [2.1.5](https://github.com/vivantel/virage/compare/rag-store-qdrant@v2.1.4...rag-store-qdrant@v2.1.5) (2026-06-02)


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @vivantel/rag-core bumped from file:../rag-core to 3.3.3
  * peerDependencies
    * @vivantel/rag-core bumped from ^2.0.0 to ^3.3.3

## [2.1.4](https://github.com/vivantel/virage/compare/rag-store-qdrant@v2.1.3...rag-store-qdrant@v2.1.4) (2026-06-02)


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @vivantel/rag-core bumped from file:../rag-core to 3.3.2
  * peerDependencies
    * @vivantel/rag-core bumped from ^2.0.0 to ^3.3.2

## [2.1.3](https://github.com/vivantel/virage/compare/rag-store-qdrant@v2.1.2...rag-store-qdrant@v2.1.3) (2026-06-02)


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @vivantel/rag-core bumped from file:../rag-core to 3.3.1
  * peerDependencies
    * @vivantel/rag-core bumped from ^2.0.0 to ^3.3.1

## [2.1.2](https://github.com/vivantel/virage/compare/rag-store-qdrant@v2.1.1...rag-store-qdrant@v2.1.2) (2026-06-02)


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @vivantel/rag-core bumped from file:../rag-core to 3.3.0
  * peerDependencies
    * @vivantel/rag-core bumped from ^2.0.0 to ^3.3.0

## [2.1.1](https://github.com/vivantel/virage/compare/rag-store-qdrant@v2.1.0...rag-store-qdrant@v2.1.1) (2026-06-02)


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @vivantel/rag-core bumped from file:../rag-core to 3.2.0
  * peerDependencies
    * @vivantel/rag-core bumped from ^2.0.0 to ^3.2.0

## [2.1.0](https://github.com/vivantel/virage/compare/rag-store-qdrant@v2.0.1...rag-store-qdrant@v2.1.0) (2026-06-02)


### Features

* **rag-store-qdrant:** Add local file mode via path option ([50f0fe9](https://github.com/vivantel/virage/commit/50f0fe92e510ce4a3e649370910583e73e6536eb))


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @vivantel/rag-core bumped from file:../rag-core to 3.1.0
  * peerDependencies
    * @vivantel/rag-core bumped from ^2.0.0 to ^3.1.0

## [2.0.1](https://github.com/vivantel/virage/compare/rag-store-qdrant@v2.0.0...rag-store-qdrant@v2.0.1) (2026-06-02)


### Bug Fixes

* **rag-store-qdrant:** Format source files ([3aa48e6](https://github.com/vivantel/virage/commit/3aa48e677d368def9abe0d9f5a50333155ac829a))

## [2.0.0](https://github.com/vivantel/virage/compare/rag-store-qdrant@v1.0.0...rag-store-qdrant@v2.0.0) (2026-06-02)


### ⚠ BREAKING CHANGES

* TypeScript config files (rag.config.ts) are no longer supported. loadConfig() throws a ConfigError with a migration hint when given a .ts path. tsx removed from runtime dependencies. Default CLI config path changed from rag.config.ts to rag.config.json. gitignore updated accordingly.

### Features

* Add rag-store-qdrant, overhaul init wizard, drop rag.config.ts support ([cf32f27](https://github.com/vivantel/virage/commit/cf32f27aabd43d92c05e344cf73fc4ad8a1cbd97))
* Test trusted publisher automation ([7fd08b9](https://github.com/vivantel/virage/commit/7fd08b96f32e7f7c2c2c02ec7e2eebb761d5fa7f))
* Test trusted publisher automation ([c524461](https://github.com/vivantel/virage/commit/c5244615cf7e5e91457446b43d62efdd7928273c))
