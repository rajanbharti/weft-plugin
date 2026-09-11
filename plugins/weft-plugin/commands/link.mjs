// src/commands/link.ts
import { existsSync as existsSync2, writeFileSync as writeFileSync2 } from "node:fs";
import { join as join3 } from "node:path";

// src/lib/errors.ts
var PluginError = class extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "PluginError";
  }
};
var TokenInvalidError = class extends PluginError {
  constructor() {
    super("token_invalid", "Project token is invalid or has been rotated. Run /memory-link with a fresh token.");
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
  }
  timeoutMs;
  async request(path, init = {}) {
    let res;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
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
    } catch (e) {
      if (e.name === "AbortError") {
        throw new NetworkError(`timeout after ${this.timeoutMs / 1e3}s`);
      }
      throw new NetworkError(e.message);
    } finally {
      clearTimeout(timeout);
    }
    if (res.status === 401) throw new TokenInvalidError();
    if (!res.ok) {
      const body = await res.text();
      throw new UnexpectedStatusError(res.status, body);
    }
    return await res.json();
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
async function saveRepoConfig(projectDir, cfg) {
  writeJson(repoConfigFile(projectDir), cfg);
}
async function saveToken(projectId, token) {
  const f = tokensFile();
  const tokens = readJson(f) ?? {};
  tokens[projectId] = token;
  writeJson(f, tokens, 384);
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

// src/commands/link.ts
var STARTER_IGNORE = `# Patterns matching paths inside the repo will prevent
# captures referencing those paths from being recorded.
# Same syntax as .gitignore.

*.env
.env.*
.env*.local
secrets/**
credentials/**
.ssh/**
`;
function writeStarterIgnoreIfAbsent(projectDir) {
  const f = join3(projectDir, ".projectmemoryignore");
  if (existsSync2(f)) return false;
  writeFileSync2(f, STARTER_IGNORE, "utf8");
  return true;
}
async function runLink(input) {
  if (!input.projectId) return { ok: false, error: "Missing <project-id>. Usage: /memory-link <project-id> <token>" };
  if (!input.token) return { ok: false, error: "Missing <token>. Usage: /memory-link <project-id> <token>" };
  const server = input.defaultServer;
  try {
    assertAllowedServer(server);
  } catch (e) {
    if (e instanceof InsecureServerError) return { ok: false, error: e.message };
    return { ok: false, error: `Invalid server URL: ${e.message ?? String(e)}` };
  }
  const client = new MemoryApiClient(server, input.token);
  try {
    await client.listRecent({ limit: 1 });
  } catch (e) {
    if (e instanceof TokenInvalidError) return { ok: false, error: "Invalid token. Double-check what the project admin shared." };
    if (e instanceof NetworkError) return { ok: false, error: `Could not reach server at ${server}: ${e.message}` };
    return { ok: false, error: `Unexpected error validating token: ${e.message ?? String(e)}` };
  }
  await saveRepoConfig(input.projectDir, { project_id: input.projectId, server });
  await saveToken(input.projectId, input.token);
  const wroteStarter = writeStarterIgnoreIfAbsent(input.projectDir);
  return {
    ok: true,
    message: `Linked ${input.projectId}.${wroteStarter ? " Wrote .projectmemoryignore with sensible defaults \u2014 review and commit it." : ""} Start a new Claude Code session to see primed project memory.`
  };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const log = createLogger(process.env.CLAUDE_PLUGIN_DATA ?? "/tmp");
  log.info("command.link.invoked");
  const [, , projectId, token] = process.argv;
  const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const defaultServer = "https://service-production-a3ce.up.railway.app";
  runLink({ projectId, token, projectDir, defaultServer }).then((r) => {
    log.info(r.ok ? "command.link.ok" : "command.link.error", { error: r.error });
    if (r.ok) {
      console.log(r.message);
      process.exit(0);
    }
    console.error(r.error);
    process.exit(1);
  }).catch((e) => {
    log.error("command.link.error", { error: e?.message ?? String(e) });
    console.error(e?.message ?? String(e));
    process.exit(1);
  });
}
export {
  runLink
};
