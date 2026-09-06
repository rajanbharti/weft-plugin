import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repoHash } from "../../src/lib/repo-hash.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "repo-hash-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("repoHash", () => {
  it("is deterministic for the same path", () => {
    expect(repoHash(dir)).toBe(repoHash(dir));
  });

  it("differs across different paths", () => {
    const other = mkdtempSync(join(tmpdir(), "repo-hash-other-"));
    try {
      expect(repoHash(dir)).not.toBe(repoHash(other));
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it("returns a 16-char hex string", () => {
    const h = repoHash(dir);
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });

  it("resolves symlinks via realpath", () => {
    const target = join(dir, "real");
    mkdirSync(target);
    const link = join(dir, "link");
    symlinkSync(target, link);
    expect(repoHash(link)).toBe(repoHash(target));
  });
});
