// src/lib/project-path.ts
import { existsSync, realpathSync } from "node:fs";

// src/lib/runtime.ts
var isCodex = typeof __WEFT_CODEX__ !== "undefined" && __WEFT_CODEX__;
var configDirectory = isCodex ? ".codex" : ".claude";
var linkCommand = isCodex ? "$memory-link" : "/weft-plugin:memory-link";

// src/lib/project-path.ts
import { dirname, basename, join, relative, isAbsolute, resolve } from "node:path";
function findLinkedRoot(start) {
  let dir = resolve(start);
  for (; ; ) {
    if (existsSync(join(dir, configDirectory, "memory-config.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
function resolveProjectDir() {
  const sessionRoot = isCodex ? void 0 : process.env.CLAUDE_PROJECT_DIR?.trim();
  const cwd = process.cwd();
  return sessionRoot && findLinkedRoot(sessionRoot) || findLinkedRoot(cwd) || cwd;
}

// src/lib/data-dir.ts
import { homedir } from "node:os";
import { join as join2 } from "node:path";
function claudePluginsDataRoot() {
  return join2(process.env.CLAUDE_CONFIG_DIR?.trim() || join2(homedir(), ".claude"), "plugins", "data");
}
function pluginDataDir() {
  if (isCodex) return process.env.WEFT_CODEX_DATA_DIR?.trim() || join2(process.env.CODEX_HOME?.trim() || join2(homedir(), ".codex"), "plugins", "data", "weft-codex");
  return process.env.CLAUDE_PLUGIN_DATA?.trim() || join2(claudePluginsDataRoot(), "weft-plugin-weft");
}
function legacyPluginDataDir() {
  if (isCodex) return null;
  const legacy = join2(claudePluginsDataRoot(), "weft-plugin");
  return legacy === pluginDataDir() ? null : legacy;
}

// src/lib/errors.ts
var PluginError = class extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "PluginError";
  }
};
var NotLinkedError = class extends PluginError {
  constructor() {
    super("not_linked", `Repo not linked. Run ${linkCommand} <project-id> <token> first.`);
  }
};
var TokenInvalidError = class extends PluginError {
  constructor() {
    super("token_invalid", `Project token is invalid or has been rotated. Run ${linkCommand} with a fresh token.`);
  }
};
var NetworkError = class extends PluginError {
  constructor(cause) {
    super("network", `Memory service unreachable: ${cause}`);
  }
};
var UnexpectedStatusError = class extends PluginError {
  constructor(status, body) {
    super("unexpected_status", `Service returned ${status}: ${body}`);
    this.status = status;
  }
};
var InsecureServerError = class extends PluginError {
  constructor(server) {
    super("insecure_server", `Refusing insecure server URL: HTTPS required (localhost exempt). Got: ${server}`);
  }
};

// src/lib/api-client.ts
var LOCAL_HOSTNAMES = /* @__PURE__ */ new Set(["localhost", "127.0.0.1", "::1"]);
function assertAllowedServer(server) {
  let parsed;
  try {
    parsed = new URL(server);
  } catch {
    return;
  }
  if (parsed.protocol === "http:" && !LOCAL_HOSTNAMES.has(parsed.hostname)) {
    throw new InsecureServerError(server);
  }
}
var MemoryApiClient = class {
  constructor(server, token, opts = {}) {
    this.server = server;
    this.token = token;
    assertAllowedServer(server);
    this.timeoutMs = opts.timeoutMs ?? 1e4;
    this.deadline = opts.deadline;
  }
  timeoutMs;
  deadline;
  async request(path, init = {}) {
    let res;
    const controller = new AbortController();
    const remaining = Math.min(this.timeoutMs, (this.deadline ?? Infinity) - Date.now());
    if (remaining <= 0) throw new NetworkError("upload budget exhausted");
    const timeout = setTimeout(() => controller.abort(), remaining);
    try {
      res = await fetch(`${this.server}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          ...init.headers ?? {},
          "authorization": `Bearer ${this.token}`,
          "content-type": "application/json"
        }
      });
      if (res.status === 401) throw new TokenInvalidError();
      if (!res.ok) {
        const body = await res.text();
        throw new UnexpectedStatusError(res.status, body);
      }
      return await res.json();
    } catch (e) {
      if (e instanceof TokenInvalidError || e instanceof UnexpectedStatusError) throw e;
      if (e.name === "AbortError") {
        throw new NetworkError(`timeout after ${this.timeoutMs / 1e3}s`);
      }
      throw new NetworkError(e.message);
    } finally {
      clearTimeout(timeout);
    }
  }
  context(body) {
    return this.request("/v1/context", { method: "POST", body: JSON.stringify(body) });
  }
  acknowledgeContext(id, body) {
    return this.request(`/v1/context/${encodeURIComponent(id)}/ack`, { method: "POST", body: JSON.stringify(body) });
  }
  activityCapabilities() {
    return this.request("/v1/activity/capabilities");
  }
  syncGuidance(repositoryId, files) {
    return this.request("/v1/project-guidance", { method: "PUT", body: JSON.stringify({ repositoryId, files }) });
  }
  ingestActivity(events) {
    return this.request("/v1/activity/events", {
      method: "POST",
      body: JSON.stringify({ schemaVersion: 1, events })
    });
  }
  linkRepository(projectId, remoteUrl, label) {
    return this.request(`/v1/projects/${projectId}/link`, {
      method: "POST",
      body: JSON.stringify({ remoteUrl, label })
    });
  }
  listRecent(params) {
    const q = new URLSearchParams();
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.since) q.set("since", params.since);
    const suffix = q.toString() ? `?${q.toString()}` : "";
    return this.request(`/v1/entries/recent${suffix}`);
  }
  listPinned() {
    return this.request("/v1/entries/pinned");
  }
  search(body) {
    return this.request("/v1/entries/search", {
      method: "POST",
      body: JSON.stringify(body)
    });
  }
  createEntry(body) {
    return this.request("/v1/entries", {
      method: "POST",
      body: JSON.stringify(body)
    });
  }
  pinEntry(entryId, pinned = true) {
    return this.request(`/v1/entries/${entryId}/pin`, {
      method: "POST",
      body: JSON.stringify({ pinned })
    });
  }
  pushIgnoreRules(projectId, patterns) {
    return this.request(`/v1/projects/${projectId}/ignore-rules`, {
      method: "POST",
      body: JSON.stringify({ patterns })
    });
  }
};

// src/lib/config.ts
import { readFileSync, writeFileSync, mkdirSync, existsSync as existsSync2, rmSync, chmodSync } from "node:fs";
import { join as join3 } from "node:path";
var REPO_CONFIG_PATH = [configDirectory, "memory-config.json"];
var DEFAULT_BUDGET = 3e3;
function repoConfigFile(projectDir) {
  return join3(projectDir, ...REPO_CONFIG_PATH);
}
function tokensFile() {
  return join3(pluginDataDir(), "tokens.json");
}
function legacyTokensFile() {
  const dir = legacyPluginDataDir();
  return dir ? join3(dir, "tokens.json") : null;
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
  const legacy = legacyTokensFile();
  const token = readJson(tokensFile())?.[repo.project_id] ?? (legacy ? readJson(legacy)?.[repo.project_id] : void 0);
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

// src/lib/logging.ts
import { mkdirSync as mkdirSync2, appendFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join as join4 } from "node:path";
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
    const full = join4(logsDir, e);
    try {
      if (statSync(full).mtimeMs < cutoff) unlinkSync(full);
    } catch {
    }
  }
}
function createLogger(baseDir) {
  const logsDir = join4(baseDir, "logs");
  try {
    mkdirSync2(logsDir, { recursive: true });
  } catch {
  }
  pruneOldLogs(logsDir);
  function write(level, event, fields) {
    const line = JSON.stringify({ time: (/* @__PURE__ */ new Date()).toISOString(), level, event, ...fields ?? {} }) + "\n";
    const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    try {
      appendFileSync(join4(logsDir, `${today}.log`), line, { encoding: "utf8" });
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

// src/commands/search.ts
async function runSearch(input) {
  if (!input.query) return { ok: false, error: "Missing query. Usage: /memory-search <query>" };
  try {
    const linked = await loadLinkedProject(input.projectDir);
    if (!linked) throw new NotLinkedError();
    const client = new MemoryApiClient(linked.server, linked.token);
    const { entries } = await client.search({ query: input.query, limit: input.limit ?? 10 });
    return { ok: true, output: formatEntries(entries) };
  } catch (e) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}
function formatEntries(entries) {
  if (entries.length === 0) return "(no matches)";
  return entries.map((e) => {
    const excerpt = e.content.length > 200 ? e.content.slice(0, 200) + "\u2026" : e.content;
    const tags = e.tags && e.tags.length ? ` [${e.tags.join(", ")}]` : "";
    return `- ${e.id} (${e.category}${tags}) ${e.authorEmail}: ${excerpt}`;
  }).join("\n");
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const log = createLogger(pluginDataDir());
  log.info("command.search.invoked");
  const query = process.argv.slice(2).join(" ");
  const projectDir = resolveProjectDir();
  runSearch({ projectDir, query }).then((r) => {
    log.info(r.ok ? "command.search.ok" : "command.search.error", { error: r.error });
    if (r.ok) {
      console.log(r.output);
      process.exit(0);
    }
    console.error(r.error);
    process.exit(1);
  }).catch((e) => {
    log.error("command.search.error", { error: e?.message ?? String(e) });
    console.error(e?.message ?? String(e));
    process.exit(1);
  });
}
export {
  runSearch
};
