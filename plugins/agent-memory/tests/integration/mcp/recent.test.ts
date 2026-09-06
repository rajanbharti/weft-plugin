import { describe, it, expect, afterEach } from "vitest";
import { makeHarness, Harness } from "./helpers/harness.js";

let harness: Harness | null = null;
afterEach(async () => { if (harness) await harness.stop(); harness = null; });

describe("mcp memory_recent", () => {
  it("returns recent entries", async () => {
    harness = await makeHarness({
      fixtures: {
        validToken: "pmt_test",
        recent: [
          { id: "entry_rec1", content: "r1", category: "decision", status: "approved", pinned: false, authorEmail: "a@e.com", createdAt: "2026-04-10T00:00:00Z" },
        ],
      },
    });
    const res = await harness.client.callTool({ name: "memory_recent", arguments: { limit: 5 } });
    expect(res.isError).toBeFalsy();
    const text = (res.content as any[]).map((c) => c.text).join("");
    expect(text).toContain("entry_rec1");
  });

  it("returns isError on 401 from service", async () => {
    harness = await makeHarness({
      fixtures: { validToken: "pmt_server" },
      tokenOverride: "pmt_wrong",
    });
    const res = await harness.client.callTool({ name: "memory_recent", arguments: {} });
    expect(res.isError).toBe(true);
    const text = (res.content as any[]).map((c) => c.text).join("");
    expect(text).toMatch(/invalid|rotated/i);
  });
});
