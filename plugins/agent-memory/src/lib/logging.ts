import { mkdirSync, appendFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

function pruneOldLogs(logsDir: string) {
  let entries: string[];
  try { entries = readdirSync(logsDir); } catch { return; }
  const cutoff = Date.now() - RETENTION_MS;
  for (const e of entries) {
    if (!e.endsWith(".log")) continue;
    const full = join(logsDir, e);
    try {
      if (statSync(full).mtimeMs < cutoff) unlinkSync(full);
    } catch {
      // ignore
    }
  }
}

export function createLogger(baseDir: string): Logger {
  const logsDir = join(baseDir, "logs");
  try { mkdirSync(logsDir, { recursive: true }); } catch { /* ignore */ }
  pruneOldLogs(logsDir);

  function write(level: LogLevel, event: string, fields?: Record<string, unknown>) {
    const line = JSON.stringify({ time: new Date().toISOString(), level, event, ...(fields ?? {}) }) + "\n";
    const today = new Date().toISOString().slice(0, 10);
    try {
      appendFileSync(join(logsDir, `${today}.log`), line, { encoding: "utf8" });
    } catch {
      // best-effort
    }
  }
  return {
    debug: (e, f) => write("debug", e, f),
    info: (e, f) => write("info", e, f),
    warn: (e, f) => write("warn", e, f),
    error: (e, f) => write("error", e, f),
  };
}
