import { UnexpectedStatusError } from "./errors.js";
import { repoRelativePath } from "./project-path.js";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, statSync, unlinkSync, openSync, closeSync } from "node:fs";
import { join, isAbsolute, basename } from "node:path";
import { pluginDataDir } from "./data-dir.js";
import { repoHash } from "./repo-hash.js";
import { loadIgnoreMatcher } from "./ignore.js";
import { applyChain } from "./redaction.js";
import { MemoryApiClient, type CreateEntryInput, type RawActivityEvent } from "./api-client.js";
import type { LinkedProject } from "./config.js";

interface QueuedActivity {
  queueVersion: 2;
  event: Omit<RawActivityEvent, "repositoryId">;
  repository: { remoteUrl: string; label: string };
  legacyEntry: CreateEntryInput;
  // Pin the transport before the first write so a retry across deployment never
  // sends the same event through both raw and legacy ingestion.
  transport?: "raw" | "legacy";
  repositoryId?: string;
}

const EVENT_TYPES: Record<string, RawActivityEvent["eventType"]> = {
  UserPromptSubmit: "prompt.submitted", PostToolUse: "tool.completed",
  PostToolUseFailure: "tool.failed", Stop: "turn.completed",
  SubagentStop: "subagent.completed", SessionEnd: "session.ended",
};

function repositoryDescriptor(projectDir: string): QueuedActivity["repository"] {
  let remote = "";
  try {
    remote = execFileSync("git", ["remote", "get-url", "origin"], { cwd: projectDir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 1000 }).trim();
    const scp = remote.match(/^(?:[^@/]+@)?([^/:]+):([^/].*)$/);
    const url = new URL(scp ? `https://${scp[1]}/${scp[2]}` : remote);
    if (!["https:", "http:", "ssh:"].includes(url.protocol)) remote = "";
    else remote = `https://${url.hostname.toLowerCase()}${url.pathname.replace(/\.git\/?$/, "").replace(/\/$/, "")}`;
  } catch { remote = ""; }
  return { remoteUrl: remote || `local://${instanceId()}/${repoHash(projectDir)}`, label: basename(projectDir).slice(0, 60) };
}

function saveQueueRecord(file: string, record: QueuedActivity): void {
  writeFileSync(file + ".tmp", JSON.stringify(record), { mode: 0o600 });
  renameSync(file + ".tmp", file);
}

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
  saveQueueRecord(file, {
    queueVersion: 2, repository: repositoryDescriptor(projectDir), legacyEntry: body,
    event: {
      clientEventId: eventId, provider: "claude", instanceId: instanceId(), sessionId: event.session_id ?? "unknown",
      eventType: EVENT_TYPES[label] ?? "tool.completed", occurredAt: timestamp, toolCallId: event.tool_use_id,
      actor: { email: actor.email, name: actor.name }, payload: { content },
      redactionApplied: body.redactionApplied ?? false, truncated: content !== filtered.content || filtered.content.includes("…[truncated]"),
    },
  });
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
      const path = join(dir, file);
      const queued: CreateEntryInput | QueuedActivity = JSON.parse(readFileSync(path, "utf8"));
      const client = new MemoryApiClient(linked.server, linked.token, { timeoutMs: Math.min(5000, remaining) });
      if (!("queueVersion" in queued)) {
        // Old outbox records keep their original endpoint; never reinterpret old
        // truncated entry content as a complete raw event.
        await client.createEntry(queued);
        unlinkSync(path);
        sent++;
        continue;
      }
      if (queued.queueVersion !== 2) throw new Error("unsupported_activity_queue_version");
      if (!queued.transport) {
        try {
          const capabilities = await client.activityCapabilities();
          if (!capabilities.schemaVersions?.includes(1)) throw new Error("unsupported_activity_schema");
          queued.transport = "raw";
        } catch (e) {
          if (!(e instanceof UnexpectedStatusError) || e.status !== 404) throw e;
          queued.transport = "legacy";
        }
        saveQueueRecord(path, queued);
      }
      if (queued.transport === "legacy") {
        await client.createEntry(queued.legacyEntry);
      } else {
        if (!queued.repositoryId) {
          const result = await client.linkRepository(linked.projectId, queued.repository.remoteUrl, queued.repository.label);
          if (!result.repo?.id) throw new Error("invalid_repository_acknowledgement");
          queued.repositoryId = result.repo.id;
          saveQueueRecord(path, queued);
        }
        const response = await client.ingestActivity([{ ...queued.event, repositoryId: queued.repositoryId }]);
        const ack = response.acknowledgements?.[0];
        if (response.schemaVersion !== 1 || response.acknowledgements?.length !== 1 || !ack || ack.index !== 0 || ack.clientEventId !== queued.event.clientEventId) {
          throw new Error("invalid_activity_acknowledgement");
        }
        if (ack.status === "rejected") {
          const quarantine = join(dir, "quarantine");
          mkdirSync(quarantine, { recursive: true, mode: 0o700 });
          writeFileSync(join(quarantine, file + ".reason"), ack.reason, { mode: 0o600 });
          renameSync(path, join(quarantine, file));
          process.stderr.write("[weft] An activity event was rejected and moved to the local outbox quarantine.\n");
          continue;
        }
        if (!["accepted", "duplicate"].includes(ack.status) || !("id" in ack) || !ack.id) throw new Error("invalid_activity_acknowledgement");
      }
      unlinkSync(path);
      sent++;
    }
  } finally {
    unlinkSync(lock);
  }
  return sent;
}
