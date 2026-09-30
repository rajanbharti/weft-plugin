import { afterEach, beforeEach, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { startMockService } from "../helpers/mock-service.js";

const plugin = fileURLToPath(new URL("../../../../weft-codex/", import.meta.url));
let repo: string;
let data: string;
let mock: Awaited<ReturnType<typeof startMockService>>;
let env: NodeJS.ProcessEnv;
function run(script: string, input = "", args: string[] = []) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [join(plugin, script), ...args], { cwd: repo, env, stdio: "pipe" });
    let stdout = "", stderr = "";
    child.stdout.on("data", b => stdout += b); child.stderr.on("data", b => stderr += b);
    child.on("error", reject); child.on("close", code => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}
const hook = (event: Record<string, unknown>) => run("hooks/activity.mjs", JSON.stringify({ session_id: "codex-test", turn_id: "turn-1", cwd: "/wrong-payload-path", ...event }));
const queued = () => readdirSync(data, { recursive: true }).filter(f => String(f).includes("outbox/") && String(f).endsWith(".json"));
beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "weft-codex-repo-")); data = mkdtempSync(join(tmpdir(), "weft-codex-data-"));
  env = { ...process.env, WEFT_CODEX_DATA_DIR: data, PLUGIN_DATA: "/wrong-plugin-data", CLAUDE_PLUGIN_DATA: "/wrong-claude-data" };
  mock = await startMockService({ rawActivity: true, supportedProviders: ["claude", "codex"] });
  mkdirSync(join(repo, ".codex"));
  writeFileSync(join(repo, ".codex/memory-config.json"), JSON.stringify({ project_id: "proj_codex", server: mock.url }));
  writeFileSync(join(data, "tokens.json"), JSON.stringify({ proj_codex: "pmt_test" }), { mode: 0o600 });
});
afterEach(async () => { await mock?.stop(); rmSync(repo, { recursive: true, force: true }); rmSync(data, { recursive: true, force: true }); });

it.each([
  ["UserPromptSubmit", "prompt.submitted"], ["PostToolUse", "tool.completed"],
  ["Stop", "turn.completed"], ["SubagentStop", "subagent.completed"], ["SessionEnd", "session.ended"],
])("delivers %s as Codex evidence", async (hook_event_name, eventType) => {
  const result = await hook({ hook_event_name, prompt: "synthetic task", last_assistant_message: "synthetic response", tool_name: "Bash", tool_input: { command: "pwd" } });
  expect(result.code).toBe(0); expect(result.stderr).toBe("");
  expect(mock.rawEvents).toHaveLength(1);
  expect(mock.rawEvents[0]).toMatchObject({ provider: "codex", eventType, sessionId: "codex-test" });
  expect(mock.rawEvents[0].payload.content).toContain("turn-1");
  expect(queued()).toHaveLength(0);
  if (["Stop", "SubagentStop"].includes(hook_event_name)) expect(JSON.parse(result.stdout)).toEqual({});
});
it("retains 401 failures, reports safe diagnostics, and retries the same event on session start", async () => {
  mock.rawControl.capabilityCode = 401;
  const result = await hook({ hook_event_name: "UserPromptSubmit", prompt: "sensitive pmt_test" });
  expect(result.stderr).toContain("HTTP 401"); expect(result.stderr).not.toContain("pmt_test");
  expect(queued()).toHaveLength(1);
  const stored = readFileSync(join(data, String(queued()[0])), "utf8");
  expect(stored).not.toContain("pmt_test");
  const id = JSON.parse(stored).event.clientEventId;
  mock.rawControl.capabilityCode = 200;
  const start = await hook({ hook_event_name: "SessionStart" });
  expect(JSON.parse(start.stdout).hookSpecificOutput.additionalContext).toContain("memory_search");
  expect(mock.rawEvents[0].clientEventId).toBe(id); expect(queued()).toHaveLength(0);
});
it("uses provider-tagged legacy entries when the service advertises only Claude", async () => {
  await mock.stop(); mock = await startMockService({ rawActivity: true });
  writeFileSync(join(repo, ".codex/memory-config.json"), JSON.stringify({ project_id: "proj_codex", server: mock.url }));
  await hook({ hook_event_name: "UserPromptSubmit", prompt: "test" });
  expect(mock.rawEvents).toHaveLength(0); expect(mock.createdEntries).toHaveLength(1);
  expect(mock.createdEntries[0].tags).toContain("provider:codex");
  expect(mock.createdEntries[0].status).toBe("pending");
});
it("omits ignored apply_patch content and namespaced memory tool output", async () => {
  writeFileSync(join(repo, ".projectmemoryignore"), "private/**\n");
  await hook({ hook_event_name: "PostToolUse", tool_name: "apply_patch", tool_input: { command: "*** Begin Patch\n*** Add File: private/a.txt\n+sensitive-value\n*** End Patch" } });
  await hook({ hook_event_name: "PostToolUse", tool_name: "mcp__plugin_weft_memory__memory_search", tool_response: "recursive-memory-value" });
  expect(mock.rawEvents).toHaveLength(2);
  expect(JSON.stringify(mock.rawEvents)).not.toContain("sensitive-value");
  expect(JSON.stringify(mock.rawEvents)).not.toContain("recursive-memory-value");
});
it("diagnoses missing links and ignores unsupported events", async () => {
  rmSync(join(repo, ".codex/memory-config.json"));
  const result = await hook({ hook_event_name: "SessionStart" });
  expect(JSON.parse(result.stdout).systemMessage).toContain("not linked");
  await hook({ hook_event_name: "Notification" });
  expect(mock.rawEvents).toHaveLength(0);
});
it("status and MCP use the same credential store as hooks", async () => {
  const status = await run("commands/status.mjs");
  expect(JSON.parse(status.stdout)).toMatchObject({ linked: true, authentication: "ok", transport: "raw", queued: 0 });
  const client = new Client({ name: "codex-test", version: "1" });
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(plugin, "mcp-server/server.mjs")], cwd: repo, env: env as Record<string, string> }));
    expect((await client.listTools()).tools.map(t => t.name)).toContain("memory_search");
    const result = await client.callTool({ name: "memory_search", arguments: { query: "test" } });
    expect(result.isError).not.toBe(true);
  } finally { await client.close(); }
});
it("quarantines rejected raw events and retains transient failures", async () => {
  mock.rawControl.code = 503;
  await hook({ hook_event_name: "Stop", last_assistant_message: "retry" });
  expect(queued()).toHaveLength(1);
  mock.rawControl.code = 200; mock.rawControl.rejectNext = true;
  await hook({ hook_event_name: "SessionStart" });
  expect(queued().every(f => String(f).includes("quarantine"))).toBe(true);
});

it("refreshes shared context before prompts and only retains acknowledged delivery receipts",async()=>{
  mock.contextControl.code=200;
  const first=await hook({hook_event_name:"SessionStart"});
  expect(JSON.parse(first.stdout).hookSpecificOutput.additionalContext).toContain("Shared reviewed guideline");
  expect(mock.contextAcks).toHaveLength(1);
  mock.contextControl.content="Changed on another CLI";
  const prompt=await hook({hook_event_name:"UserPromptSubmit",prompt:"task pmt_test"});
  expect(JSON.parse(prompt.stdout).hookSpecificOutput).toMatchObject({hookEventName:"UserPromptSubmit"});
  expect(prompt.stdout).toContain("Changed on another CLI");
  expect(mock.contextCalls[1]).toMatchObject({previousReceiptId:"ctx_1",query:"task [REDACTED]"});
  mock.contextControl.ackCode=503;
  await hook({hook_event_name:"UserPromptSubmit",prompt:"next"});
  mock.contextControl.ackCode=200;
  await hook({hook_event_name:"UserPromptSubmit",prompt:"retry"});
  expect(mock.contextCalls[3].previousReceiptId).toBe("ctx_2");
  await hook({hook_event_name:"SessionStart"});
  expect(mock.contextCalls.at(-1).previousReceiptId).toBeUndefined();
});
