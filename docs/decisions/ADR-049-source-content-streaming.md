---
id: ADR-049
title: Source content streaming via SourceProvider
status: Accepted
date: 2026-07-06
related: [ADR-004, ADR-013, ADR-038]
---

## Context

The `SourceRepository` and `SourceProvider` interfaces handle change detection and item
discovery respectively. Both were designed with non-git sources in mind — doc comments
explicitly mention S3 ETags and bucket prefixes — but neither interface exposes file
content. Content is currently accessed by chunkers reading directly from the local filesystem
via `fs.readFile`.

This assumption blocks two roadmap items:

1. **S3 / CDN providers** — an S3 `SourceProvider` can detect changes via ETags and list
   objects, but chunkers cannot read the file bytes without a local copy.
2. **Large-file chunking by offset** — chunkers must buffer the entire file today; streaming
   with byte-range semantics would allow overlapping read/chunk/embed pipelines and avoid
   out-of-memory failures on files >100 MB.

The current `SourceProvider` already exposes `listAll()` as an `AsyncIterable<SourceItem>`
so that large sources stream without buffering all items. Content access should follow the
same pattern.

## Decision

Add a `readContent` method to `SourceProvider`:

```typescript
/**
 * Read file content from the source.
 *
 * @param path  Relative POSIX path (as returned by listAll / getFileRevisions).
 * @param opts  Optional byte range [start, end] (inclusive, 0-indexed).
 *              Omit for the full file. Implementations that cannot honour a range
 *              MAY return the full content; callers must slice if needed.
 */
readContent(path: string, opts?: { start?: number; end?: number }): Promise<Uint8Array>;
```

`Uint8Array` is chosen over `Buffer` (Node-specific) or `ReadableStream` (complex to consume
in chunker plugins written by third parties) as the common denominator that works in both
Node and edge runtimes.

The method is **optional** on `SourceRepository` and **required** on `SourceProvider`:

```typescript
// source-repository.ts (no change to existing optional methods)
readContent?(path: string, opts?: { start?: number; end?: number }): Promise<Uint8Array>;

// source-provider.ts (required on SourceProvider)
readContent(path: string, opts?: { start?: number; end?: number }): Promise<Uint8Array>;
```

Making it optional on `SourceRepository` preserves backward compatibility for existing
implementations that only satisfy `SourceRepository` (not `SourceProvider`).

### Local git implementation

`CliGitSourceRepository.readContent` reads from the local filesystem:

```typescript
async readContent(path: string, opts?: { start?: number; end?: number }): Promise<Uint8Array> {
  const abs = join(this.root, path);
  if (opts?.start != null || opts?.end != null) {
    const fd = await open(abs);
    try {
      const length = (opts.end ?? Infinity) - (opts.start ?? 0) + 1;
      const buf = Buffer.allocUnsafe(Math.min(length, await fd.stat().then(s => s.size)));
      await fd.read(buf, 0, buf.length, opts.start ?? 0);
      return buf;
    } finally {
      await fd.close();
    }
  }
  return readFile(abs);
}
```

### Chunker interface evolution

`FileChunker.chunk()` currently receives a `path: string` and reads the file itself.
This will be evolved in a follow-up to accept a `readContent` callback instead, so
chunker plugins never need `fs` access. **That change is out of scope for this ADR** —
it requires updating every published chunker package and warrants its own ADR.

Until the chunker interface is updated, `CliGitSourceRepository.readContent` is wired
up for internal pipeline use (e.g. pre-reading large files for split-range chunking)
but chunkers continue to receive file paths.

### S3 implementation sketch

```typescript
class S3SourceProvider implements SourceProvider {
  async readContent(path: string, opts?: { start?: number; end?: number }): Promise<Uint8Array> {
    const range = opts ? `bytes=${opts.start ?? 0}-${opts.end ?? ""}` : undefined;
    const obj = await this.s3.getObject({ Bucket: this.bucket, Key: path, Range: range });
    return new Uint8Array(await obj.Body.transformToByteArray());
  }
}
```

S3's native byte-range `Range: bytes=start-end` maps directly to `opts`.

## Consequences

- **+** Enables non-local `SourceProvider` implementations (S3, CDN, JDBC) to serve
  content without requiring a local checkout.
- **+** Byte-range support allows overlapping read/chunk/embed pipelines for large files.
- **+** `CliGitSourceRepository` gains a testable content-reading contract instead of
  having `fs.readFile` scattered through chunker code.
- **−** Every `SourceProvider` implementor must add `readContent`; `SourceRepository`-only
  implementations are unaffected (method stays optional there).
- **−** Chunkers reading via path (current behaviour) are not immediately improved —
  the `FileChunker.chunk()` callback refactor must follow separately.
- **−** For very large files, buffering into `Uint8Array` before passing to a chunker
  may still be required until the `FileChunker` interface is updated.

## Guardrail

- `readContent` paths must be relative POSIX (matching `SourceItem.path`): no
  leading slash, forward slashes, no `..` traversal.
- Implementations that cannot honour `opts.start/end` (e.g. in-memory test stubs)
  may return the full content; callers that care about ranges must slice the result.
- Chunker packages must NOT import `fs` directly once the `FileChunker.chunk()`
  callback refactor (follow-up ADR) lands.

## References

- ADR-004 — git commit hash change detection (existing `SourceRepository` design)
- ADR-013 — plugin discovery via npm exports
- ADR-038 — package-based chunker configuration
- `packages/virage-core/src/interfaces/source-repository.ts`
- `packages/virage-core/src/interfaces/source-provider.ts`
