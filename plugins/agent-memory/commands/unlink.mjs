// src/commands/unlink.ts
import { existsSync as existsSync2, readFileSync as readFileSync2 } from "node:fs";
import { join as join3 } from "node:path";

// src/lib/config.ts
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, chmodSync } from "node:fs";
import { join } from "node:path";
var REPO_CONFIG_PATH = [".claude", "memory-config.json"];
function repoConfigFile(projectDir) {
  return join(projectDir, ...REPO_CONFIG_PATH);
}
function pluginDataDir() {
  const dir = process.env.CLAUDE_PLUGIN_DATA;
  if (!dir) throw new Error("CLAUDE_PLUGIN_DATA env var not set");
  return dir;
}
function tokensFile() {
  return join(pluginDataDir(), "tokens.json");
}
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}
function writeJson(path, data, mode) {
  const dir = path.slice(0, path.lastIndexOf("/"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf8");
  if (mode !== void 0) chmodSync(path, mode);
}
async function clearRepoConfig(projectDir) {
  const p = repoConfigFile(projectDir);
  if (existsSync(p)) rmSync(p);
}
async function clearToken(projectId) {
  const f = tokensFile();
  const tokens = readJson(f) ?? {};
  if (projectId in tokens) {
    delete tokens[projectId];
    writeJson(f, tokens, 384);
  }
}

// src/lib/logging.ts
import { mkdirSync as mkdirSync2, appendFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join as join2 } from "node:path";
var RETENTION_MS = 7 * 24 * 60 * 60 * 1e3;
function pruneOldLogs(logsDir) {
  let entries;
  try {
    entries = readdirSync(logsDir);
  } catch {
    return;
  }
  const cutoff = Date.now() - RETENTION_MS;
  for (const e of entries) {
    if (!e.endsWith(".log")) continue;
    const full = join2(logsDir, e);
    try {
      if (statSync(full).mtimeMs < cutoff) unlinkSync(full);
    } catch {
    }
  }
}
function createLogger(baseDir) {
  const logsDir = join2(baseDir, "logs");
  try {
    mkdirSync2(logsDir, { recursive: true });
  } catch {
  }
  pruneOldLogs(logsDir);
  function write(level, event, fields) {
    const line = JSON.stringify({ time: (/* @__PURE__ */ new Date()).toISOString(), level, event, ...fields ?? {} }) + "\n";
    const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    try {
      appendFileSync(join2(logsDir, `${today}.log`), line, { encoding: "utf8" });
    } catch {
    }
  }
  return {
    debug: (e, f) => write("debug", e, f),
    info: (e, f) => write("info", e, f),
    warn: (e, f) => write("warn", e, f),
    error: (e, f) => write("error", e, f)
  };
}

// src/commands/unlink.ts
async function runUnlink(input) {
  const cfgPath = join3(input.projectDir, ".claude", "memory-config.json");
  if (!existsSync2(cfgPath)) {
    return { ok: false, error: "This repo is not linked to any project memory." };
  }
  let projectId;
  try {
    projectId = JSON.parse(readFileSync2(cfgPath, "utf8"))?.project_id;
  } catch {
  }
  if (projectId) await clearToken(projectId);
  await clearRepoConfig(input.projectDir);
  return { ok: true, removedProjectId: projectId };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const log = createLogger(process.env.CLAUDE_PLUGIN_DATA ?? "/tmp");
  log.info("command.unlink.invoked");
  const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  runUnlink({ projectDir }).then((r) => {
    log.info(r.ok ? "command.unlink.ok" : "command.unlink.error", { error: r.error });
    if (r.ok) {
      console.log(r.removedProjectId ? `Unlinked ${r.removedProjectId}.` : "Unlinked.");
      process.exit(0);
    }
    console.error(r.error);
    process.exit(1);
  }).catch((e) => {
    log.error("command.unlink.error", { error: e?.message ?? String(e) });
    console.error(e?.message ?? String(e));
    process.exit(1);
  });
}
export {
  runUnlink
};
