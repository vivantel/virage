# Changelog

## [0.2.27](https://github.com/vivantel/virage/compare/virage-agent-claude@v0.2.26...virage-agent-claude@v0.2.27) (2026-06-30)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-agent-core bumped from 0.1.7 to 0.1.8

## [0.2.26](https://github.com/vivantel/virage/compare/virage-agent-claude@v0.2.25...virage-agent-claude@v0.2.26) (2026-06-20)


### Bug Fixes

* **mcp:** Apply prettier formatting to searchConfig type ([939f477](https://github.com/vivantel/virage/commit/939f4776813e4daba1a4d65427d20da51ee311b7))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-agent-core bumped from 0.1.6 to 0.1.7
    * @vivantel/virage-skills bumped from 0.1.8 to 0.1.9

## [0.2.25](https://github.com/vivantel/virage/compare/virage-agent-claude@v0.2.24...virage-agent-claude@v0.2.25) (2026-06-20)


### Bug Fixes

* **agent-claude:** Pre-check .mcp.json before calling claude mcp add ([b514cc0](https://github.com/vivantel/virage/commit/b514cc049d4173a720d3a075fe451fe7f0497cad))

## [0.2.24](https://github.com/vivantel/virage/compare/virage-agent-claude@v0.2.23...virage-agent-claude@v0.2.24) (2026-06-18)


### Bug Fixes

* **virage-reranker-cross-encoder:** Wire up vitest and add unit tests ([90bb477](https://github.com/vivantel/virage/commit/90bb477a5059f2cce28e5f37c8dd8beef256218f))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-agent-core bumped from 0.1.5 to 0.1.6
    * @vivantel/virage-skills bumped from 0.1.7 to 0.1.8

## [0.2.23](https://github.com/vivantel/virage/compare/virage-agent-claude@v0.2.22...virage-agent-claude@v0.2.23) (2026-06-18)


### Bug Fixes

* **chore:** Correct PreToolUse hook syntax and apply Prettier formatting ([357c1c6](https://github.com/vivantel/virage/commit/357c1c6abf60e6eb979b91eb7db6637881a5632a))

## [0.2.22](https://github.com/vivantel/virage/compare/virage-agent-claude@v0.2.21...virage-agent-claude@v0.2.22) (2026-06-18)


### Features

* **cli,dashboard,agent-claude:** Chunker discovery, claude mcp add, dashboard fixes ([00f6287](https://github.com/vivantel/virage/commit/00f6287857af85828421044b2b0b4c502f577cb3))

## [0.2.21](https://github.com/vivantel/virage/compare/virage-agent-claude@v0.2.20...virage-agent-claude@v0.2.21) (2026-06-18)


### Bug Fixes

* **agent:** Decouple commands from installed skill paths, untrack generated dirs ([6ba865d](https://github.com/vivantel/virage/commit/6ba865df0a054415a1810ecc366c5a0510b42b50))

## [0.2.20](https://github.com/vivantel/virage/compare/virage-agent-claude@v0.2.19...virage-agent-claude@v0.2.20) (2026-06-17)


### Bug Fixes

* Retrigger release pipeline ([bd6b99c](https://github.com/vivantel/virage/commit/bd6b99c1332397e92259a37097f44a556cdc1b7e))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-agent-core bumped from 0.1.4 to 0.1.5
    * @vivantel/virage-skills bumped from 0.1.6 to 0.1.7

## [0.2.19](https://github.com/vivantel/virage/compare/virage-agent-claude@v0.2.18...virage-agent-claude@v0.2.19) (2026-06-16)


### Bug Fixes

* **virage-agent-claude:** Add [Virage] marker to statusMessage for idempotent hook management ([457c7a8](https://github.com/vivantel/virage/commit/457c7a85a238932890147c5519af0fa6bfa90333))

## [0.2.18](https://github.com/vivantel/virage/compare/virage-agent-claude@v0.2.17...virage-agent-claude@v0.2.18) (2026-06-16)


### Features

* **virage-agent-claude,virage-cli:** Proactive skill hooks, remove advice-giving ([19ad02d](https://github.com/vivantel/virage/commit/19ad02d3e076d48e17228865cbe5ad8269ce20ff))
* **virage-agent-claude,virage-skills:** RAG-first skills, expanded hooks, session_usage fix, eval suite ([5a1e844](https://github.com/vivantel/virage/commit/5a1e84469db15cdbd1dc871f5d5714129b2faa28))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-skills bumped from 0.1.5 to 0.1.6

## [0.2.17](https://github.com/vivantel/virage/compare/virage-agent-claude@v0.2.16...virage-agent-claude@v0.2.17) (2026-06-15)


### Features

* **virage-core,virage-cli,virage-agent-claude:** Branch-aware RAG, search command & index slash command ([6888bef](https://github.com/vivantel/virage/commit/6888befb52373500627437a9fcc636048c0b5719))

## [0.2.16](https://github.com/vivantel/virage/compare/virage-agent-claude@v0.2.15...virage-agent-claude@v0.2.16) (2026-06-15)


### Bug Fixes

* **virage-agent-claude:** Make mergeHooks() idempotent — strip-then-inject on every configure() ([3eebbf9](https://github.com/vivantel/virage/commit/3eebbf9d157e0454f8fcc756c1da4f777525ca82))

## [0.2.15](https://github.com/vivantel/virage/compare/virage-agent-claude@v0.2.14...virage-agent-claude@v0.2.15) (2026-06-15)


### Features

* **virage-agent-claude:** Token efficiency, skill routing & recency search (v1.2.1) ([b91395b](https://github.com/vivantel/virage/commit/b91395bc51e8777151c37a5694d0f53c76cbcc44))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-skills bumped from 0.1.4 to 0.1.5

## [0.2.14](https://github.com/vivantel/virage/compare/virage-agent-claude@v0.2.13...virage-agent-claude@v0.2.14) (2026-06-14)


### Bug Fixes

* **virage-agent-claude:** Upsert MCP server config on update; strip newlines from table prompt ([a89b208](https://github.com/vivantel/virage/commit/a89b20898b1b713b031629b71b298918f7e33c0a))

## [0.2.13](https://github.com/vivantel/virage/compare/virage-agent-claude@v0.2.12...virage-agent-claude@v0.2.13) (2026-06-14)


### Bug Fixes

* **virage-agent-claude:** Add session_usage to MCP tools table in README ([08cbc6d](https://github.com/vivantel/virage/commit/08cbc6d71e197ace7d397ee53a66b3d2fd2b7f7a))

## [0.2.12](https://github.com/vivantel/virage/compare/virage-agent-claude@v0.2.11...virage-agent-claude@v0.2.12) (2026-06-14)


### Bug Fixes

* **virage-agent-claude:** Fix session_usage table formatting; add virage usage CLI ([0a5419e](https://github.com/vivantel/virage/commit/0a5419e5afcad864c840985cc40c532eb26ee317))

## [0.2.11](https://github.com/vivantel/virage/compare/virage-agent-claude@v0.2.10...virage-agent-claude@v0.2.11) (2026-06-14)


### Bug Fixes

* **virage-agent-claude:** Fix /usage command — wrong MCP tool name and missing auto-configure ([c9eed9d](https://github.com/vivantel/virage/commit/c9eed9d8d8cfc5a0bbfc1dbabc6780b67125e680))

## [0.2.10](https://github.com/vivantel/virage/compare/virage-agent-claude@v0.2.9...virage-agent-claude@v0.2.10) (2026-06-14)


### Features

* **virage-agent-claude:** Add /usage command for session token usage breakdown ([49a95b6](https://github.com/vivantel/virage/commit/49a95b6cbd403c8f6e039586e739c4c839741c8a))

## [0.2.9](https://github.com/vivantel/virage/compare/virage-agent-claude@v0.2.8...virage-agent-claude@v0.2.9) (2026-06-14)


### Bug Fixes

* **virage-agent-claude:** Prettier format fix in plugin.test.ts ([91e6d28](https://github.com/vivantel/virage/commit/91e6d28811d2b012f7a75b091000903bfc935d5c))

## [0.2.8](https://github.com/vivantel/virage/compare/virage-agent-claude@v0.2.7...virage-agent-claude@v0.2.8) (2026-06-14)


### Features

* **virage-agent:** Rename plugin identifier virage-agent → virage, fix virage-cli chmod ([426e4b5](https://github.com/vivantel/virage/commit/426e4b5f41e50f6f41405265658d5ee2fce2b13a))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-agent-core bumped from 0.1.3 to 0.1.4

## [0.2.7](https://github.com/vivantel/virage/compare/virage-agent-claude@v0.2.6...virage-agent-claude@v0.2.7) (2026-06-13)


### Features

* **virage-agent-claude:** Rename /virage-plan to /plan, fix cli.js executable bit ([93f3b05](https://github.com/vivantel/virage/commit/93f3b05c0960e8b9a2cac2257a31c6ddca63d254))

## [0.2.6](https://github.com/vivantel/virage/compare/virage-agent-claude@v0.2.5...virage-agent-claude@v0.2.6) (2026-06-12)


### Bug Fixes

* **virage-agent:** Fix plugin validation warnings — version, author, frontmatter ([cda9592](https://github.com/vivantel/virage/commit/cda95921ba1b494c56a684f2d4f5b84f6cecc43b))

## [0.2.5](https://github.com/vivantel/virage/compare/virage-agent-claude@v0.2.4...virage-agent-claude@v0.2.5) (2026-06-12)


### Features

* **virage-agent:** Add vivantel marketplace and self-contained plugin MCP ([0e476e7](https://github.com/vivantel/virage/commit/0e476e75ace0cff1b03de89bc1c55f9079d3cb56))

## [0.2.4](https://github.com/vivantel/virage/compare/virage-agent-claude@v0.2.3...virage-agent-claude@v0.2.4) (2026-06-12)


### Bug Fixes

* **virage-agent:** Install claude plugin as skills-dir plugin; fix init UX ([70f368c](https://github.com/vivantel/virage/commit/70f368c889ce15ebd4a26c81cf4fd67a22db094f))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-agent-core bumped from 0.1.2 to 0.1.3

## [0.2.3](https://github.com/vivantel/virage/compare/virage-agent-claude@v0.2.2...virage-agent-claude@v0.2.3) (2026-06-12)


### Features

* **virage-agent:** Static file copier model for agent plugins (ADR-026) ([52dbd26](https://github.com/vivantel/virage/commit/52dbd26bda5b450011b0a82095f43f2c87e849a2))
* **virage-cli:** Add virage update command and confirmation step to init ([52dbd26](https://github.com/vivantel/virage/commit/52dbd26bda5b450011b0a82095f43f2c87e849a2))
* **virage-core:** Add agents field to config schema ([52dbd26](https://github.com/vivantel/virage/commit/52dbd26bda5b450011b0a82095f43f2c87e849a2))


### Documentation

* Update skill files, READMEs, INDEX.md, ROADMAP.md for ADR-026 batch ([52dbd26](https://github.com/vivantel/virage/commit/52dbd26bda5b450011b0a82095f43f2c87e849a2))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-agent-core bumped from 0.1.1 to 0.1.2
    * @vivantel/virage-skills bumped from 0.1.3 to 0.1.4

## [0.2.2](https://github.com/vivantel/virage/compare/virage-agent-claude@v0.2.1...virage-agent-claude@v0.2.2) (2026-06-12)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-skills bumped from 0.1.2 to 0.1.3

## [0.2.1](https://github.com/vivantel/virage/compare/virage-agent-claude@v0.2.0...virage-agent-claude@v0.2.1) (2026-06-11)


### Features

* Add redistributable agent skills with Claude Code plugin ([70b5323](https://github.com/vivantel/virage/commit/70b5323b0f3de4476fc5218d61fd8b6054b06f01))
* **agents:** Add multi-agent hook plugin architecture with 4 vendor integrations ([f739031](https://github.com/vivantel/virage/commit/f7390319b8e5ad54cd1cb669ccd743c48c485725))
* Test trusted publisher automation ([7fd08b9](https://github.com/vivantel/virage/commit/7fd08b96f32e7f7c2c2c02ec7e2eebb761d5fa7f))
* Test trusted publisher automation ([c524461](https://github.com/vivantel/virage/commit/c5244615cf7e5e91457446b43d62efdd7928273c))


### Code Refactoring

* **virage-cli:** Apply prettier formatting ([a74ffb2](https://github.com/vivantel/virage/commit/a74ffb26cebc0a6979dc1a0e0243381b741347fe))
* **virage-core:** Apply prettier formatting ([97c697a](https://github.com/vivantel/virage/commit/97c697a9a46697e6bb6c94977f74b6b56de1ab28))
* **virage-mcp:** Apply prettier formatting ([05428d5](https://github.com/vivantel/virage/commit/05428d56514a74e176e0d223aecdb459e60064ac))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-agent-core bumped from * to 0.1.1

## [0.1.2](https://github.com/vivantel/virage/compare/virage-agent-claude@v0.1.1...virage-agent-claude@v0.1.2) (2026-06-10)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-skills bumped from 0.1.1 to 0.1.2

## [0.1.1](https://github.com/vivantel/virage/compare/virage-agent-claude@v0.1.0...virage-agent-claude@v0.1.1) (2026-06-10)


### Features

* Add redistributable agent skills with Claude Code plugin ([70b5323](https://github.com/vivantel/virage/commit/70b5323b0f3de4476fc5218d61fd8b6054b06f01))
* Test trusted publisher automation ([7fd08b9](https://github.com/vivantel/virage/commit/7fd08b96f32e7f7c2c2c02ec7e2eebb761d5fa7f))
* Test trusted publisher automation ([c524461](https://github.com/vivantel/virage/commit/c5244615cf7e5e91457446b43d62efdd7928273c))


### Code Refactoring

* **virage-cli:** Apply prettier formatting ([a74ffb2](https://github.com/vivantel/virage/commit/a74ffb26cebc0a6979dc1a0e0243381b741347fe))
* **virage-core:** Apply prettier formatting ([97c697a](https://github.com/vivantel/virage/commit/97c697a9a46697e6bb6c94977f74b6b56de1ab28))
* **virage-mcp:** Apply prettier formatting ([05428d5](https://github.com/vivantel/virage/commit/05428d56514a74e176e0d223aecdb459e60064ac))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vivantel/virage-skills bumped from 0.1.0 to 0.1.1
