import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadIgnoreMatcher } from "../../src/lib/ignore.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "ig-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function writeProjectIgnore(content: string) {
  writeFileSync(join(dir, ".projectmemoryignore"), content);
}
function writeDevIgnore(content: string) {
  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(join(dir, ".claude", "memoryignore"), content);
}

describe("loadIgnoreMatcher", () => {
  it("matches glob patterns from .projectmemoryignore", () => {
    writeProjectIgnore("secrets/**\n*.env\n");
    const m = loadIgnoreMatcher(dir);
    expect(m.isIgnored("secrets/key.txt")).toBe(true);
    expect(m.isIgnored(".env")).toBe(true);
    expect(m.isIgnored("src/app.ts")).toBe(false);
  });

  it("merges per-dev .claude/memoryignore patterns", () => {
    writeProjectIgnore("secrets/**\n");
    writeDevIgnore("scratch/**\n");
    const m = loadIgnoreMatcher(dir);
    expect(m.isIgnored("scratch/notes.md")).toBe(true);
    expect(m.isIgnored("secrets/k")).toBe(true);
    expect(m.isIgnored("src/app.ts")).toBe(false);
  });

  it("supports negation (!)", () => {
    writeProjectIgnore("docs/**\n!docs/public/**\n");
    const m = loadIgnoreMatcher(dir);
    expect(m.isIgnored("docs/private.md")).toBe(true);
    expect(m.isIgnored("docs/public/index.md")).toBe(false);
  });

  it("returns an empty matcher when both files are absent", () => {
    const m = loadIgnoreMatcher(dir);
    expect(m.isIgnored("anything")).toBe(false);
    expect(m.patterns).toEqual([]);
  });

  it("exposes the merged pattern list (project rules first)", () => {
    writeProjectIgnore("a\nb\n");
    writeDevIgnore("c\nd\n");
    const m = loadIgnoreMatcher(dir);
    expect(m.patterns).toEqual(["a", "b", "c", "d"]);
  });

  it("ignores blank lines and comments", () => {
    writeProjectIgnore("# comment\n\nfoo\n");
    const m = loadIgnoreMatcher(dir);
    expect(m.patterns).toEqual(["foo"]);
  });
});
