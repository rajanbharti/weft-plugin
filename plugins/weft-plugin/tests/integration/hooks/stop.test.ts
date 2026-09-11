import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { saveRepoConfig, saveToken } from "../../../src/lib/config.js";
import { repoHash } from "../../../src/lib/repo-hash.js";
import { appendRecord, bufferPathFor } from "../../../src/lib/buffer.js";
import { startMockService } from "../helpers/mock-service.js";

const hookScript = fileURLToPath(new URL("../../../hooks/stop.mjs", import.meta.url));

let projectDir: string;
let pluginDataDir: string;
let mock: Awaited<ReturnType<typeof startMockService>>;

beforeEach(async () => {
  projectDir = mkdtempSync(join(tmpdir(), "stop-repo-"));
  pluginDataDir = mkdtempSync(join(tmpdir(), "stop-data-"));
  process.env.CLAUDE_PLUGIN_DATA = pluginDataDir;
  mock = await startMockService({ validToken: "pmt_t" });
  await saveRepoConfig(projectDir, { project_id: "proj_x", server: mock.url, capture_file_edits: true } as any);
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
    cwd: projectDir,
    env: { ...process.env, CLAUDE_PROJECT_DIR: "/incorrect-env-directory", CLAUDE_PLUGIN_DATA: pluginDataDir },
    input: JSON.stringify(input),
    encoding: "utf8",
  });
}

describe("stop hook", () => {
  it("rolls up edit logs into one active-work candidate", async () => {
    const hash = repoHash(projectDir);
    for (const p of ["src/a.ts", "src/b.ts", "tests/x.test.ts"]) {
      await appendRecord(hash, { kind: "edit", session_id: "s1", path: p, loc_delta: 5, ts: new Date().toISOString() });
    }
    const r = invoke({ session_id: "s1", hook_event_name: "Stop" });
    expect(r.status).toBe(0);
    const lines = readFileSync(bufferPathFor(hash), "utf8").trim().split("\n");
    const records = lines.map((l) => JSON.parse(l));
    const candidates = records.filter((r) => r.kind === "candidate");
    expect(candidates).toHaveLength(1);
    expect(candidates[0].source).toBe("file-change");
    expect(candidates[0].category).toBe("active-work");
    expect(candidates[0].content).toContain("3 files");
    // edit rows for s1 are gone
    const edits = records.filter((r) => r.kind === "edit");
    expect(edits.filter((e) => e.session_id === "s1")).toHaveLength(0);
  });

  it("still rolls up when the buffer holds absolute paths", async () => {
    // Buffers written before paths were normalised still contain absolute paths;
    // feeding those to the ignore matcher used to throw and kill the roll-up.
    const hash = repoHash(projectDir);
    for (const p of ["src/a.ts", "src/b.ts"]) {
      await appendRecord(hash, {
        kind: "edit", session_id: "s1", path: join(projectDir, p), loc_delta: 3, ts: new Date().toISOString(),
      });
    }
    const r = invoke({ session_id: "s1", hook_event_name: "Stop" });
    expect(r.status).toBe(0);
    const records = readFileSync(bufferPathFor(hash), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const candidates = records.filter((x) => x.kind === "candidate");
    expect(candidates).toHaveLength(1);
    expect(candidates[0].content).toContain("2 files");
    expect(records.filter((x) => x.kind === "edit" && x.session_id === "s1")).toHaveLength(0);
  });

  it("leaves other sessions' edit logs alone", async () => {
    const hash = repoHash(projectDir);
    await appendRecord(hash, { kind: "edit", session_id: "s1", path: "src/a", loc_delta: 1, ts: "t" });
    await appendRecord(hash, { kind: "edit", session_id: "s2", path: "src/b", loc_delta: 1, ts: "t" });
    invoke({ session_id: "s1", hook_event_name: "Stop" });
    const lines = readFileSync(bufferPathFor(hash), "utf8").trim().split("\n");
    const records = lines.map((l) => JSON.parse(l));
    expect(records.filter((r) => r.kind === "edit" && r.session_id === "s2")).toHaveLength(1);
  });

  it("no-op when no edits in session", () => {
    const r = invoke({ session_id: "empty", hook_event_name: "Stop" });
    expect(r.status).toBe(0);
    expect(existsSync(bufferPathFor(repoHash(projectDir)))).toBe(false);
  });

  it("no-op when capture_file_edits is false", async () => {
    await saveRepoConfig(projectDir, { project_id: "proj_x", server: mock.url } as any);
    const hash = repoHash(projectDir);
    await appendRecord(hash, { kind: "edit", session_id: "s1", path: "x", loc_delta: 1, ts: "t" });
    const r = invoke({ session_id: "s1", hook_event_name: "Stop" });
    expect(r.status).toBe(0);
    // The pre-existing edit log gets dropped (defensive cleanup), no candidate created
    const lines = readFileSync(bufferPathFor(hash), "utf8").split("\n").filter(Boolean);
    expect(lines.filter((l) => JSON.parse(l).kind === "candidate")).toHaveLength(0);
  });
});
