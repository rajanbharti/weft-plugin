import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadLinkedProject, saveRepoConfig, saveToken, clearToken, clearRepoConfig,
} from "../../src/lib/config.js";

let projectDir: string;
let pluginDataDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "plugin-repo-"));
  pluginDataDir = mkdtempSync(join(tmpdir(), "plugin-data-"));
  process.env.CLAUDE_PLUGIN_DATA = pluginDataDir;
});

afterEach(() => {
  delete process.env.CLAUDE_PLUGIN_DATA;
  rmSync(projectDir, { recursive: true, force: true });
  rmSync(pluginDataDir, { recursive: true, force: true });
});

describe("loadLinkedProject", () => {
  it("returns null when no repo config exists", async () => {
    expect(await loadLinkedProject(projectDir)).toBeNull();
  });

  it("returns null when repo config exists but token is missing", async () => {
    mkdirSync(join(projectDir, ".claude"));
    writeFileSync(
      join(projectDir, ".claude", "memory-config.json"),
      JSON.stringify({ project_id: "proj_a", server: "http://x" }),
    );
    expect(await loadLinkedProject(projectDir)).toBeNull();
  });

  it("returns merged config when both sources exist", async () => {
    await saveRepoConfig(projectDir, { project_id: "proj_a", server: "http://x" });
    await saveToken("proj_a", "pmt_secret");
    const out = await loadLinkedProject(projectDir);
    expect(out).toEqual({
      projectId: "proj_a",
      token: "pmt_secret",
      server: "http://x",
      primingTokenBudget: 3000,
      captureFileEdits: false,
      gitCommitMinMessageChars: 12,
    });
  });

  it("respects priming_token_budget when set", async () => {
    await saveRepoConfig(projectDir, { project_id: "proj_a", server: "http://x", priming_token_budget: 1500 });
    await saveToken("proj_a", "pmt_s");
    const out = await loadLinkedProject(projectDir);
    expect(out?.primingTokenBudget).toBe(1500);
  });

  it("tolerates malformed JSON in repo config (returns null)", async () => {
    mkdirSync(join(projectDir, ".claude"));
    writeFileSync(join(projectDir, ".claude", "memory-config.json"), "{not json");
    expect(await loadLinkedProject(projectDir)).toBeNull();
  });
});

describe("loadLinkedProject capture config", () => {
  it("defaults capture_file_edits to false and git_commit_min_message_chars to 12", async () => {
    await saveRepoConfig(projectDir, { project_id: "proj_c", server: "http://localhost:3000" });
    await saveToken("proj_c", "pmt_t");
    const out = await loadLinkedProject(projectDir);
    expect(out?.captureFileEdits).toBe(false);
    expect(out?.gitCommitMinMessageChars).toBe(12);
  });

  it("respects capture_file_edits and git_commit_min_message_chars when set", async () => {
    await saveRepoConfig(projectDir, {
      project_id: "proj_c",
      server: "http://localhost:3000",
      capture_file_edits: true,
      git_commit_min_message_chars: 20,
    } as any);
    await saveToken("proj_c", "pmt_t");
    const out = await loadLinkedProject(projectDir);
    expect(out?.captureFileEdits).toBe(true);
    expect(out?.gitCommitMinMessageChars).toBe(20);
  });
});

describe("saveRepoConfig / saveToken", () => {
  it("creates both files and clears them", async () => {
    await saveRepoConfig(projectDir, { project_id: "proj_b", server: "http://y" });
    await saveToken("proj_b", "pmt_a");

    expect(existsSync(join(projectDir, ".claude", "memory-config.json"))).toBe(true);
    const tokens = JSON.parse(readFileSync(join(pluginDataDir, "tokens.json"), "utf8"));
    expect(tokens.proj_b).toBe("pmt_a");

    await clearToken("proj_b");
    const cleared = JSON.parse(readFileSync(join(pluginDataDir, "tokens.json"), "utf8"));
    expect(cleared.proj_b).toBeUndefined();

    await clearRepoConfig(projectDir);
    expect(existsSync(join(projectDir, ".claude", "memory-config.json"))).toBe(false);
  });
});
