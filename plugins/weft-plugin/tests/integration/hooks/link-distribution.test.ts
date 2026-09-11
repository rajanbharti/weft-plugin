import { it, expect } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startMockService } from "../helpers/mock-service.js";

it("the shipped link command uses hosted Weft without server configuration", async () => {
  const mock = await startMockService({ validToken: "pmt_test" });
  const dir = mkdtempSync(join(tmpdir(), "weft-distribution-"));
  try {
    const script = fileURLToPath(new URL("../../../commands/link.mjs", import.meta.url));
    const preload = join(dir, "redirect-test-api.mjs");
    writeFileSync(preload, `
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (url, init) => {
        const requestUrl = new URL(url);
        if (requestUrl.origin !== "https://service-production-a3ce.up.railway.app") throw new Error("Unexpected server");
        return originalFetch(${JSON.stringify(mock.url)} + requestUrl.pathname + requestUrl.search, init);
      };
    `);
    const result = await new Promise<{ code: number | null; error: string }>((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", preload, script, "proj_test", "pmt_test"], {
        env: { ...process.env, AGENT_MEMORY_DEFAULT_SERVER: "", CLAUDE_PLUGIN_OPTION_DEFAULTSERVER: mock.url,
          CLAUDE_PROJECT_DIR: dir, CLAUDE_PLUGIN_DATA: join(dir, "private") },
      });
      let error = "";
      child.stderr.on("data", (data) => { error += data; });
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, error }));
    });
    expect(result.error).toBe("");
    expect(result.code).toBe(0);
    const config = JSON.parse(readFileSync(join(dir, ".claude/memory-config.json"), "utf8"));
    expect(config).toEqual({ project_id: "proj_test", server: "https://service-production-a3ce.up.railway.app" });
    expect(JSON.stringify(config)).not.toContain("pmt_test");
  } finally {
    await mock.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
