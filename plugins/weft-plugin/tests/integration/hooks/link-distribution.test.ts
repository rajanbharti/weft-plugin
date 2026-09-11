import { it, expect } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startMockService } from "../helpers/mock-service.js";

it.each(["explicit", "fallback"])("the shipped link command uses hosted Weft with %s data storage", async (storage) => {
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
          CLAUDE_PROJECT_DIR: dir, CLAUDE_PLUGIN_DATA: storage === "explicit" ? join(dir, "private") : undefined, CLAUDE_CONFIG_DIR: join(dir, "claude-config") },
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
    const dataDir = storage === "explicit" ? join(dir, "private") : join(dir, "claude-config", "plugins", "data", "weft-plugin");
    const tokenFile = join(dataDir, "tokens.json");
    expect(JSON.parse(readFileSync(tokenFile, "utf8"))).toEqual({ proj_test: "pmt_test" });
    expect(statSync(tokenFile).mode & 0o777).toBe(0o600);
  } finally {
    await mock.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
