import { pluginDataDir } from "../lib/data-dir.js";
import { readFileSync } from "node:fs";
import { isAbsolute, relative } from "node:path";
import { loadLinkedProject } from "../lib/config.js";
import { repoHash } from "../lib/repo-hash.js";
import { appendRecord, trimIfTooLarge } from "../lib/buffer.js";
import { createLogger } from "../lib/logging.js";

const log = createLogger(pluginDataDir());

interface EditToolInput {
  file_path?: string;
  new_string?: string;
  old_string?: string;
  edits?: Array<{ file_path: string; new_string?: string; old_string?: string }>;
}

interface HookInput {
  session_id?: string;
  tool_name?: string;
  tool_input?: EditToolInput;
}

function readStdin(): string {
  try { return readFileSync(0, "utf8"); } catch { return ""; }
}

function locDelta(newStr: string | undefined, oldStr: string | undefined): number {
  const newLines = newStr ? newStr.split("\n").length : 0;
  const oldLines = oldStr ? oldStr.split("\n").length : 0;
  return Math.abs(newLines - oldLines) || newLines;
}

async function main() {
  const projectDir = process.env.CLAUDE_PROJECT_DIR;
  if (!projectDir) { process.exit(0); }

  const linked = await loadLinkedProject(projectDir);
  if (!linked) { log.info("hook.post-tool-edit.skipped", { reason: "not_linked" }); process.exit(0); }
  if (!linked.captureFileEdits) { log.info("hook.post-tool-edit.skipped", { reason: "disabled" }); process.exit(0); }

  const input: HookInput = (() => { try { return JSON.parse(readStdin()); } catch { return {}; } })();
  const sessionId = input.session_id ?? "unknown";
  const ts = new Date().toISOString();
  const hash = repoHash(projectDir);
  const trimmed = await trimIfTooLarge(hash, 10_000_000);
  if (trimmed) log.warn("hook.post-tool-edit.buffer_trimmed", { hash });

  // Claude Code sends absolute file paths, but the ignore matcher (gitignore
  // semantics) throws on anything that isn't repo-relative — and the Stop hook
  // feeds these paths straight to it. Normalise before buffering.
  const toRepoRelative = (p: string): string =>
    isAbsolute(p) ? relative(projectDir, p) : p;

  const writes: { path: string; loc_delta: number }[] = [];

  if (input.tool_name === "MultiEdit" && Array.isArray(input.tool_input?.edits)) {
    for (const e of input.tool_input!.edits!) {
      if (e.file_path) writes.push({ path: toRepoRelative(e.file_path), loc_delta: locDelta(e.new_string, e.old_string) });
    }
  } else if (input.tool_input?.file_path) {
    writes.push({
      path: toRepoRelative(input.tool_input.file_path),
      loc_delta: locDelta(input.tool_input.new_string, input.tool_input.old_string),
    });
  }

  for (const w of writes) {
    await appendRecord(hash, {
      kind: "edit",
      session_id: sessionId,
      path: w.path,
      loc_delta: w.loc_delta,
      ts,
    });
  }
  log.info("hook.post-tool-edit.appended", { count: writes.length });
  process.exit(0);
}

main().catch((e) => {
  log.error("hook.post-tool-edit.uncaught", { error: e?.message ?? String(e) });
  process.exit(0);
});
