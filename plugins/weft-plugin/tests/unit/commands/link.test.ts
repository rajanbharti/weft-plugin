import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLink } from "../../../src/commands/link.js";
import { startMockService } from "../../integration/helpers/mock-service.js";

let projectDir: string;
let pluginDataDir: string;
let mock: Awaited<ReturnType<typeof startMockService>>;

beforeEach(async () => {
  projectDir = mkdtempSync(join(tmpdir(), "plugin-link-repo-"));
  pluginDataDir = mkdtempSync(join(tmpdir(), "plugin-link-data-"));
  process.env.CLAUDE_PLUGIN_DATA = pluginDataDir;
  mock = await startMockService({ validToken: "pmt_good" });
});

afterEach(async () => {
  await mock.stop();
  delete process.env.CLAUDE_PLUGIN_DATA;
  rmSync(projectDir, { recursive: true, force: true });
  rmSync(pluginDataDir, { recursive: true, force: true });
});

describe("runLink", () => {
  it("validates the token, writes both config files, returns ok", async () => {
    const res = await runLink({
      projectId: "proj_x",
      token: "pmt_good",
      projectDir,
      defaultServer: mock.url,
    });
    expect(res.ok).toBe(true);
    expect(existsSync(join(projectDir, ".claude", "memory-config.json"))).toBe(true);
    const tokens = JSON.parse(readFileSync(join(pluginDataDir, "tokens.json"), "utf8"));
    expect(tokens.proj_x).toBe("pmt_good");
  });

  it("rejects when token is invalid", async () => {
    const res = await runLink({
      projectId: "proj_x",
      token: "pmt_bad",
      projectDir,
      defaultServer: mock.url,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("Invalid token");
    expect(existsSync(join(projectDir, ".claude", "memory-config.json"))).toBe(false);
  });

  it("rejects missing arguments", async () => {
    const res = await runLink({ projectId: "", token: "pmt_good", projectDir, defaultServer: mock.url });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("project-id");
  });

  it("rejects an insecure server URL before probing", async () => {
    const res = await runLink({
      projectId: "proj_x",
      token: "pmt_good",
      projectDir,
      defaultServer: "http://memory.example.com",
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/HTTPS required/i);
  });

  it("writes a starter .projectmemoryignore when none exists", async () => {
    await runLink({ projectId: "proj_y", token: "pmt_good", projectDir, defaultServer: mock.url });
    const f = join(projectDir, ".projectmemoryignore");
    expect(existsSync(f)).toBe(true);
    const content = readFileSync(f, "utf8");
    for (const seg of ["*.env", "secrets/**", "credentials/**", ".ssh/**"]) {
      expect(content).toContain(seg);
    }
  });

  it("leaves an existing .projectmemoryignore alone", async () => {
    const f = join(projectDir, ".projectmemoryignore");
    writeFileSync(f, "custom\n");
    await runLink({ projectId: "proj_y", token: "pmt_good", projectDir, defaultServer: mock.url });
    expect(readFileSync(f, "utf8")).toBe("custom\n");
  });
});
