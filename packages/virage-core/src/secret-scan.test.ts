import { describe, it, expect } from "vitest";
import { scanChunksForSecrets, scanForSecrets } from "./secret-scan.js";

// Every credential-shaped string below is assembled at runtime from fragments, so
// no source line contains a contiguous token that a repository secret scanner
// could flag.

function tail(alphabet: string, n: number): string {
  return Array.from(
    { length: n },
    (_, i) => alphabet[(i * 7 + 3) % alphabet.length],
  ).join("");
}

const ALNUM = "aB3dE5fG7hJ9kLmN2pQrS4tUvW6xYz01";
const UPPER_DIGIT = "Q7ZXN4HPW2KJM5T6RB3V";
const TOKEN = "aB3dE5fG7hJ9kLmN2pQrS4tUvW6x-_";

const kind = (text: string): string | undefined => scanForSecrets(text)?.kind;

describe("scanForSecrets", () => {
  it("finds a private key block but not a certificate", () => {
    expect(
      kind(["-----BEGIN ", "RSA PRIV", "ATE KEY-----\nabc"].join("")),
    ).toBe("private-key");
    expect(kind("-----BEGIN CERTIFICATE-----\nMIIB")).toBeUndefined();
  });

  it("finds an AWS access key id of the right length only", () => {
    const p = ["AK", "IA"].join("");
    expect(kind(`id = ${p}${tail(UPPER_DIGIT, 16)}`)).toBe("aws-access-key");
    expect(kind(`id = ${p}${tail(UPPER_DIGIT, 10)}`)).toBeUndefined();
    expect(kind(`id = ${p}${tail(UPPER_DIGIT, 30)}`)).toBeUndefined();
    expect(kind(`MY${p}${tail(UPPER_DIGIT, 16)}`)).toBeUndefined();
  });

  it("finds VCS, chat, payment and API-style tokens", () => {
    expect(kind(`${["gh", "p_"].join("")}${tail(ALNUM, 36)}`)).toBe(
      "github-token",
    );
    expect(kind(`${["github", "_pat_"].join("")}${tail(ALNUM, 40)}`)).toBe(
      "github-token",
    );
    expect(
      kind(`${["xo", "xb-"].join("")}${tail("0123456789abcdef-", 24)}`),
    ).toBe("slack-token");
    expect(kind(`${["AI", "za"].join("")}${tail(TOKEN, 35)}`)).toBe(
      "google-api-key",
    );
    expect(kind(`${["sk", "_live_"].join("")}${tail(ALNUM, 26)}`)).toBe(
      "stripe-key",
    );
    expect(kind(`key=${["s", "k-"].join("")}${tail(TOKEN, 40)}`)).toBe(
      "api-key",
    );
    expect(kind(`${["gh", "p_"].join("")}${tail(ALNUM, 8)}`)).toBeUndefined();
    expect(kind("a key that starts with sk- stays private")).toBeUndefined();
  });

  it("finds a JWT with three segments", () => {
    const seg = (n: number) => `${["ey", "J"].join("")}${tail(ALNUM, n)}`;
    expect(kind(`${seg(20)}.${seg(24)}.${tail(ALNUM, 20)}`)).toBe("jwt");
    expect(kind(`${seg(20)}.${seg(24)}`)).toBeUndefined();
  });

  it("flags a random-looking value assigned to a secret-looking name", () => {
    const value = tail("aB3dE5fG7hJ9kLmN2pQrS4tUvW6xYz01+/", 32);
    const pw = ["pass", "word"].join("");
    expect(kind(`${pw} = "${value}"`)).toBe("credential-assignment");
    expect(kind(`{"${["api_", "key"].join("")}": "${value}"}`)).toBe(
      "credential-assignment",
    );
    // Low entropy, placeholders, short values and env lookups are not secrets.
    expect(kind(`${pw} = "aaaaaaaaaaaaaaaaaaaaaaaa"`)).toBeUndefined();
    expect(kind(`${pw} = "your-password-here-please"`)).toBeUndefined();
    expect(kind(`${pw} = "short"`)).toBeUndefined();
    expect(kind(`${["tok", "en"].join("")} = process.env.X`)).toBeUndefined();
  });

  it("passes ordinary code and prose", () => {
    expect(
      kind("const tokenCount = 3;\nconsole.log(`n=${tokenCount}`);"),
    ).toBeUndefined();
    expect(
      kind("# Setup\n\nRun `npm install` then `npm test`."),
    ).toBeUndefined();
    expect(kind("")).toBeUndefined();
  });

  it("never returns the matched text", () => {
    const secret = `${["gh", "p_"].join("")}${tail(ALNUM, 36)}`;
    const finding = scanForSecrets(secret);
    expect(JSON.stringify(finding)).not.toContain(secret);
  });
});

describe("scanChunksForSecrets", () => {
  it("checks dense and sparse text of every chunk", () => {
    const secret = `${["gh", "p_"].join("")}${tail(ALNUM, 36)}`;
    expect(
      scanChunksForSecrets([{ denseText: "fine" }, { denseText: "ok" }]),
    ).toBeNull();
    expect(
      scanChunksForSecrets([
        { denseText: "fine" },
        { denseText: "ok", sparseText: secret },
      ])?.kind,
    ).toBe("github-token");
  });
});
