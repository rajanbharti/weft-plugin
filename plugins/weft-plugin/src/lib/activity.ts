import { repoRelativePath } from "./project-path.js";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, statSync, unlinkSync, openSync, closeSync } from "node:fs";
import { join, isAbsolute, basename } from "node:path";
import { pluginDataDir } from "./data-dir.js";
import { repoHash } from "./repo-hash.js";
import { loadIgnoreMatcher } from "./ignore.js";
import { applyChain } from "./redaction.js";
import { MemoryApiClient, type CreateEntryInput } from "./api-client.js";
import type { LinkedProject } from "./config.js";

export interface ActivityEvent {
  hook_event_name?: string;
  cwd?: string;
  session_id?: string;
  tool_name?: string;
  tool_use_id?: string;
  tool_input?: unknown;
  tool_response?: unknown;
  prompt?: string;
  last_assistant_message?: string;
  error?: unknown;
  reason?: string;
}

export function activityQueueDir(projectDir: string, linked: LinkedProject): string {
  const target = createHash("sha256").update(`${linked.server}\n${linked.projectId}`).digest("hex").slice(0, 16);
  return join(pluginDataDir(), "outbox", target, repoHash(projectDir));
}

function identity(projectDir: string): { email: string; name?: string } {
  const get = (key: string) => {
    try { return execFileSync("git", ["config", "--get", key], { cwd: projectDir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 1000 }).trim(); }
    catch { return ""; }
  };
  const email = get("user.email");
  return { email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "unattributed@weft.invalid", name: get("user.name").slice(0, 120) || undefined };
}

function instanceId(): string {
  const dir = pluginDataDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, "instance-id");
  try { writeFileSync(file, randomUUID(), { flag: "wx", mode: 0o600 }); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
  return readFileSync(file, "utf8").trim();
}

function safeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(safeValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, val]) => [key,
      /password|secret|token|authorization|cookie|api[_-]?key/i.test(key) ? "[REDACTED]" : safeValue(val),
    ]));
  }
  return value;
}

function referencedPaths(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, val]) =>
    /^(file_path|path|notebook_path)$/.test(key) && typeof val === "string" ? [val] : referencedPaths(val));
}

/** Capture broadly; exclusions remove sensitive payloads, never judge usefulness. */
export function enqueueActivity(projectDir: string, linked: LinkedProject, event: ActivityEvent): string {
  const eventId = randomUUID();
  const timestamp = new Date().toISOString();
  const matcher = loadIgnoreMatcher(projectDir);
  const paths = referencedPaths(event.tool_input);
  const excluded = paths.some((path) => {
    const local = repoRelativePath(projectDir, path);
    return local === ".." || local.startsWith("../") || isAbsolute(local)
      || /(^|\/)(\.env[^/]*|secrets|credentials|\.ssh)(\/|$)/.test(local)
      || (local !== "" && matcher.isIgnored(local));
  });
  // Do not echo Weft retrieval results back into its own memory indefinitely.
  const memoryTool = /(^|__)memory(__|_)/.test(event.tool_name ?? "");
  const payload = excluded || memoryTool
    ? { omitted: excluded ? "excluded file payload" : "memory tool payload" }
    : safeValue({ input: event.tool_input, output: event.tool_response, prompt: event.prompt,
      response: event.last_assistant_message, error: event.error, reason: event.reason });
  const label = event.hook_event_name ?? "activity";
  const text = JSON.stringify({ eventId, timestamp, session: event.session_id ?? "unknown",
    repository: repoHash(projectDir), repositoryName: basename(projectDir), event: label, tool: event.tool_name, toolUseId: event.tool_use_id, payload }, null, 2);
  // Also scrub the actual linked credential, even if its format changes.
  const withoutToken = linked.token ? text.split(linked.token).join("[REDACTED:project-token]") : text;
  const filtered = applyChain(withoutToken, { ignoreMatcher: matcher, referencedPaths: [] });
  const content = filtered.content.length > 16_000 ? filtered.content.slice(0, 15_960) + "\n[activity payload truncated]" : filtered.content;
  const actor = identity(projectDir);
  const body: CreateEntryInput = {
    category: "active-work", source: /^(Edit|Write|MultiEdit)$/.test(event.tool_name ?? "") ? "file-change" : "claude-proposed",
    status: "pending", content, authorEmail: actor.email, authorName: actor.name,
    tags: ["auto-capture", `event:${label}`, `event-id:${eventId}`, `session:${event.session_id ?? "unknown"}`,
      `repo:${repoHash(projectDir)}`, `instance:${instanceId()}`, ...(event.tool_name ? [`tool:${event.tool_name}`] : [])],
    redactionApplied: filtered.flagged || withoutToken !== text || text.includes("[REDACTED]") || excluded || memoryTool,
  };
  const dir = activityQueueDir(projectDir, linked);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, `${Date.now()}-${eventId}.json`);
  writeFileSync(file + ".tmp", JSON.stringify(body), { mode: 0o600 });
  renameSync(file + ".tmp", file);
  return eventId;
}

/** At-least-once delivery. Never delete a queued event before a successful response. */
export async function flushActivity(projectDir: string, linked: LinkedProject, budgetMs = 20_000): Promise<number> {
  const dir = activityQueueDir(projectDir, linked);
  if (!existsSync(dir)) return 0;
  const lock = join(dir, ".upload-lock");
  try {
    if (existsSync(lock) && Date.now() - statSync(lock).mtimeMs > 120_000) unlinkSync(lock);
    const fd = openSync(lock, "wx", 0o600);
    closeSync(fd);
  } catch (e) { if ((e as NodeJS.ErrnoException).code === "EEXIST" || (e as NodeJS.ErrnoException).code === "ENOENT") return 0; throw e; }
  let sent = 0;
  const deadline = Date.now() + budgetMs;
  try {
    for (const file of readdirSync(dir).filter((name) => name.endsWith(".json")).sort()) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const body = JSON.parse(readFileSync(join(dir, file), "utf8")) as CreateEntryInput;
      const client = new MemoryApiClient(linked.server, linked.token, { timeoutMs: Math.min(8000, remaining) });
      await client.createEntry(body);
      unlinkSync(join(dir, file));
      sent++;
    }
  } finally {
    unlinkSync(lock);
  }
  return sent;
}
