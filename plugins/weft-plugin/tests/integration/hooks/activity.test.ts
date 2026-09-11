import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { saveRepoConfig, saveToken, type LinkedProject } from "../../../src/lib/config.js";
import { activityQueueDir, enqueueActivity, flushActivity } from "../../../src/lib/activity.js";
import { startMockService } from "../helpers/mock-service.js";

let dir: string;
let data: string;
let mock: Awaited<ReturnType<typeof startMockService>>;
let linked: LinkedProject;
const script = fileURLToPath(new URL("../../../hooks/activity.mjs", import.meta.url));
function run(event: Record<string, unknown>, project = dir) {
  return new Promise<number | null>((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      env: { ...process.env, CLAUDE_PROJECT_DIR: "", CLAUDE_PLUGIN_DATA: data },
      stdio: ["pipe", "ignore", "ignore"],
    });
    child.on("error", reject);
    child.on("close", resolve);
    child.stdin.end(JSON.stringify({ cwd: project, session_id: "session-test", ...event }));
  });
}
function queued() {
  const queue = activityQueueDir(dir, linked);
  return existsSync(queue) ? readdirSync(queue).filter(f => f.endsWith(".json")) : [];
}
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "weft-activity-repo-"));
  data = mkdtempSync(join(tmpdir(), "weft-activity-data-"));
  process.env.CLAUDE_PLUGIN_DATA = data;
  mock = await startMockService();
  linked = { projectId: "proj_activity", server: mock.url, token: "pmt_test", primingTokenBudget: 3000, captureFileEdits: false, gitCommitMinMessageChars: 12 };
  await saveRepoConfig(dir, { project_id: linked.projectId, server: linked.server });
  await saveToken(linked.projectId, linked.token);
});
afterEach(async () => {
  await mock.stop();
  delete process.env.CLAUDE_PLUGIN_DATA;
  rmSync(dir, { recursive: true, force: true });
  rmSync(data, { recursive: true, force: true });
});
describe("automatic activity sync", () => {
  it.each([
    { hook_event_name: "UserPromptSubmit", prompt: "hello, try this" },
    { hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "pwd" }, tool_response: { stdout: "/repo" } },
    { hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: "src/a.ts", old_string: "a", new_string: "b" } },
    { hook_event_name: "PostToolUseFailure", tool_name: "Bash", error: "exit 1" },
    { hook_event_name: "Stop", last_assistant_message: "Implemented the change" },
    { hook_event_name: "SubagentStop", last_assistant_message: "Reviewed module" },
    { hook_event_name: "SessionEnd", reason: "exit" },
  ])("uploads $hook_event_name without local review", async event => {
    expect(await run(event)).toBe(0);
    expect(mock.createdEntries).toHaveLength(1);
    const entry = mock.createdEntries[0];
    expect(entry.status).toBe("pending");
    expect(entry.tags).toContain("auto-capture");
    expect(entry.tags).toContain("session:session-test");
    expect(entry.content).toContain(event.hook_event_name);
    expect(queued()).toHaveLength(0);
  });
  it("keeps failed uploads and retries at session start", async () => {
    mock.writeStatus.code = 503;
    expect(await run({ hook_event_name: "UserPromptSubmit", prompt: "retain me" })).toBe(0);
    expect(queued()).toHaveLength(1);
    const original = JSON.parse(readFileSync(join(activityQueueDir(dir, linked), queued()[0]), "utf8"));
    mock.writeStatus.code = 200;
    expect(await run({ hook_event_name: "SessionStart" })).toBe(0);
    expect(mock.createdEntries[0]).toEqual(original);
    expect(queued()).toHaveLength(0);
  });
  it("does not lose concurrent captures or upload the same queue concurrently", async () => {
    for (let i = 0; i < 8; i++) enqueueActivity(dir, linked, { hook_event_name: "PostToolUse", tool_name: "Read", tool_use_id: String(i) });
    await Promise.all([flushActivity(dir, linked), flushActivity(dir, linked)]);
    expect(mock.createdEntries).toHaveLength(8);
    expect(new Set(mock.createdEntries.map(e => e.tags.find((t: string) => t.startsWith("event-id:")))).size).toBe(8);
    expect(queued()).toHaveLength(0);
  });
  it("redacts credentials before writing to disk or uploading", async () => {
    enqueueActivity(dir, linked, { hook_event_name: "UserPromptSubmit", prompt: "link pmt_test and pmt_other-secret", tool_input: { password: "plaintext-password" } });
    const stored = readFileSync(join(activityQueueDir(dir, linked), queued()[0]), "utf8");
    expect(stored).not.toContain("pmt_test");
    expect(stored).not.toContain("pmt_other-secret");
    expect(stored).not.toContain("plaintext-password");
    await flushActivity(dir, linked);
    expect(mock.createdEntries[0].redactionApplied).toBe(true);
  });
  it("omits excluded file payloads even in mixed file operations", async () => {
    writeFileSync(join(dir, ".projectmemoryignore"), "private/**\n");
    await run({ hook_event_name: "PostToolUse", tool_name: "MultiEdit", tool_input: { edits: [
      { file_path: "src/a.ts", new_string: "public" },
      { file_path: "private/a.ts", new_string: "sensitive-value" },
    ] }, tool_response: "sensitive-value" });
    expect(mock.createdEntries[0].content).not.toContain("sensitive-value");
    expect(mock.createdEntries[0].content).toContain("excluded file payload");
  });
  it("never sends a previous project's outbox after relinking", async () => {
    enqueueActivity(dir, linked, { hook_event_name: "Stop", last_assistant_message: "project A" });
    await flushActivity(dir, { ...linked, projectId: "other-project" });
    expect(mock.createdEntries).toHaveLength(0);
    expect(queued()).toHaveLength(1);
  });
  it("ignores unlinked repositories", async () => {
    rmSync(join(dir, ".claude/memory-config.json"));
    expect(await run({ hook_event_name: "UserPromptSubmit", prompt: "do not send" })).toBe(0);
    expect(mock.createdEntries).toHaveLength(0);
  });
});
