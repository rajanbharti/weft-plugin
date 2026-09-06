import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSearch } from "../../../src/commands/search.js";
import { saveRepoConfig, saveToken } from "../../../src/lib/config.js";
import { startMockService } from "../../integration/helpers/mock-service.js";

let projectDir: string;
let pluginDataDir: string;
let mock: Awaited<ReturnType<typeof startMockService>>;

beforeEach(async () => {
  projectDir = mkdtempSync(join(tmpdir(), "plugin-search-repo-"));
  pluginDataDir = mkdtempSync(join(tmpdir(), "plugin-search-data-"));
  process.env.CLAUDE_PLUGIN_DATA = pluginDataDir;
  mock = await startMockService({
    validToken: "pmt_s",
    recent: [
      { id: "entry_1", content: "auth uses jwt", category: "codebase", status: "approved", pinned: false, authorEmail: "a@e.com" },
      { id: "entry_2", content: "sessions expire in 30d", category: "decision", status: "approved", pinned: false, authorEmail: "a@e.com" },
    ],
  });
  await saveRepoConfig(projectDir, { project_id: "proj_s", server: mock.url });
  await saveToken("proj_s", "pmt_s");
});

afterEach(async () => {
  await mock.stop();
  delete process.env.CLAUDE_PLUGIN_DATA;
  rmSync(projectDir, { recursive: true, force: true });
  rmSync(pluginDataDir, { recursive: true, force: true });
});

describe("runSearch", () => {
  it("returns formatted results for a query", async () => {
    const res = await runSearch({ projectDir, query: "auth", limit: 2 });
    expect(res.ok).toBe(true);
    expect(res.output).toContain("entry_1");
    expect(res.output).toContain("auth uses jwt");
  });

  it("errors when repo is not linked", async () => {
    const other = mkdtempSync(join(tmpdir(), "other-repo-"));
    try {
      const res = await runSearch({ projectDir: other, query: "x", limit: 2 });
      expect(res.ok).toBe(false);
      expect(res.error).toContain("not linked");
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it("errors when query is empty", async () => {
    const res = await runSearch({ projectDir, query: "", limit: 5 });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("query");
  });
});
