import { it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { makeHarness } from "./helpers/harness.js";
import { saveRepoConfig, saveToken } from "../../../src/lib/config.js";

it("a running MCP server discovers a new repository link without CLAUDE_PROJECT_DIR or restart", async () => {
  const h = await makeHarness({ linked: false, omitProjectEnv: true });
  try {
    const before = await h.client.callTool({ name: "memory_recent", arguments: {} });
    expect(before.isError).toBe(true);
    await saveRepoConfig(h.projectDir, { project_id: "proj_mcp", server: h.serverUrl });
    await saveToken("proj_mcp", "pmt_test");
    execFileSync("git", ["init", "--quiet"], { cwd: h.projectDir });
    execFileSync("git", ["config", "user.email", "developer@example.com"], { cwd: h.projectDir });
    const after = await h.client.callTool({ name: "memory_recent", arguments: {} });
    expect(after.isError).not.toBe(true);
    const write = await h.client.callTool({ name: "memory_write_proposal", arguments: {
      content: "Repository overview from CLAUDE.md", category: "codebase",
    } });
    expect(write.isError).not.toBe(true);
    expect(JSON.stringify(write.content)).toContain("Proposed entry");
  } finally { await h.stop(); }
});
