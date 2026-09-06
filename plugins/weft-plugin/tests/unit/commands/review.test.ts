import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runReview, ReviewIO } from "../../../src/commands/review.js";
import { saveRepoConfig, saveToken } from "../../../src/lib/config.js";
import { repoHash } from "../../../src/lib/repo-hash.js";
import { appendRecord, bufferPathFor, readAllCandidates } from "../../../src/lib/buffer.js";
import { startMockService } from "../../integration/helpers/mock-service.js";

let projectDir: string;
let pluginDataDir: string;
let mock: Awaited<ReturnType<typeof startMockService>>;

beforeEach(async () => {
  projectDir = mkdtempSync(join(tmpdir(), "rev-repo-"));
  pluginDataDir = mkdtempSync(join(tmpdir(), "rev-data-"));
  process.env.CLAUDE_PLUGIN_DATA = pluginDataDir;
  execSync("git init -q", { cwd: projectDir });
  execSync("git config user.email a@e.com", { cwd: projectDir });
  execSync("git config user.name A", { cwd: projectDir });
  mock = await startMockService({ validToken: "pmt_t" });
  await saveRepoConfig(projectDir, { project_id: "proj_r", server: mock.url });
  await saveToken("proj_r", "pmt_t");
});

afterEach(async () => {
  await mock.stop();
  delete process.env.CLAUDE_PLUGIN_DATA;
  rmSync(projectDir, { recursive: true, force: true });
  rmSync(pluginDataDir, { recursive: true, force: true });
});

function makeIO(answers: string[]): ReviewIO {
  const writes: string[] = [];
  const editStub = async (text: string) => text + " [edited]";
  return {
    write: (s: string) => { writes.push(s); },
    nextInput: async () => answers.shift() ?? "q",
    edit: editStub,
    written: () => writes.join(""),
  } as ReviewIO;
}

async function seedCandidate(prefix: string) {
  const hash = repoHash(projectDir);
  await appendRecord(hash, {
    kind: "candidate",
    id: `buf_${prefix}`,
    session_id: "s",
    category: "decision",
    source: "git-commit",
    content: `${prefix} content`,
    tags: ["git-commit"],
    namespace: null,
    redactionApplied: false,
    ts: new Date().toISOString(),
  });
}

describe("runReview", () => {
  it("returns early with a friendly message when buffer is empty", async () => {
    const io = makeIO([]);
    const r = await runReview({ projectDir, io });
    expect(r.approved).toBe(0);
    expect(io.written()).toContain("No pending captures");
  });

  it("approves a candidate", async () => {
    await seedCandidate("a");
    const io = makeIO(["a"]);
    const r = await runReview({ projectDir, io });
    expect(r.approved).toBe(1);
    expect(r.dropped).toBe(0);
    expect(await readAllCandidates(repoHash(projectDir))).toEqual([]);
  });

  it("supports skip-to-pending, drop, and quit", async () => {
    await seedCandidate("a"); await seedCandidate("b"); await seedCandidate("c");
    const io = makeIO(["s", "d", "q"]);
    const r = await runReview({ projectDir, io });
    expect(r.sentPending).toBe(1);
    expect(r.dropped).toBe(1);
    expect(r.quit).toBe(true);
    // c remains in buffer
    const remaining = await readAllCandidates(repoHash(projectDir));
    expect(remaining.map((c) => c.id)).toEqual(["buf_c"]);
  });

  it("edit then approve uses the edited content", async () => {
    await seedCandidate("a");
    const io = makeIO(["e", "a"]);
    const r = await runReview({ projectDir, io });
    expect(r.approved).toBe(1);
    expect(io.written()).toContain("[edited]"); // re-prompt re-renders with edited content
  });

  it("errors up-front when git identity is missing", async () => {
    execSync("git config --local --unset-all user.email || true", { cwd: projectDir });
    await seedCandidate("a");
    const io = makeIO(["a"]);
    await expect(runReview({ projectDir, io })).rejects.toThrow(/git config user.email/);
  });

  it("treats service errors mid-walk as quit, preserving the candidate", async () => {
    // Stop the mock service to force a network error.
    await mock.stop();
    await seedCandidate("a"); await seedCandidate("b");
    const io = makeIO(["a"]);
    const r = await runReview({ projectDir, io });
    expect(r.quit).toBe(true);
    expect(r.approved).toBe(0);
    expect(io.written()).toContain("Service unreachable");
    // Both candidates remain in buffer.
    const remaining = await readAllCandidates(repoHash(projectDir));
    expect(remaining.map((c) => c.id).sort()).toEqual(["buf_a", "buf_b"]);
  });

  it("errors up-front when repo is not linked", async () => {
    const blank = mkdtempSync(join(tmpdir(), "rev-blank-"));
    try {
      execSync("git init -q", { cwd: blank });
      execSync("git config user.email a@e.com", { cwd: blank });
      const io = makeIO(["a"]);
      await expect(runReview({ projectDir: blank, io })).rejects.toThrow(/not linked/i);
    } finally {
      rmSync(blank, { recursive: true, force: true });
    }
  });
});
