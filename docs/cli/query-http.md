# virage query-http

Start the warm local query endpoint: loopback HTTP with a bearer token, for hooks and tools that cannot keep a process open.

## Synopsis

```
virage query-http [options]
```

## Description

Binds `127.0.0.1` on a random port, resolves the embedder, vector store and re-ranker once (the same engine resolution `virage query` uses, so the embedder stays warm), and serves a small read-only JSON API. When the engine is ready it writes `.go-getter/state/retrieval/virage.endpoint.json` (mode `0600`) and removes it when the endpoint ends. It ends after an idle timeout, or on `SIGTERM` / `SIGINT` (Ctrl+C).

The endpoint is not owned by another process: start it when you need it. If a live endpoint for the project already exists, `virage query-http` prints its address and exits. The stdio `query-serve` used by MCP servers is unchanged.

The [index policy](config.md#index-policy) is read before the endpoint starts and again for every query, and applies to results. It refuses to start (and answers `403`) when the policy refuses the configured embedder, and in conformance mode when the policy file is missing.

## Options

| Flag | Alias | Type | Default | Description |
|------|-------|------|---------|-------------|
| `--config <path>` | | string | discovered | Path to the config file |
| `--idle-timeout <secs>` | | number | `600` | End the endpoint after this many seconds without a request (minimum `60`) |

## Discovery file

`.go-getter/state/retrieval/virage.endpoint.json`:

```json
{
  "contractVersion": 0,
  "tool": "virage",
  "toolVersion": "2.1.0",
  "address": "127.0.0.1:49152",
  "token": "<256 random bits, hex, new for every start>",
  "pid": 4242,
  "startedAt": "2026-10-12T09:00:00Z"
}
```

The file is per user and per machine and must not be committed (`.go-getter/state/` is gitignored). Treat the token as a secret.

## API

Every request needs `Authorization: Bearer <token>`. HTTP/1.1, JSON bodies.

| Route | Result |
|-------|--------|
| `POST /v0/query` | `{ "query": "text", "maxChunks": 5, "maxChars": 800, "minSimilarity": 0.65 }` → `200 { "contractVersion": 0, "chunks": [{ "text", "source", "similarity" }] }` |
| `GET /v0/health` | `200 {"ok":true}` |
| anything else | `404` |

- `query` is required and at most 2000 characters. `maxChunks` (default 5, at most 20), `maxChars` (default 800, at most 4000) and `minSimilarity` are requests; the tool caps them at its own limits. Unknown fields are ignored.
- `chunks` are ordered by similarity. `source` is a project-relative path using `/`, optionally followed by `#L<start>` or `#L<start>-L<end>`. A hit without a usable source (missing, absolute outside the project, or containing `..`) is dropped.
- The whole body is at most 64 KiB: the lowest-ranked chunks are dropped until it fits.
- Errors are `{"error": "short message"}`: `400` bad request, `401` bad or missing token, `403` refused by the index policy, `404` unknown route, `413` body over 16 KiB, `500` query failed, `503` not ready, `504` query timed out. Messages never include query or chunk text.
- Read-only: there is no write, index, delete or configuration route.

The server accepts loopback connections only, answers one request per connection, and refuses a `Host` header that is not `127.0.0.1`, `[::1]` or `localhost`. Anything else that runs as your user can read the discovery file, so the token and file mode are the only protection from other local users.

## Examples

```bash
virage query-http                      # foreground; Ctrl+C to stop
virage query-http --idle-timeout 1800 &

TOKEN=$(jq -r .token .go-getter/state/retrieval/virage.endpoint.json)
ADDR=$(jq -r .address .go-getter/state/retrieval/virage.endpoint.json)
curl -s -H "Authorization: Bearer $TOKEN" "http://$ADDR/v0/health"
curl -s -H "Authorization: Bearer $TOKEN" -d '{"query":"how does indexing work","maxChunks":3}' "http://$ADDR/v0/query"
```

## Related

- [`virage query`](query.md) — one-shot search from the command line
- [`config.md`](config.md#retrieval) — conformance mode, index policy and the declaration file
