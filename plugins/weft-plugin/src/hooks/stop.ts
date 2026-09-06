import { readFileSync } from "node:fs";
import { isAbsolute, relative } from "node:path";
import { loadLinkedProject } from "../lib/config.js";
import { repoHash } from "../lib/repo-hash.js";
import {
  rewriteBuffer, appendRecord,
  bufferPathFor, BufferRecord,
} from "../lib/buffer.js";
import { existsSync } from "node:fs";
import { applyChain } from "../lib/redaction.js";
import { loadIgnoreMatcher } from "../lib/ignore.js";
import { createLogger } from "../lib/logging.js";

const log = createLogger(process.env.CLAUDE_PLUGIN_DATA ?? "/tmp");

interface HookInput { session_id?: string }

function readStdin(): string {
  try { return readFileSync(0, "utf8"); } catch { return ""; }
}

function readAllRecords(repoHashStr: string): BufferRecord[] {
  const path = bufferPathFor(repoHashStr);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => {
    try { return JSON.parse(l) as BufferRecord; } catch { return null; }
  }).filter((r): r is BufferRecord => r !== null);
}

function topDir(p: string): string {
  const i = p.indexOf("/");
  return i < 0 ? "(root)" : p.slice(0, i);
}

async function main() {
  const projectDir = process.env.CLAUDE_PROJECT_DIR;
  if (!projectDir) { process.exit(0); }

  const linked = await loadLinkedProject(projectDir);
  if (!linked) { process.exit(0); }

  const input: HookInput = (() => { try { return JSON.parse(readStdin()); } catch { return {}; } })();
  const sessionId = input.session_id ?? "unknown";
  const hash = repoHash(projectDir);

  const allRecords = readAllRecords(hash);
  const edits = allRecords.filter((r): r is Extract<BufferRecord, { kind: "edit" }> =>
    r.kind === "edit" && r.session_id === sessionId);

  // Defensive cleanup: drop this session's edits regardless of flag.
  if (edits.length === 0) {
    process.exit(0);
  }

  const others = allRecords.filter((r) => !(r.kind === "edit" && r.session_id === sessionId));

  if (!linked.captureFileEdits) {
    await rewriteBuffer(hash, others);
    log.info("hook.stop.cleared_disabled", { dropped: edits.length });
    process.exit(0);
  }

  // Roll up. Buffers written before paths were normalised still hold absolute
  // ones, and the ignore matcher throws on those — normalise defensively.
  const paths = Array.from(
    new Set(edits.map((e) => (isAbsolute(e.path) ? relative(projectDir, e.path) : e.path))),
  );
  const dirCounts = new Map<string, number>();
  for (const p of paths) {
    const d = topDir(p);
    dirCounts.set(d, (dirCounts.get(d) ?? 0) + 1);
  }
  const topDirs = [...dirCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([d, n]) => `${d} (${n})`).join(", ");
  const fileSummary = paths.length <= 15
    ? paths.join(", ")
    : `${paths.slice(0, 15).join(", ")}, …`;
  const content =
    `Edited ${paths.length} files across ${dirCounts.size} directories: ${topDirs}.\n` +
    `Files: ${fileSummary}.`;

  const ig = loadIgnoreMatcher(projectDir);
  const out = applyChain(content, { ignoreMatcher: ig, referencedPaths: paths });

  await rewriteBuffer(hash, others);

  if (out.dropped) {
    log.info("hook.stop.dropped", { reason: "all_paths_ignored" });
    process.exit(0);
  }

  const id = "buf_" + Math.random().toString(36).slice(2, 18).padEnd(16, "0");
  await appendRecord(hash, {
    kind: "candidate",
    id,
    session_id: sessionId,
    category: "active-work",
    source: "file-change",
    content: out.content,
    tags: ["file-change"],
    namespace: null,
    redactionApplied: out.flagged,
    ts: new Date().toISOString(),
  });
  log.info("hook.stop.rolled_up", { id, paths: paths.length });
  process.exit(0);
}

main().catch((e) => {
  log.error("hook.stop.uncaught", { error: e?.message ?? String(e) });
  process.exit(0);
});
