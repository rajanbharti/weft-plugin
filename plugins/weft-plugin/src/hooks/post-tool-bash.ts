import { pluginDataDir } from "../lib/data-dir.js";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { loadLinkedProject } from "../lib/config.js";
import { repoHash } from "../lib/repo-hash.js";
import { appendRecord, trimIfTooLarge } from "../lib/buffer.js";
import { applyChain } from "../lib/redaction.js";
import { loadIgnoreMatcher } from "../lib/ignore.js";
import { createLogger } from "../lib/logging.js";

const log = createLogger(pluginDataDir());
const TRIVIAL = new Set(["merge", "fix typo"]);

interface HookInput {
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: { command?: string };
  tool_response?: { stdout?: string };
}

function readStdin(): string {
  try { return readFileSync(0, "utf8"); } catch { return ""; }
}

function isCommitCommand(cmd: string): boolean {
  return /(^|\s|&&\s*|\|\|\s*|;\s*)git\s+(?:-c\s+\S+\s+)*commit\b/.test(cmd);
}

function extractCommitMessage(cmd: string, stdout: string | undefined): string {
  const m = cmd.match(/(?:-m\s*|--message[=\s])("(?:\\.|[^"\\])*"|'[^']*'|[^\s'""][^\s]*)/);
  if (m) {
    const raw = m[1];
    if (raw.startsWith('"')) return raw.slice(1, -1).replace(/\\(["\\])/g, "$1");
    if (raw.startsWith("'")) return raw.slice(1, -1);
    return raw;
  }
  if (stdout) {
    const head = stdout.split("\n")[0] ?? "";
    const idx = head.indexOf("] ");
    if (idx >= 0) return head.slice(idx + 2).trim();
  }
  return "";
}

function listChangedPaths(projectDir: string, logger: ReturnType<typeof createLogger>): string[] {
  try {
    const out = execFileSync("git", ["log", "-1", "--name-only", "--pretty=format:", "HEAD"], {
      cwd: projectDir, encoding: "utf8",
    });
    return out.split("\n").map((s) => s.trim()).filter(Boolean);
  } catch (e: any) {
    logger.warn("hook.post-tool-bash.git_log_failed", { error: e?.message ?? String(e) });
    return [];
  }
}

async function main() {
  const projectDir = process.cwd();
  if (!projectDir) { process.exit(0); }

  const linked = await loadLinkedProject(projectDir);
  if (!linked) { log.info("hook.post-tool-bash.skipped", { reason: "not_linked" }); process.exit(0); }

  const input: HookInput = (() => { try { return JSON.parse(readStdin()); } catch { return {}; } })();
  const cmd = input.tool_input?.command ?? "";
  if (input.tool_name !== "Bash" || !isCommitCommand(cmd)) {
    process.exit(0);
  }

  const message = extractCommitMessage(cmd, input.tool_response?.stdout);
  const lower = message.trim().toLowerCase();
  if (message.length < linked.gitCommitMinMessageChars
      || lower.startsWith("wip")
      || lower.startsWith("revert")
      || TRIVIAL.has(lower)) {
    log.info("hook.post-tool-bash.dropped", { reason: "trivial", message: message.slice(0, 64) });
    process.exit(0);
  }

  const paths = listChangedPaths(projectDir, log);
  const pathSummary = paths.length === 0
    ? "(no path data)"
    : paths.length <= 30
      ? paths.join(", ")
      : `${paths.slice(0, 30).join(", ")}, …and ${paths.length - 30} more`;

  const content = `${message}\n\nFiles touched: ${pathSummary}`;

  const ig = loadIgnoreMatcher(projectDir);
  const out = applyChain(content, { ignoreMatcher: ig, referencedPaths: paths });
  if (out.dropped) {
    log.info("hook.post-tool-bash.dropped", { reason: "all_paths_ignored" });
    process.exit(0);
  }

  const id = "buf_" + Math.random().toString(36).slice(2, 18).padEnd(16, "0");
  const hash = repoHash(projectDir);
  const trimmed = await trimIfTooLarge(hash, 10_000_000);
  if (trimmed) log.warn("hook.post-tool-bash.buffer_trimmed", { hash });
  await appendRecord(hash, {
    kind: "candidate",
    id,
    session_id: (input as any).session_id ?? "unknown",
    category: "decision",
    source: "git-commit",
    content: out.content,
    tags: ["git-commit"],
    namespace: null,
    redactionApplied: out.flagged,
    ts: new Date().toISOString(),
  });
  log.info("hook.post-tool-bash.captured", { id, paths: paths.length, flagged: out.flagged });
  process.exit(0);
}

main().catch((e) => {
  log.error("hook.post-tool-bash.uncaught", { error: e?.message ?? String(e) });
  process.exit(0);
});
