import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runRecent } from "../../../src/commands/recent.js";
import { saveRepoConfig, saveToken } from "../../../src/lib/config.js";
import { startMockService } from "../../integration/helpers/mock-service.js";

let projectDir: string;
let pluginDataDir: string;
let mock: Awaited<ReturnType<typeof startMockService>>;

beforeEach(async () => {
  projectDir = mkdtempSync(join(tmpdir(), "plugin-recent-repo-"));
  pluginDataDir = mkdtempSync(join(tmpdir(), "plugin-recent-data-"));
  process.env.CLAUDE_PLUGIN_DATA = pluginDataDir;
  mock = await startMockService({
    validToken: "pmt_r",
    recent: [
      { id: "entry_a", content: "a entry", category: "decision", status: "approved", pinned: false, authorEmail: "a@e.com", createdAt: "2026-04-01T00:00:00Z" },
    ],
  });
  await saveRepoConfig(projectDir, { project_id: "proj_r", server: mock.url });
  await saveToken("proj_r", "pmt_r");
});

afterEach(async () => {
  await mock.stop();
  delete process.env.CLAUDE_PLUGIN_DATA;
  rmSync(projectDir, { recursive: true, force: true });
  rmSync(pluginDataDir, { recursive: true, force: true });
});

describe("runRecent", () => {
  it("lists entries", async () => {
    const res = await runRecent({ projectDir, limit: 10 });
    expect(res.ok).toBe(true);
    expect(res.output).toContain("entry_a");
  });

  it("accepts no arguments (defaults limit)", async () => {
    const res = await runRecent({ projectDir });
    expect(res.ok).toBe(true);
  });

  it("errors when not linked", async () => {
    const other = mkdtempSync(join(tmpdir(), "other-recent-"));
    try {
      const res = await runRecent({ projectDir: other });
      expect(res.ok).toBe(false);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });
});
