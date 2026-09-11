import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { saveRepoConfig, saveToken } from "../../../src/lib/config.js";
import { startMockService } from "../helpers/mock-service.js";

const hookScript = fileURLToPath(new URL("../../../hooks/session-start.mjs", import.meta.url));

function runHook(
  env: Record<string, string | undefined>,
  input: string,
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("node", [hookScript], {
      cwd: env.CLAUDE_PROJECT_DIR,
      env: { ...env, CLAUDE_PROJECT_DIR: "/incorrect-env-directory" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
    child.stdin.write(input);
    child.stdin.end();
  });
}

let projectDir: string;
let pluginDataDir: string;
let mock: Awaited<ReturnType<typeof startMockService>>;

beforeEach(async () => {
  projectDir = mkdtempSync(join(tmpdir(), "plugin-ss-repo-"));
  pluginDataDir = mkdtempSync(join(tmpdir(), "plugin-ss-data-"));
  process.env.CLAUDE_PLUGIN_DATA = pluginDataDir;
  mock = await startMockService({
    validToken: "pmt_ss",
    pinned: [{ id: "entry_pin1", content: "pinned a", category: "codebase", status: "approved", pinned: true, authorEmail: "a@e.com", createdAt: "2026-04-01T00:00:00Z" }],
    recent: [
      { id: "entry_r1", content: "recent a", category: "decision", status: "approved", pinned: false, authorEmail: "a@e.com", createdAt: "2026-04-10T00:00:00Z" },
      { id: "entry_r2", content: "recent b", category: "active-work", status: "approved", pinned: false, authorEmail: "b@e.com", createdAt: "2026-04-12T00:00:00Z" },
    ],
  });
  await saveRepoConfig(projectDir, { project_id: "proj_ss", server: mock.url });
  await saveToken("proj_ss", "pmt_ss");
});

afterEach(async () => {
  await mock.stop();
  delete process.env.CLAUDE_PLUGIN_DATA;
  rmSync(projectDir, { recursive: true, force: true });
  rmSync(pluginDataDir, { recursive: true, force: true });
});

describe("session-start hook", () => {
  it("injects priming context when linked", async () => {
    const r = await runHook(
      { ...process.env, CLAUDE_PROJECT_DIR: projectDir, CLAUDE_PLUGIN_DATA: pluginDataDir },
      JSON.stringify({ hook_event_name: "SessionStart", source: "startup" }),
    );
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.hookSpecificOutput.hookEventName).toBe("SessionStart");
    const ctx: string = out.hookSpecificOutput.additionalContext;
    expect(ctx).toContain("## Project memory (auto-primed)");
    expect(ctx).toContain("entry_pin1");
    expect(ctx).toContain("entry_r1");
    expect(ctx).toContain("entry_r2");
  });

  it("exits 0 silently when not linked", async () => {
    const blank = mkdtempSync(join(tmpdir(), "plugin-ss-blank-"));
    try {
      const r = await runHook(
        { ...process.env, CLAUDE_PROJECT_DIR: blank, CLAUDE_PLUGIN_DATA: pluginDataDir },
        JSON.stringify({ hook_event_name: "SessionStart", source: "startup" }),
      );
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe("");
    } finally {
      rmSync(blank, { recursive: true, force: true });
    }
  });

  it("exits 0 non-blocking on network errors", async () => {
    await mock.stop();
    const r = await runHook(
      { ...process.env, CLAUDE_PROJECT_DIR: projectDir, CLAUDE_PLUGIN_DATA: pluginDataDir },
      JSON.stringify({ hook_event_name: "SessionStart", source: "startup" }),
    );
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("priming skipped");
  });

  it("pushes .projectmemoryignore patterns when mtime changes", async () => {
    // Write the ignore file so SessionStart finds it.
    writeFileSync(join(projectDir, ".projectmemoryignore"), "secrets/**\n*.env\n");

    const r = await runHook(
      { ...process.env, CLAUDE_PROJECT_DIR: projectDir, CLAUDE_PLUGIN_DATA: pluginDataDir },
      JSON.stringify({ hook_event_name: "SessionStart", source: "startup" }),
    );
    expect(r.status).toBe(0);

    // The mock recorded the push.
    expect(mock.ignoreRulePushes.find((p) => p.projectId === "proj_ss")?.patterns).toEqual(["secrets/**", "*.env"]);

    // Second invocation with no mtime change → no new push.
    await runHook(
      { ...process.env, CLAUDE_PROJECT_DIR: projectDir, CLAUDE_PLUGIN_DATA: pluginDataDir },
      JSON.stringify({ hook_event_name: "SessionStart", source: "startup" }),
    );
    expect(mock.ignoreRulePushes.length).toBe(1);

    // Bump mtime → push happens again.
    const future = new Date(Date.now() + 60_000);
    utimesSync(join(projectDir, ".projectmemoryignore"), future, future);
    await runHook(
      { ...process.env, CLAUDE_PROJECT_DIR: projectDir, CLAUDE_PLUGIN_DATA: pluginDataDir },
      JSON.stringify({ hook_event_name: "SessionStart", source: "startup" }),
    );
    expect(mock.ignoreRulePushes.length).toBe(2);
  });
});
