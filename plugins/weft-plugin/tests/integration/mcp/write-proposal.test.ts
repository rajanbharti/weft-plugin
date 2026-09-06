import { describe, it, expect, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { makeHarness, Harness } from "./helpers/harness.js";

let harness: Harness | null = null;
afterEach(async () => { if (harness) await harness.stop(); harness = null; });

describe("mcp memory_write_proposal", () => {
  it("creates a pending entry attributed to git identity", async () => {
    harness = await makeHarness({ fixtures: { validToken: "pmt_test" } });
    execSync("git init -q", { cwd: harness.projectDir });
    execSync("git config user.email a@e.com", { cwd: harness.projectDir });
    execSync("git config user.name \"A Example\"", { cwd: harness.projectDir });

    const res = await harness.client.callTool({
      name: "memory_write_proposal",
      arguments: { content: "noticed: middleware is legacy", category: "codebase", tags: ["gotcha"] },
    });
    expect(res.isError).toBeFalsy();
    const text = (res.content as any[]).map((c) => c.text).join("");
    expect(text).toMatch(/entry_/);
    expect(text).toContain("pending");
  });

  it("returns isError when git identity is missing", async () => {
    harness = await makeHarness({ fixtures: { validToken: "pmt_test" } });
    // No git init / no user.email configured.
    const res = await harness.client.callTool({
      name: "memory_write_proposal",
      arguments: { content: "x", category: "codebase" },
    });
    expect(res.isError).toBe(true);
    const text = (res.content as any[]).map((c) => c.text).join("");
    expect(text).toContain("git config user.email");
  });

  it("returns isError on 401 from service", async () => {
    harness = await makeHarness({
      fixtures: { validToken: "pmt_server" },
      tokenOverride: "pmt_wrong",
    });
    execSync("git init -q", { cwd: harness.projectDir });
    execSync("git config user.email a@e.com", { cwd: harness.projectDir });
    execSync("git config user.name \"A Example\"", { cwd: harness.projectDir });
    const res = await harness.client.callTool({
      name: "memory_write_proposal",
      arguments: { content: "x", category: "codebase" },
    });
    expect(res.isError).toBe(true);
    const text = (res.content as any[]).map((c) => c.text).join("");
    expect(text).toMatch(/invalid|rotated/i);
  });
});
