import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { saveRepoConfig, saveToken } from "../../../src/lib/config.js";
import { repoHash } from "../../../src/lib/repo-hash.js";
import { bufferPathFor } from "../../../src/lib/buffer.js";
import { startMockService } from "../helpers/mock-service.js";

const hookScript = fileURLToPath(new URL("../../../hooks/post-tool-edit.mjs", import.meta.url));

let projectDir: string;
let pluginDataDir: string;
let mock: Awaited<ReturnType<typeof startMockService>>;

beforeEach(async () => {
  projectDir = mkdtempSync(join(tmpdir(), "pte-repo-"));
  pluginDataDir = mkdtempSync(join(tmpdir(), "pte-data-"));
  process.env.CLAUDE_PLUGIN_DATA = pluginDataDir;
  mock = await startMockService({ validToken: "pmt_t" });
});

afterEach(async () => {
  await mock.stop();
  delete process.env.CLAUDE_PLUGIN_DATA;
  rmSync(projectDir, { recursive: true, force: true });
  rmSync(pluginDataDir, { recursive: true, force: true });
});

function invoke(input: object) {
  return spawnSync("node", [hookScript], {
    cwd: projectDir,
    env: { ...process.env, CLAUDE_PROJECT_DIR: "/incorrect-env-directory", CLAUDE_PLUGIN_DATA: pluginDataDir },
    input: JSON.stringify(input),
    encoding: "utf8",
  });
}

describe("post-tool-edit hook", () => {
  it("does nothing when capture_file_edits is false (default)", async () => {
    await saveRepoConfig(projectDir, { project_id: "proj_x", server: mock.url });
    await saveToken("proj_x", "pmt_t");
    const r = invoke({
      session_id: "s1",
      hook_event_name: "PostToolUse",
      tool_name: "Edit",
      tool_input: { file_path: "src/a.ts" },
    });
    expect(r.status).toBe(0);
    expect(existsSync(bufferPathFor(repoHash(projectDir)))).toBe(false);
  });

  it("appends an edit row when capture_file_edits is true", async () => {
    await saveRepoConfig(projectDir, { project_id: "proj_x", server: mock.url, capture_file_edits: true } as any);
    await saveToken("proj_x", "pmt_t");
    const r = invoke({
      session_id: "s1",
      hook_event_name: "PostToolUse",
      tool_name: "Edit",
      tool_input: { file_path: "src/a.ts", new_string: "line1\nline2" },
    });
    expect(r.status).toBe(0);
    const buf = readFileSync(bufferPathFor(repoHash(projectDir)), "utf8").trim().split("\n");
    const edits = buf.map((l) => JSON.parse(l)).filter((r) => r.kind === "edit");
    expect(edits).toHaveLength(1);
    expect(edits[0].path).toBe("src/a.ts");
    expect(edits[0].session_id).toBe("s1");
  });

  it("supports MultiEdit with multiple paths", async () => {
    await saveRepoConfig(projectDir, { project_id: "proj_x", server: mock.url, capture_file_edits: true } as any);
    await saveToken("proj_x", "pmt_t");
    const r = invoke({
      session_id: "s1",
      hook_event_name: "PostToolUse",
      tool_name: "MultiEdit",
      tool_input: {
        edits: [
          { file_path: "src/a.ts", new_string: "x" },
          { file_path: "src/b.ts", new_string: "y\nz" },
        ],
      },
    });
    expect(r.status).toBe(0);
    const buf = readFileSync(bufferPathFor(repoHash(projectDir)), "utf8").trim().split("\n");
    const edits = buf.map((l) => JSON.parse(l)).filter((r) => r.kind === "edit");
    expect(edits.map((e) => e.path).sort()).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("stores repo-relative paths when Claude Code sends absolute ones", async () => {
    await saveRepoConfig(projectDir, { project_id: "proj_x", server: mock.url, capture_file_edits: true } as any);
    await saveToken("proj_x", "pmt_t");
    const r = invoke({
      session_id: "s1",
      hook_event_name: "PostToolUse",
      tool_name: "Edit",
      // Claude Code always passes an absolute file_path.
      tool_input: { file_path: join(projectDir, "src/a.ts"), new_string: "x" },
    });
    expect(r.status).toBe(0);
    const buf = readFileSync(bufferPathFor(repoHash(projectDir)), "utf8").trim().split("\n");
    const edits = buf.map((l) => JSON.parse(l)).filter((r) => r.kind === "edit");
    // The ignore matcher rejects absolute paths, so the buffer must hold relative ones.
    expect(edits[0].path).toBe("src/a.ts");
  });

  it("exits 0 silently when repo is not linked", () => {
    const r = invoke({
      session_id: "s1",
      hook_event_name: "PostToolUse",
      tool_name: "Edit",
      tool_input: { file_path: "src/a.ts" },
    });
    expect(r.status).toBe(0);
    expect(existsSync(bufferPathFor(repoHash(projectDir)))).toBe(false);
  });
});
