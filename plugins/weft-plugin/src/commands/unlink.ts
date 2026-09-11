import { pluginDataDir } from "../lib/data-dir.js";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { clearRepoConfig, clearToken } from "../lib/config.js";
import { createLogger } from "../lib/logging.js";

export interface UnlinkInput { projectDir: string }
export interface UnlinkResult { ok: boolean; removedProjectId?: string; error?: string }

export async function runUnlink(input: UnlinkInput): Promise<UnlinkResult> {
  const cfgPath = join(input.projectDir, ".claude", "memory-config.json");
  if (!existsSync(cfgPath)) {
    return { ok: false, error: "This repo is not linked to any project memory." };
  }
  let projectId: string | undefined;
  try {
    projectId = JSON.parse(readFileSync(cfgPath, "utf8"))?.project_id;
  } catch {
    // malformed file — still remove it
  }
  if (projectId) await clearToken(projectId);
  await clearRepoConfig(input.projectDir);
  return { ok: true, removedProjectId: projectId };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const log = createLogger(pluginDataDir());
  log.info("command.unlink.invoked");
  const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  runUnlink({ projectDir }).then((r) => {
    log.info(r.ok ? "command.unlink.ok" : "command.unlink.error", { error: r.error });
    if (r.ok) { console.log(r.removedProjectId ? `Unlinked ${r.removedProjectId}.` : "Unlinked."); process.exit(0); }
    console.error(r.error); process.exit(1);
  }).catch((e: any) => {
    log.error("command.unlink.error", { error: e?.message ?? String(e) });
    console.error(e?.message ?? String(e));
    process.exit(1);
  });
}
