import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pluginDataDir } from "../../src/lib/data-dir.js";
import {
  loadLinkedProject, saveRepoConfig, saveToken, clearToken,
} from "../../src/lib/config.js";

// Claude Code names a plugin's data dir `<plugin>-<marketplace>` and exports it to
// hooks and MCP servers, but not to skill shell commands such as `/memory-link`.
let configDir: string;
let projectDir: string;
const hookDataDir = () => join(configDir, "plugins", "data", "weft-plugin-weft");
const legacyDataDir = () => join(configDir, "plugins", "data", "weft-plugin");

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), "claude-config-"));
  projectDir = mkdtempSync(join(tmpdir(), "plugin-repo-"));
  process.env.CLAUDE_CONFIG_DIR = configDir;
  delete process.env.CLAUDE_PLUGIN_DATA;
});

afterEach(() => {
  delete process.env.CLAUDE_CONFIG_DIR;
  delete process.env.CLAUDE_PLUGIN_DATA;
  rmSync(configDir, { recursive: true, force: true });
  rmSync(projectDir, { recursive: true, force: true });
});

describe("pluginDataDir", () => {
  it("falls back to the directory Claude Code assigns to hooks", () => {
    expect(pluginDataDir()).toBe(hookDataDir());
  });

  it("prefers CLAUDE_PLUGIN_DATA when set", () => {
    process.env.CLAUDE_PLUGIN_DATA = "/tmp/elsewhere";
    expect(pluginDataDir()).toBe("/tmp/elsewhere");
  });
});

describe("token shared between link and hooks", () => {
  it("a token saved by a skill (no CLAUDE_PLUGIN_DATA) is visible to hooks", async () => {
    await saveRepoConfig(projectDir, { project_id: "proj_a", server: "http://x" });
    await saveToken("proj_a", "pmt_a");

    process.env.CLAUDE_PLUGIN_DATA = hookDataDir();
    expect((await loadLinkedProject(projectDir))?.token).toBe("pmt_a");
  });

  it("hooks still find tokens written to the legacy fallback directory", async () => {
    await saveRepoConfig(projectDir, { project_id: "proj_a", server: "http://x" });
    mkdirSync(legacyDataDir(), { recursive: true });
    writeFileSync(join(legacyDataDir(), "tokens.json"), JSON.stringify({ proj_a: "pmt_old" }));

    process.env.CLAUDE_PLUGIN_DATA = hookDataDir();
    expect((await loadLinkedProject(projectDir))?.token).toBe("pmt_old");
  });

  it("the current directory wins over the legacy directory", async () => {
    await saveRepoConfig(projectDir, { project_id: "proj_a", server: "http://x" });
    mkdirSync(legacyDataDir(), { recursive: true });
    writeFileSync(join(legacyDataDir(), "tokens.json"), JSON.stringify({ proj_a: "pmt_old" }));
    await saveToken("proj_a", "pmt_new");

    expect((await loadLinkedProject(projectDir))?.token).toBe("pmt_new");
  });

  it("clearToken removes the token from the legacy directory too", async () => {
    await saveRepoConfig(projectDir, { project_id: "proj_a", server: "http://x" });
    mkdirSync(legacyDataDir(), { recursive: true });
    writeFileSync(
      join(legacyDataDir(), "tokens.json"),
      JSON.stringify({ proj_a: "pmt_old", proj_b: "pmt_b" }),
    );

    process.env.CLAUDE_PLUGIN_DATA = hookDataDir();
    await clearToken("proj_a");
    expect(await loadLinkedProject(projectDir)).toBeNull();
    const legacy = JSON.parse(readFileSync(join(legacyDataDir(), "tokens.json"), "utf8"));
    expect(legacy).toEqual({ proj_b: "pmt_b" });
  });
});
