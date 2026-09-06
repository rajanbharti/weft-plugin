import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "../../src/lib/logging.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agent-memory-plugin-log-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("createLogger", () => {
  it("writes one JSON line per call to today's log file", () => {
    const logger = createLogger(dir);
    logger.info("hook.start", { hook: "session-start" });
    logger.warn("api.timeout", { route: "/v1/entries/recent" });

    const today = new Date().toISOString().slice(0, 10);
    const file = join(dir, "logs", `${today}.log`);
    expect(existsSync(file)).toBe(true);
    const lines = readFileSync(file, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    const l0 = JSON.parse(lines[0]);
    expect(l0.level).toBe("info");
    expect(l0.event).toBe("hook.start");
    expect(l0.hook).toBe("session-start");
    expect(typeof l0.time).toBe("string");
  });

  it("silently no-ops when dir is not writable", () => {
    const logger = createLogger("/proc/does-not-exist-ever");
    expect(() => logger.info("x")).not.toThrow();
  });
});

describe("createLogger rotation", () => {
  it("deletes log files older than 7 days at startup", () => {
    const logger = createLogger(dir);
    logger.info("seed");

    // Create an 8-day-old log file in the same dir.
    const oldName = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const oldPath = join(dir, "logs", `${oldName}.log`);
    writeFileSync(oldPath, "old\n");
    const past = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    utimesSync(oldPath, past, past);

    // Recreating the logger triggers prune.
    createLogger(dir);
    expect(existsSync(oldPath)).toBe(false);
  });
});
