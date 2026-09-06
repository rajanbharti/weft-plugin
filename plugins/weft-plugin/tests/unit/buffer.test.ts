import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendRecord, readAllCandidates, readEditLogsForSession,
  rewriteBuffer, trimIfTooLarge, bufferPathFor,
} from "../../src/lib/buffer.js";

let pluginDataDir: string;
const HASH = "abcd1234abcd1234";

beforeEach(() => {
  pluginDataDir = mkdtempSync(join(tmpdir(), "plugin-buf-"));
  process.env.CLAUDE_PLUGIN_DATA = pluginDataDir;
});

afterEach(() => {
  delete process.env.CLAUDE_PLUGIN_DATA;
  rmSync(pluginDataDir, { recursive: true, force: true });
});

describe("buffer", () => {
  it("appends and reads candidates and edit logs roundtrip", async () => {
    await appendRecord(HASH, { kind: "edit", session_id: "s1", path: "a.ts", loc_delta: 5, ts: "2026-04-27T00:00:00Z" });
    await appendRecord(HASH, {
      kind: "candidate",
      id: "buf_x",
      session_id: "s1",
      category: "decision",
      source: "git-commit",
      content: "msg",
      tags: ["git-commit"],
      namespace: null,
      redactionApplied: false,
      ts: "2026-04-27T00:00:01Z",
    });
    const cands = await readAllCandidates(HASH);
    expect(cands.length).toBe(1);
    expect(cands[0].id).toBe("buf_x");
    const edits = await readEditLogsForSession(HASH, "s1");
    expect(edits.length).toBe(1);
    expect(edits[0].path).toBe("a.ts");
  });

  it("rewriteBuffer keeps only specified records", async () => {
    await appendRecord(HASH, { kind: "edit", session_id: "s1", path: "a", loc_delta: 1, ts: "t1" });
    await appendRecord(HASH, { kind: "edit", session_id: "s2", path: "b", loc_delta: 2, ts: "t2" });
    const keep = (await readEditLogsForSession(HASH, "s2")).map((r) => r as any);
    await rewriteBuffer(HASH, keep);
    expect(await readEditLogsForSession(HASH, "s1")).toEqual([]);
    expect(await readEditLogsForSession(HASH, "s2")).toHaveLength(1);
  });

  it("readAllCandidates skips malformed JSON lines", async () => {
    const path = bufferPathFor(HASH);
    mkdirSync(join(pluginDataDir, "buffers"), { recursive: true });
    writeFileSync(path, "{not json}\n" + JSON.stringify({
      kind: "candidate", id: "buf_y", session_id: "s", category: "decision",
      source: "manual", content: "x", tags: [], namespace: null,
      redactionApplied: false, ts: "t",
    }) + "\n");
    const cands = await readAllCandidates(HASH);
    expect(cands.length).toBe(1);
    expect(cands[0].id).toBe("buf_y");
  });

  it("trimIfTooLarge keeps the tail when over the cap", async () => {
    const path = bufferPathFor(HASH);
    mkdirSync(join(pluginDataDir, "buffers"), { recursive: true });
    const huge = "x".repeat(2_500_000);
    writeFileSync(path, huge);
    const trimmed = await trimIfTooLarge(HASH, 1_000_000);
    expect(trimmed).toBe(true);
    expect(statSync(path).size).toBeLessThanOrEqual(1_000_000);
    expect(statSync(path).size).toBeGreaterThan(0);
  });

  it("trimIfTooLarge is a no-op below the cap", async () => {
    const path = bufferPathFor(HASH);
    mkdirSync(join(pluginDataDir, "buffers"), { recursive: true });
    writeFileSync(path, "small content");
    const trimmed = await trimIfTooLarge(HASH, 1_000_000);
    expect(trimmed).toBe(false);
  });
});
