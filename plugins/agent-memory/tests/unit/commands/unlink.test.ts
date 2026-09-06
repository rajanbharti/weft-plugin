import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runUnlink } from "../../../src/commands/unlink.js";
import { saveRepoConfig, saveToken } from "../../../src/lib/config.js";

let projectDir: string;
let pluginDataDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "plugin-unlink-repo-"));
  pluginDataDir = mkdtempSync(join(tmpdir(), "plugin-unlink-data-"));
  process.env.CLAUDE_PLUGIN_DATA = pluginDataDir;
});

afterEach(() => {
  delete process.env.CLAUDE_PLUGIN_DATA;
  rmSync(projectDir, { recursive: true, force: true });
  rmSync(pluginDataDir, { recursive: true, force: true });
});

describe("runUnlink", () => {
  it("removes config and token when linked", async () => {
    await saveRepoConfig(projectDir, { project_id: "proj_u", server: "http://x" });
    await saveToken("proj_u", "pmt_u");

    const res = await runUnlink({ projectDir });
    expect(res.ok).toBe(true);
    expect(res.removedProjectId).toBe("proj_u");
    expect(existsSync(join(projectDir, ".claude", "memory-config.json"))).toBe(false);
  });

  it("returns ok=false when nothing was linked", async () => {
    const res = await runUnlink({ projectDir });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("not linked");
  });
});
