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
    super("not_linked", "Repo not linked. Run /memory-link <project-id> <token> first.");
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
  server;
  token;
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
var DEFAULT_BUDGET = 3e3;
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

// src/git.ts
import { execFileSync } from "node:child_process";
function readGitIdentity(projectDir) {
  const email = gitConfig(projectDir, "user.email");
  if (!email) return null;
  const name = gitConfig(projectDir, "user.name");
  return { email, name };
}
function gitConfig(projectDir, key) {
  try {
    const out = execFileSync("git", ["config", "--local", "--get", key], {
      cwd: projectDir,
      encoding: "utf8"
    });
    const v = out.trim();
    return v.length > 0 ? v : null;
  } catch {
    return null;
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

// src/commands/write.ts
async function runWrite(input) {
  if (!input.content || !input.content.trim()) {
    return { ok: false, error: "Missing content. Usage: /memory-write <content>" };
  }
  try {
    const linked = await loadLinkedProject(input.projectDir);
    if (!linked) throw new NotLinkedError();
    const identity = readGitIdentity(input.projectDir);
    if (!identity) {
      throw new PluginError("missing_git_identity", "Missing git identity. Run: git config user.email <you@example.com>");
    }
    const client = new MemoryApiClient(linked.server, linked.token);
    const { entry } = await client.createEntry({
      category: "decision",
      source: "manual",
      content: input.content,
      authorEmail: identity.email,
      authorName: identity.name ?? void 0,
      status: "approved"
    });
    return { ok: true, output: `Wrote approved entry ${entry.id}.` };
  } catch (e) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const log = createLogger(process.env.CLAUDE_PLUGIN_DATA ?? "/tmp");
  log.info("command.write.invoked");
  const content = process.argv.slice(2).join(" ");
  const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  runWrite({ projectDir, content }).then((r) => {
    log.info(r.ok ? "command.write.ok" : "command.write.error", { error: r.error });
    if (r.ok) {
      console.log(r.output);
      process.exit(0);
    }
    console.error(r.error);
    process.exit(1);
  }).catch((e) => {
    log.error("command.write.error", { error: e?.message ?? String(e) });
    console.error(e?.message ?? String(e));
    process.exit(1);
  });
}
export {
  runWrite
};
