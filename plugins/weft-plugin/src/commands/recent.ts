import { MemoryApiClient, Entry } from "../lib/api-client.js";
import { loadLinkedProject } from "../lib/config.js";
import { NotLinkedError } from "../lib/errors.js";
import { createLogger } from "../lib/logging.js";

export interface RecentInput { projectDir: string; limit?: number }
export interface RecentResult { ok: boolean; output?: string; error?: string }

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export async function runRecent(input: RecentInput): Promise<RecentResult> {
  try {
    const linked = await loadLinkedProject(input.projectDir);
    if (!linked) throw new NotLinkedError();

    const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const client = new MemoryApiClient(linked.server, linked.token);
    const { entries } = await client.listRecent({ limit });
    return { ok: true, output: format(entries) };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

function format(entries: Entry[]): string {
  if (entries.length === 0) return "(no recent entries)";
  return entries
    .map((e) => {
      const excerpt = e.content.length > 160 ? e.content.slice(0, 160) + "…" : e.content;
      const when = e.createdAt ? e.createdAt.slice(0, 10) : "?";
      return `- ${e.id} (${e.category}) ${when}: ${excerpt}`;
    })
    .join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const log = createLogger(process.env.CLAUDE_PLUGIN_DATA ?? "/tmp");
  log.info("command.recent.invoked");
  const limitArg = Number(process.argv[2]);
  const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  runRecent({ projectDir, limit: Number.isFinite(limitArg) ? limitArg : undefined }).then((r) => {
    log.info(r.ok ? "command.recent.ok" : "command.recent.error", { error: r.error });
    if (r.ok) { console.log(r.output); process.exit(0); }
    console.error(r.error); process.exit(1);
  }).catch((e: any) => {
    log.error("command.recent.error", { error: e?.message ?? String(e) });
    console.error(e?.message ?? String(e));
    process.exit(1);
  });
}
