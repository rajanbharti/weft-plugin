import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync, execSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { saveRepoConfig, saveToken } from "../../../src/lib/config.js";
import { repoHash } from "../../../src/lib/repo-hash.js";
import { bufferPathFor } from "../../../src/lib/buffer.js";
import { startMockService } from "../helpers/mock-service.js";

const hookScript = fileURLToPath(new URL("../../../hooks/post-tool-bash.mjs", import.meta.url));

let projectDir: string;
let pluginDataDir: string;
let mock: Awaited<ReturnType<typeof startMockService>>;

beforeEach(async () => {
  projectDir = mkdtempSync(join(tmpdir(), "ptb-repo-"));
  pluginDataDir = mkdtempSync(join(tmpdir(), "ptb-data-"));
  process.env.CLAUDE_PLUGIN_DATA = pluginDataDir;

  // make a real git repo with a commit
  execSync("git init -q", { cwd: projectDir });
  execSync("git config user.email a@e.com", { cwd: projectDir });
  execSync("git config user.name A", { cwd: projectDir });
  execSync("printf 'hi\\n' > a.txt", { cwd: projectDir, shell: "/bin/bash" });
  execSync("git add . && git commit -q -m 'refactor: switch to fastify'", { cwd: projectDir, shell: "/bin/bash" });

  mock = await startMockService({ validToken: "pmt_t" });
  await saveRepoConfig(projectDir, { project_id: "proj_x", server: mock.url });
  await saveToken("proj_x", "pmt_t");
});

afterEach(async () => {
  await mock.stop();
  delete process.env.CLAUDE_PLUGIN_DATA;
  rmSync(projectDir, { recursive: true, force: true });
  rmSync(pluginDataDir, { recursive: true, force: true });
});

function invoke(input: object) {
  return spawnSync("node", [hookScript], {
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir, CLAUDE_PLUGIN_DATA: pluginDataDir },
    input: JSON.stringify(input),
    encoding: "utf8",
  });
}

describe("post-tool-bash hook", () => {
  it("captures a candidate from a non-trivial git commit", () => {
    const r = invoke({
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: 'git commit -m "refactor: switch to fastify"' },
      tool_response: { stdout: "[main abc1234] refactor: switch to fastify\n 1 file changed" },
    });
    expect(r.status).toBe(0);
    const buf = readFileSync(bufferPathFor(repoHash(projectDir)), "utf8").trim().split("\n");
    const cand = buf.map((l) => JSON.parse(l)).find((r) => r.kind === "candidate");
    expect(cand).toBeTruthy();
    expect(cand.category).toBe("decision");
    expect(cand.source).toBe("git-commit");
    expect(cand.content).toContain("refactor: switch to fastify");
  });

  it("ignores trivial messages (wip, fix typo, short)", () => {
    const r = invoke({
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: 'git commit -m "wip"' },
      tool_response: { stdout: "[main 0000000] wip" },
    });
    expect(r.status).toBe(0);
    const path = bufferPathFor(repoHash(projectDir));
    expect(existsSync(path)).toBe(false);
  });

  it("ignores non-commit Bash commands", () => {
    const r = invoke({
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: "ls -la" },
      tool_response: { stdout: "..." },
    });
    expect(r.status).toBe(0);
    expect(existsSync(bufferPathFor(repoHash(projectDir)))).toBe(false);
  });

  it("redacts secrets in commit messages", () => {
    execSync('git commit -q --allow-empty -m "leak AKIAABCDEFGHIJKLMNOP into main"', { cwd: projectDir });
    const r = invoke({
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: 'git commit -m "leak AKIAABCDEFGHIJKLMNOP into main"' },
      tool_response: { stdout: "[main 0000000] leak AKIAABCDEFGHIJKLMNOP into main" },
    });
    expect(r.status).toBe(0);
    const buf = readFileSync(bufferPathFor(repoHash(projectDir)), "utf8");
    expect(buf).not.toContain("AKIAABCDEFGHIJKLMNOP");
    expect(buf).toContain("[REDACTED:");
  });

  it("captures commits with no space after -m", () => {
    const r = invoke({
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: 'git commit -m"refactor: switch to fastify"' },
      tool_response: { stdout: "[main abc1234] refactor: switch to fastify\n 1 file changed" },
    });
    expect(r.status).toBe(0);
    const buf = readFileSync(bufferPathFor(repoHash(projectDir)), "utf8").trim().split("\n");
    const cand = buf.map((l) => JSON.parse(l)).find((r) => r.kind === "candidate");
    expect(cand).toBeTruthy();
    expect(cand.content).toContain("refactor: switch to fastify");
  });

  it("exits 0 silently when repo is not linked", () => {
    const blank = mkdtempSync(join(tmpdir(), "ptb-blank-"));
    try {
      execSync("git init -q && git config user.email a@e.com && git commit --allow-empty -q -m 'x'", { cwd: blank, shell: "/bin/bash" });
      const r = spawnSync("node", [hookScript], {
        env: { ...process.env, CLAUDE_PROJECT_DIR: blank, CLAUDE_PLUGIN_DATA: pluginDataDir },
        input: JSON.stringify({
          hook_event_name: "PostToolUse",
          tool_name: "Bash",
          tool_input: { command: 'git commit -m "real commit message here"' },
          tool_response: { stdout: "[main 0] real commit message here" },
        }),
        encoding: "utf8",
      });
      expect(r.status).toBe(0);
      expect(existsSync(bufferPathFor(repoHash(blank)))).toBe(false);
    } finally {
      rmSync(blank, { recursive: true, force: true });
    }
  });
});
