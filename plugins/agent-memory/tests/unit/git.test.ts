import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readGitIdentity } from "../../src/git.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "plugin-git-"));
  execSync("git init -q", { cwd: dir });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("readGitIdentity", () => {
  it("returns email and name when both are configured", () => {
    execSync(`git config user.email alice@example.com`, { cwd: dir });
    execSync(`git config user.name "Alice Example"`, { cwd: dir });
    const id = readGitIdentity(dir);
    expect(id).toEqual({ email: "alice@example.com", name: "Alice Example" });
  });

  it("returns null when email is missing", () => {
    execSync(`git config --unset-all user.email || true`, { cwd: dir });
    const id = readGitIdentity(dir);
    expect(id).toBeNull();
  });

  it("returns email with null name when only email is set", () => {
    execSync(`git config user.email bob@e.com`, { cwd: dir });
    execSync(`git config --unset-all user.name || true`, { cwd: dir });
    const id = readGitIdentity(dir);
    expect(id).toEqual({ email: "bob@e.com", name: null });
  });
});
