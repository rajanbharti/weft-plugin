import { beforeEach, afterEach, it, expect } from "vitest";
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activityQueueDir, enqueueActivity, flushActivity } from "../../../src/lib/activity.js";
import type { LinkedProject } from "../../../src/lib/config.js";
import { startMockService } from "../helpers/mock-service.js";

let dir: string;
let data: string;
let linked: LinkedProject;
let mock: Awaited<ReturnType<typeof startMockService>>;
const pending = () => readdirSync(activityQueueDir(dir, linked)).filter(p => p.endsWith(".json"));
const enqueue = (prompt = "Task requested") => enqueueActivity(dir, linked, { hook_event_name: "UserPromptSubmit", prompt, session_id: "session-a" });
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "weft-raw-repo-"));
  data = mkdtempSync(join(tmpdir(), "weft-raw-data-"));
  process.env.CLAUDE_PLUGIN_DATA = data;
  execFileSync("git", ["init", "--quiet"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "developer@example.com"], { cwd: dir });
  mock = await startMockService({ rawActivity: true });
  linked = { projectId: "proj_raw", server: mock.url, token: "pmt_test", primingTokenBudget: 3000, captureFileEdits: false, gitCommitMinMessageChars: 12 };
});
afterEach(async () => {
  await mock.stop();
  delete process.env.CLAUDE_PLUGIN_DATA;
  rmSync(dir, { recursive: true, force: true });
  rmSync(data, { recursive: true, force: true });
});
it("uploads versioned raw evidence without creating a legacy memory entry", async () => {
  const id = enqueue();
  expect(await flushActivity(dir, linked)).toBe(1);
  expect(mock.createdEntries).toHaveLength(0);
  expect(mock.rawEvents).toHaveLength(1);
  expect(mock.rawEvents[0]).toMatchObject({ clientEventId: id, provider: "claude", eventType: "prompt.submitted", sessionId: "session-a", actor: { email: "developer@example.com" } });
  expect(mock.rawEvents[0].repositoryId).toBeTruthy();
  expect(pending()).toHaveLength(0);
});
it("retains the same event and repository IDs after a lost acknowledgement", async () => {
  enqueue();
  mock.rawControl.loseAck = true;
  await expect(flushActivity(dir, linked)).rejects.toThrow();
  expect(pending()).toHaveLength(1);
  const first = mock.rawEvents[0];
  expect(await flushActivity(dir, linked)).toBe(1);
  expect(mock.rawEvents).toEqual([first]);
  expect(pending()).toHaveLength(0);
});
it("quarantines a permanently rejected event and continues to the next event", async () => {
  enqueue("first");
  enqueue("second");
  mock.rawControl.rejectNext = true;
  expect(await flushActivity(dir, linked)).toBe(1);
  expect(mock.rawEvents).toHaveLength(1);
  expect(pending()).toHaveLength(0);
  const quarantined = readdirSync(join(activityQueueDir(dir, linked), "quarantine"));
  expect(quarantined.filter(f => f.endsWith(".json"))).toHaveLength(1);
  expect(quarantined.filter(f => f.endsWith(".reason"))).toHaveLength(1);
});
it("never falls back to legacy on server or authentication failures", async () => {
  enqueue();
  mock.rawControl.capabilityCode = 503;
  await expect(flushActivity(dir, linked)).rejects.toThrow();
  expect(pending()).toHaveLength(1);
  expect(mock.createdEntries).toHaveLength(0);
  mock.rawControl.capabilityCode = 401;
  await expect(flushActivity(dir, linked)).rejects.toThrow();
  expect(mock.createdEntries).toHaveLength(0);
});
it("pins the selected legacy transport across an upgrade after an uncertain response", async () => {
  enqueue();
  mock.rawControl.capabilityCode = 404;
  mock.writeStatus.code = 503;
  await expect(flushActivity(dir, linked)).rejects.toThrow();
  mock.rawControl.capabilityCode = 200;
  mock.writeStatus.code = 200;
  await flushActivity(dir, linked);
  expect(mock.createdEntries).toHaveLength(1);
  expect(mock.rawEvents).toHaveLength(0);
});
it("preserves legacy queue records instead of interpreting them as new raw events", async () => {
  enqueue();
  const file = join(activityQueueDir(dir, linked), pending()[0]);
  const wrapper = JSON.parse(readFileSync(file, "utf8"));
  writeFileSync(file, JSON.stringify(wrapper.legacyEntry));
  await flushActivity(dir, linked);
  expect(mock.createdEntries).toEqual([wrapper.legacyEntry]);
  expect(mock.rawEvents).toHaveLength(0);
});
it("captures a stable repository descriptor without remote credentials", async () => {
  execFileSync("git", ["init", "--quiet"], { cwd: dir });
  execFileSync("git", ["remote", "add", "origin", "https://user:private-password@github.com/org/repo.git?access_token=secret"], { cwd: dir });
  enqueue();
  const stored = readFileSync(join(activityQueueDir(dir, linked), pending()[0]), "utf8");
  expect(stored).not.toContain("private-password");
  expect(stored).not.toContain("access_token");
  expect(JSON.parse(stored).repository.remoteUrl).toBe("https://github.com/org/repo");
});
