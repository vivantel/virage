import { createHash } from "crypto";
import { mkdir, mkdtemp, rename, rm, stat } from "fs/promises";
import { createWriteStream } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import https from "https";
import http from "http";

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

function downloadToFile(url: string, dest: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);
    const hash = createHash("sha256");

    function request(targetUrl: string): void {
      const u = new URL(targetUrl);
      const mod = u.protocol === "https:" ? https : http;
      mod
        .get(targetUrl, (res) => {
          if (
            res.statusCode &&
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            // follow redirect
            request(new URL(res.headers.location, targetUrl).toString());
            return;
          }
          if (
            !res.statusCode ||
            res.statusCode < 200 ||
            res.statusCode >= 300
          ) {
            file.destroy();
            reject(
              new Error(`HTTP ${res.statusCode ?? "?"} fetching ${targetUrl}`),
            );
            return;
          }
          res.on("data", (chunk: Buffer) => hash.update(chunk));
          res.pipe(file);
          file.on("finish", () => {
            file.close();
            resolve(hash.digest("hex"));
          });
          file.on("error", reject);
          res.on("error", reject);
        })
        .on("error", reject);
    }

    request(url);
  });
}

async function extractTarGz(
  archivePath: string,
  destDir: string,
): Promise<void> {
  const { extract } = await import("tar");
  await extract({ file: archivePath, cwd: destDir });
}

/**
 * Download a .tar.gz archive from `url`, extract it to a subdirectory of
 * `cacheDir`, and return the path to the extracted directory.
 *
 * Caching: if the directory already exists the download is skipped entirely.
 * Pass `noCache: true` to force re-download.
 *
 * @param url      HTTPS (or HTTP) URL to the archive
 * @param cacheDir Local directory where archives are cached
 * @param sha256   Optional expected SHA-256 hex digest for integrity check
 * @param noCache  When true, re-download even if the extracted dir exists
 */
export async function downloadAndExtract(
  url: string,
  cacheDir: string,
  sha256?: string,
  noCache = false,
): Promise<{ dir: string; cached: boolean }> {
  const cacheKey = createHash("sha256").update(url).digest("hex").slice(0, 16);
  const extractDir = join(cacheDir, cacheKey);

  if (!noCache && (await exists(extractDir))) {
    return { dir: extractDir, cached: true };
  }

  await mkdir(cacheDir, { recursive: true });

  // Download to a temp directory so partial archives are cleaned up on error
  const tmpDlDir = await mkdtemp(join(tmpdir(), "virage-dl-"));
  const tmpArchive = join(tmpDlDir, "archive.tar.gz");

  try {
    const actualSha256 = await downloadToFile(url, tmpArchive);

    if (sha256 && actualSha256 !== sha256.toLowerCase()) {
      throw new Error(
        `SHA-256 mismatch for ${url}\n  expected: ${sha256}\n  got:      ${actualSha256}`,
      );
    }

    // Extract to a staging dir first, then rename atomically into the cache
    const tmpExtract = join(cacheDir, `${cacheKey}.tmp`);
    await mkdir(tmpExtract, { recursive: true });
    try {
      await extractTarGz(tmpArchive, tmpExtract);
      if (noCache && (await exists(extractDir))) {
        await rm(extractDir, { recursive: true, force: true });
      }
      await rename(tmpExtract, extractDir);
    } catch (err) {
      await rm(tmpExtract, { recursive: true, force: true });
      throw err;
    }
  } finally {
    await rm(tmpDlDir, { recursive: true, force: true });
  }

  return { dir: extractDir, cached: false };
}
