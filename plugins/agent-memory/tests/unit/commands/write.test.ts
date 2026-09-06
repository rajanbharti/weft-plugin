import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runWrite } from "../../../src/commands/write.js";
import { saveRepoConfig, saveToken } from "../../../src/lib/config.js";
import { startMockService } from "../../integration/helpers/mock-service.js";

let projectDir: string;
let pluginDataDir: string;
let mock: Awaited<ReturnType<typeof startMockService>>;

beforeEach(async () => {
  projectDir = mkdtempSync(join(tmpdir(), "plugin-write-repo-"));
  pluginDataDir = mkdtempSync(join(tmpdir(), "plugin-write-data-"));
  process.env.CLAUDE_PLUGIN_DATA = pluginDataDir;
  execSync("git init -q", { cwd: projectDir });
  execSync("git config user.email dev@e.com", { cwd: projectDir });
  execSync("git config user.name \"Dev Example\"", { cwd: projectDir });
  mock = await startMockService({ validToken: "pmt_w" });
  await saveRepoConfig(projectDir, { project_id: "proj_w", server: mock.url });
  await saveToken("proj_w", "pmt_w");
});

afterEach(async () => {
  await mock.stop();
  delete process.env.CLAUDE_PLUGIN_DATA;
  rmSync(projectDir, { recursive: true, force: true });
  rmSync(pluginDataDir, { recursive: true, force: true });
});

describe("runWrite", () => {
  it("creates an approved decision entry", async () => {
    const res = await runWrite({ projectDir, content: "We went with Drizzle." });
    expect(res.ok).toBe(true);
    expect(res.output).toMatch(/entry_/);
  });

  it("errors when content is empty", async () => {
    const res = await runWrite({ projectDir, content: "" });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("content");
  });

  it("errors when git identity is missing", async () => {
    execSync("git config --unset-all user.email || true", { cwd: projectDir });
    const res = await runWrite({ projectDir, content: "anything" });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("git config user.email");
  });
});
