// src/lib/project-path.ts
import { realpathSync } from "node:fs";
import { dirname, basename, join, relative, isAbsolute } from "node:path";
function canonicalPath(path) {
  try {
    return realpathSync(path);
  } catch {
    const parent = dirname(path);
    return parent === path ? path : join(canonicalPath(parent), basename(path));
  }
}
function repoRelativePath(projectDir, path) {
  return isAbsolute(path) ? relative(canonicalPath(projectDir), canonicalPath(path)) : path;
}

// src/lib/data-dir.ts
import { homedir } from "node:os";
import { join as join2 } from "node:path";
function pluginDataDir() {
  return process.env.CLAUDE_PLUGIN_DATA?.trim() || join2(process.env.CLAUDE_CONFIG_DIR?.trim() || join2(homedir(), ".claude"), "plugins", "data", "weft-plugin");
}

// src/hooks/post-tool-edit.ts
import { readFileSync as readFileSync3 } from "node:fs";

// src/lib/config.ts
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, chmodSync } from "node:fs";
import { join as join3 } from "node:path";
var REPO_CONFIG_PATH = [".claude", "memory-config.json"];
var DEFAULT_BUDGET = 3e3;
function repoConfigFile(projectDir) {
  return join3(projectDir, ...REPO_CONFIG_PATH);
}
function tokensFile() {
  return join3(pluginDataDir(), "tokens.json");
}
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}
async function loadLinkedProject(projectDir) {
  const repo = readJson(repoConfigFile(projectDir));
  if (!repo || !repo.project_id || !repo.server) return null;
  const tokens = readJson(tokensFile()) ?? {};
  const token = tokens[repo.project_id];
  if (!token) return null;
  return {
    projectId: repo.project_id,
    token,
    server: repo.server,
    primingTokenBudget: repo.priming_token_budget ?? DEFAULT_BUDGET,
    captureFileEdits: repo.capture_file_edits ?? false,
    gitCommitMinMessageChars: repo.git_commit_min_message_chars ?? 12
  };
}

// src/lib/repo-hash.ts
import { createHash } from "node:crypto";
import { realpathSync as realpathSync2 } from "node:fs";
function repoHash(absolutePath) {
  const real = (() => {
    try {
      return realpathSync2(absolutePath);
    } catch {
      return absolutePath;
    }
  })();
  return createHash("sha256").update(real).digest("hex").slice(0, 16);
}

// src/lib/buffer.ts
import {
  mkdirSync as mkdirSync2,
  appendFileSync,
  readFileSync as readFileSync2,
  writeFileSync as writeFileSync2,
  statSync,
  existsSync as existsSync2,
  renameSync
} from "node:fs";
import { join as join4 } from "node:path";
function bufferPathFor(repoHash2) {
  return join4(pluginDataDir(), "buffers", `${repoHash2}.jsonl`);
}
async function appendRecord(repoHash2, record) {
  const path = bufferPathFor(repoHash2);
  mkdirSync2(join4(pluginDataDir(), "buffers"), { recursive: true });
  appendFileSync(path, JSON.stringify(record) + "\n", "utf8");
}
async function trimIfTooLarge(repoHash2, maxBytes) {
  const path = bufferPathFor(repoHash2);
  if (!existsSync2(path)) return false;
  const size = statSync(path).size;
  if (size <= maxBytes) return false;
  const buf = readFileSync2(path);
  const target = 1e6;
  const tail = buf.subarray(buf.length - target);
  const nl = tail.indexOf(10);
  const kept = nl >= 0 ? tail.subarray(nl + 1) : tail;
  writeFileSync2(path, kept);
  return true;
}

// src/lib/logging.ts
import { mkdirSync as mkdirSync3, appendFileSync as appendFileSync2, readdirSync, statSync as statSync2, unlinkSync } from "node:fs";
import { join as join5 } from "node:path";
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
    const full = join5(logsDir, e);
    try {
      if (statSync2(full).mtimeMs < cutoff) unlinkSync(full);
    } catch {
    }
  }
}
function createLogger(baseDir) {
  const logsDir = join5(baseDir, "logs");
  try {
    mkdirSync3(logsDir, { recursive: true });
  } catch {
  }
  pruneOldLogs(logsDir);
  function write(level, event, fields) {
    const line = JSON.stringify({ time: (/* @__PURE__ */ new Date()).toISOString(), level, event, ...fields ?? {} }) + "\n";
    const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    try {
      appendFileSync2(join5(logsDir, `${today}.log`), line, { encoding: "utf8" });
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

// src/hooks/post-tool-edit.ts
var log = createLogger(pluginDataDir());
function readStdin() {
  try {
    return readFileSync3(0, "utf8");
  } catch {
    return "";
  }
}
function locDelta(newStr, oldStr) {
  const newLines = newStr ? newStr.split("\n").length : 0;
  const oldLines = oldStr ? oldStr.split("\n").length : 0;
  return Math.abs(newLines - oldLines) || newLines;
}
async function main() {
  const projectDir = process.cwd();
  if (!projectDir) {
    process.exit(0);
  }
  const linked = await loadLinkedProject(projectDir);
  if (!linked) {
    log.info("hook.post-tool-edit.skipped", { reason: "not_linked" });
    process.exit(0);
  }
  if (!linked.captureFileEdits) {
    log.info("hook.post-tool-edit.skipped", { reason: "disabled" });
    process.exit(0);
  }
  const input = (() => {
    try {
      return JSON.parse(readStdin());
    } catch {
      return {};
    }
  })();
  const sessionId = input.session_id ?? "unknown";
  const ts = (/* @__PURE__ */ new Date()).toISOString();
  const hash = repoHash(projectDir);
  const trimmed = await trimIfTooLarge(hash, 1e7);
  if (trimmed) log.warn("hook.post-tool-edit.buffer_trimmed", { hash });
  const toRepoRelative = (p) => repoRelativePath(projectDir, p);
  const writes = [];
  if (input.tool_name === "MultiEdit" && Array.isArray(input.tool_input?.edits)) {
    for (const e of input.tool_input.edits) {
      if (e.file_path) writes.push({ path: toRepoRelative(e.file_path), loc_delta: locDelta(e.new_string, e.old_string) });
    }
  } else if (input.tool_input?.file_path) {
    writes.push({
      path: toRepoRelative(input.tool_input.file_path),
      loc_delta: locDelta(input.tool_input.new_string, input.tool_input.old_string)
    });
  }
  for (const w of writes) {
    await appendRecord(hash, {
      kind: "edit",
      session_id: sessionId,
      path: w.path,
      loc_delta: w.loc_delta,
      ts
    });
  }
  log.info("hook.post-tool-edit.appended", { count: writes.length });
  process.exit(0);
}
main().catch((e) => {
  log.error("hook.post-tool-edit.uncaught", { error: e?.message ?? String(e) });
  process.exit(0);
});
