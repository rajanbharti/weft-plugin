import { it, expect } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startMockService } from "../helpers/mock-service.js";

it("the shipped link command uses the configured plugin server", async () => {
  const mock = await startMockService({ validToken: "pmt_test" });
  const dir = mkdtempSync(join(tmpdir(), "weft-distribution-"));
  try {
    const script = fileURLToPath(new URL("../../../commands/link.mjs", import.meta.url));
    const result = await new Promise<{ code: number | null; error: string }>((resolve, reject) => {
      const child = spawn(process.execPath, [script, "proj_test", "pmt_test"], {
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
    expect(config).toEqual({ project_id: "proj_test", server: mock.url });
    expect(JSON.stringify(config)).not.toContain("pmt_test");
  } finally {
    await mock.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
