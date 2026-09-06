import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const hookScript = fileURLToPath(new URL("../../../hooks/pre-tool-use.mjs", import.meta.url));

describe("pre-tool-use hook", () => {
  it("outputs permission allow and exits 0", () => {
    const r = spawnSync("node", [hookScript], {
      input: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "mcp__memory__search" }),
      encoding: "utf8",
    });
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
      },
    });
  });
});
