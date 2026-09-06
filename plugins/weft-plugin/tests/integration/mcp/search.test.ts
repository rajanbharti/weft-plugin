import { describe, it, expect, afterEach } from "vitest";
import { makeHarness, Harness } from "./helpers/harness.js";

let harness: Harness | null = null;
afterEach(async () => { if (harness) await harness.stop(); harness = null; });

describe("mcp memory_search", () => {
  it("returns entries from search", async () => {
    harness = await makeHarness({
      fixtures: {
        validToken: "pmt_test",
        recent: [{ id: "entry_h1", content: "cars are red", category: "codebase", status: "approved", pinned: false, authorEmail: "x@e.com" }],
      },
    });
    const res = await harness.client.callTool({
      name: "memory_search",
      arguments: { query: "car", limit: 3 },
    });
    expect(res.isError).toBeFalsy();
    const text = (res.content as any[]).map((c) => c.text).join("");
    expect(text).toContain("entry_h1");
  });

  it("returns isError when repo is not linked", async () => {
    harness = await makeHarness({ linked: false });
    const res = await harness.client.callTool({
      name: "memory_search",
      arguments: { query: "anything" },
    });
    expect(res.isError).toBe(true);
    const text = (res.content as any[]).map((c) => c.text).join("");
    expect(text).toContain("not linked");
  });

  it("returns isError on 401 from service", async () => {
    harness = await makeHarness({
      fixtures: { validToken: "pmt_server" },
      tokenOverride: "pmt_wrong",
    });
    const res = await harness.client.callTool({ name: "memory_search", arguments: { query: "x" } });
    expect(res.isError).toBe(true);
    const text = (res.content as any[]).map((c) => c.text).join("");
    expect(text).toMatch(/invalid|rotated/i);
  });
});
