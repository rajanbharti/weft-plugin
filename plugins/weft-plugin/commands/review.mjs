// src/lib/data-dir.ts
import { homedir } from "node:os";
import { join } from "node:path";
function pluginDataDir() {
  return process.env.CLAUDE_PLUGIN_DATA?.trim() || join(process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), ".claude"), "plugins", "data", "weft-plugin");
}

// src/commands/review.ts
import { writeFileSync as writeFileSync3, readFileSync as readFileSync3, mkdtempSync, rmSync as rmSync2 } from "node:fs";
import { tmpdir } from "node:os";
import { join as join5 } from "node:path";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

// src/lib/config.ts
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, chmodSync } from "node:fs";
import { join as join2 } from "node:path";
var REPO_CONFIG_PATH = [".claude", "memory-config.json"];
var DEFAULT_BUDGET = 3e3;
function repoConfigFile(projectDir) {
  return join2(projectDir, ...REPO_CONFIG_PATH);
}
function tokensFile() {
  return join2(pluginDataDir(), "tokens.json");
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

// src/lib/repo-hash.ts
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
function repoHash(absolutePath) {
  const real = (() => {
    try {
      return realpathSync(absolutePath);
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
import { join as join3 } from "node:path";
function bufferPathFor(repoHash2) {
  return join3(pluginDataDir(), "buffers", `${repoHash2}.jsonl`);
}
function readAllRecords(repoHash2) {
  const path = bufferPathFor(repoHash2);
  if (!existsSync2(path)) return [];
  const lines = readFileSync2(path, "utf8").split("\n");
  const out = [];
  for (const l of lines) {
    if (!l.trim()) continue;
    try {
      out.push(JSON.parse(l));
    } catch {
    }
  }
  return out;
}
async function readAllCandidates(repoHash2) {
  return readAllRecords(repoHash2).filter((r) => r.kind === "candidate");
}
async function rewriteBuffer(repoHash2, keep) {
  const path = bufferPathFor(repoHash2);
  mkdirSync2(join3(pluginDataDir(), "buffers"), { recursive: true });
  const tmp = path + ".tmp";
  const body = keep.map((r) => JSON.stringify(r)).join("\n") + (keep.length ? "\n" : "");
  writeFileSync2(tmp, body, "utf8");
  renameSync(tmp, path);
}

// src/commands/review.ts
import { existsSync as existsSync3, readFileSync as fsRead } from "node:fs";

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
    super("not_linked", "Repo not linked. Run /weft-plugin:memory-link <project-id> <token> first.");
  }
};
var TokenInvalidError = class extends PluginError {
  constructor() {
    super("token_invalid", "Project token is invalid or has been rotated. Run /weft-plugin:memory-link with a fresh token.");
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

// src/lib/logging.ts
import { mkdirSync as mkdirSync3, appendFileSync as appendFileSync2, readdirSync, statSync as statSync2, unlinkSync } from "node:fs";
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
      if (statSync2(full).mtimeMs < cutoff) unlinkSync(full);
    } catch {
    }
  }
}
function createLogger(baseDir) {
  const logsDir = join4(baseDir, "logs");
  try {
    mkdirSync3(logsDir, { recursive: true });
  } catch {
  }
  pruneOldLogs(logsDir);
  function write(level, event, fields) {
    const line = JSON.stringify({ time: (/* @__PURE__ */ new Date()).toISOString(), level, event, ...fields ?? {} }) + "\n";
    const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    try {
      appendFileSync2(join4(logsDir, `${today}.log`), line, { encoding: "utf8" });
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

// src/commands/review.ts
var log = createLogger(pluginDataDir());
function defaultIO() {
  const rl = createInterface({ input, output });
  return {
    write: (s) => process.stdout.write(s),
    nextInput: async () => (await rl.question("")).trim().toLowerCase(),
    edit: async (text) => {
      const editor = process.env.EDITOR || "vim";
      const tmpDir = mkdtempSync(join5(tmpdir(), "memory-review-"));
      const tmpFile = join5(tmpDir, "candidate.txt");
      writeFileSync3(tmpFile, text, "utf8");
      const r = spawnSync(editor, [tmpFile], { stdio: "inherit" });
      if (r.status !== 0) {
        rmSync2(tmpDir, { recursive: true, force: true });
        return text;
      }
      const out = readFileSync3(tmpFile, "utf8");
      rmSync2(tmpDir, { recursive: true, force: true });
      return out;
    }
  };
}
async function runReview(input2) {
  const linked = await loadLinkedProject(input2.projectDir);
  if (!linked) throw new NotLinkedError();
  const id = readGitIdentity(input2.projectDir);
  if (!id) throw new PluginError(
    "missing_git_identity",
    "Set git identity before running /memory-review: git config user.email <you@example.com>"
  );
  const io = input2.io ?? defaultIO();
  const hash = repoHash(input2.projectDir);
  const candidates = (await readAllCandidates(hash)).sort((a, b) => a.ts.localeCompare(b.ts));
  if (candidates.length === 0) {
    io.write("No pending captures. Buffer is empty.\n");
    return { approved: 0, sentPending: 0, dropped: 0, quit: false, remaining: 0 };
  }
  const client = new MemoryApiClient(linked.server, linked.token);
  let approved = 0, sentPending = 0, dropped = 0, quit = false;
  const verdicts = /* @__PURE__ */ new Map();
  const candidateContent = new Map(candidates.map((c) => [c.id, c.content]));
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    let workingContent = candidateContent.get(c.id) ?? c.content;
    while (true) {
      io.write(
        `
[${i + 1}/${candidates.length}] (${c.category}, ${c.source}) ${c.id}
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
${workingContent}
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
[a]pprove  [s]kip-to-pending  [d]rop  [e]dit  [q]uit
> `
      );
      const answer = (await io.nextInput()).trim().toLowerCase();
      const ch = answer.charAt(0);
      if (ch === "a") {
        try {
          await client.createEntry({
            category: c.category,
            source: c.source,
            content: workingContent,
            tags: c.tags,
            namespace: c.namespace ?? void 0,
            authorEmail: id.email,
            authorName: id.name ?? void 0,
            status: "approved"
          });
          verdicts.set(c.id, "approved");
          approved++;
        } catch (e) {
          io.write(`Service unreachable, leaving ${c.id} in buffer: ${e?.message ?? String(e)}
`);
          log.warn("command.memory-review.service_error", { entry: c.id, error: e?.message });
          quit = true;
        }
        break;
      }
      if (ch === "s") {
        try {
          await client.createEntry({
            category: c.category,
            source: c.source,
            content: workingContent,
            tags: c.tags,
            namespace: c.namespace ?? void 0,
            authorEmail: id.email,
            authorName: id.name ?? void 0,
            status: "pending"
          });
          verdicts.set(c.id, "pending");
          sentPending++;
        } catch (e) {
          io.write(`Service unreachable, leaving ${c.id} in buffer: ${e?.message ?? String(e)}
`);
          log.warn("command.memory-review.service_error", { entry: c.id, error: e?.message });
          quit = true;
        }
        break;
      }
      if (ch === "d") {
        verdicts.set(c.id, "dropped");
        dropped++;
        break;
      }
      if (ch === "e") {
        workingContent = await io.edit(workingContent);
        candidateContent.set(c.id, workingContent);
        continue;
      }
      if (ch === "q") {
        quit = true;
        break;
      }
      io.write(`Unknown choice "${ch}". Try a/s/d/e/q.
`);
    }
    if (quit) break;
  }
  const path = bufferPathFor(hash);
  const allRecords = !existsSync3(path) ? [] : fsRead(path, "utf8").split("\n").filter(Boolean).map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  }).filter((r) => r !== null);
  const keep = allRecords.filter((r) => {
    if (r.kind !== "candidate") return true;
    return !verdicts.has(r.id);
  });
  await rewriteBuffer(hash, keep);
  io.write(`Approved ${approved}, sent-to-pending ${sentPending}, dropped ${dropped}. ${candidates.length - verdicts.size} remain in buffer.
`);
  log.info("command.memory-review", { approved, sentPending, dropped, quit, remaining: candidates.length - verdicts.size });
  return { approved, sentPending, dropped, quit, remaining: candidates.length - verdicts.size };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const projectDir = process.cwd();
  log.info("command.memory-review.invoked");
  runReview({ projectDir }).then(() => process.exit(0)).catch((e) => {
    log.error("command.memory-review.error", { error: e?.message ?? String(e) });
    process.stderr.write((e?.message ?? String(e)) + "\n");
    process.exit(1);
  });
}
export {
  runReview
};
