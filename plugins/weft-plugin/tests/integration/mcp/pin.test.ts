import { describe, it, expect, afterEach } from "vitest";
import { makeHarness, Harness } from "./helpers/harness.js";

let harness: Harness | null = null;
afterEach(async () => { if (harness) await harness.stop(); harness = null; });

describe("mcp memory_pin", () => {
  it("pins an entry", async () => {
    harness = await makeHarness({ fixtures: { validToken: "pmt_test" } });
    const res = await harness.client.callTool({
      name: "memory_pin",
      arguments: { entryId: "entry_9" },
    });
    expect(res.isError).toBeFalsy();
    const text = (res.content as any[]).map((c) => c.text).join("");
    expect(text).toContain("entry_9");
  });

  it("returns isError on 401 from service", async () => {
    harness = await makeHarness({
      fixtures: { validToken: "pmt_server" },
      tokenOverride: "pmt_wrong",
    });
    const res = await harness.client.callTool({ name: "memory_pin", arguments: { entryId: "entry_1" } });
    expect(res.isError).toBe(true);
    const text = (res.content as any[]).map((c) => c.text).join("");
    expect(text).toMatch(/invalid|rotated/i);
  });
});
