# virage init

Interactive wizard to configure a new virage project.

## Synopsis

```
virage init
```

## Description

Launches an interactive wizard that:
1. Selects embedder, vector store, re-ranker (optional), and chunker plugins
2. Configures hybrid search settings
3. Selects agent plugin(s) to install
4. Chooses install scope: local (`.virage/plugins/`) or global (`~/.virage/plugins/`)
5. Installs all selected plugins
6. Writes `virage.config.json`
7. Runs `configure()` on each agent plugin to copy config files (hooks, MCP registration, slash commands)

After `virage init`, run `virage index` to build the index.

## Options

None. `virage init` is always interactive.

## Examples

```bash
virage init
```

## Related

- [`virage index`](index.md) — build the index after init
- [`virage update`](update.md) — update plugins after init
- [`config.md`](config.md) — understand the generated config file
