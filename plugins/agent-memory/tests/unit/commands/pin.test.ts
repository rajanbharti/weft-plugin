import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPin } from "../../../src/commands/pin.js";
import { saveRepoConfig, saveToken } from "../../../src/lib/config.js";
import { startMockService } from "../../integration/helpers/mock-service.js";

let projectDir: string;
let pluginDataDir: string;
let mock: Awaited<ReturnType<typeof startMockService>>;

beforeEach(async () => {
  projectDir = mkdtempSync(join(tmpdir(), "plugin-pin-repo-"));
  pluginDataDir = mkdtempSync(join(tmpdir(), "plugin-pin-data-"));
  process.env.CLAUDE_PLUGIN_DATA = pluginDataDir;
  mock = await startMockService({ validToken: "pmt_p" });
  await saveRepoConfig(projectDir, { project_id: "proj_p", server: mock.url });
  await saveToken("proj_p", "pmt_p");
});

afterEach(async () => {
  await mock.stop();
  delete process.env.CLAUDE_PLUGIN_DATA;
  rmSync(projectDir, { recursive: true, force: true });
  rmSync(pluginDataDir, { recursive: true, force: true });
});

describe("runPin", () => {
  it("pins an entry", async () => {
    const res = await runPin({ projectDir, entryId: "entry_123" });
    expect(res.ok).toBe(true);
    expect(res.output).toContain("entry_123");
  });

  it("errors when entry id is missing", async () => {
    const res = await runPin({ projectDir, entryId: "" });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("entry-id");
  });
});
