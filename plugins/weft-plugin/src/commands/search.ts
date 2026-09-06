import { MemoryApiClient, Entry } from "../lib/api-client.js";
import { loadLinkedProject } from "../lib/config.js";
import { NotLinkedError } from "../lib/errors.js";
import { createLogger } from "../lib/logging.js";

export interface SearchInput { projectDir: string; query: string; limit?: number }
export interface SearchResult { ok: boolean; output?: string; error?: string }

export async function runSearch(input: SearchInput): Promise<SearchResult> {
  if (!input.query) return { ok: false, error: "Missing query. Usage: /memory-search <query>" };
  try {
    const linked = await loadLinkedProject(input.projectDir);
    if (!linked) throw new NotLinkedError();
    const client = new MemoryApiClient(linked.server, linked.token);
    const { entries } = await client.search({ query: input.query, limit: input.limit ?? 10 });
    return { ok: true, output: formatEntries(entries) };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

function formatEntries(entries: Entry[]): string {
  if (entries.length === 0) return "(no matches)";
  return entries
    .map((e) => {
      const excerpt = e.content.length > 200 ? e.content.slice(0, 200) + "…" : e.content;
      const tags = e.tags && e.tags.length ? ` [${e.tags.join(", ")}]` : "";
      return `- ${e.id} (${e.category}${tags}) ${e.authorEmail}: ${excerpt}`;
    })
    .join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const log = createLogger(process.env.CLAUDE_PLUGIN_DATA ?? "/tmp");
  log.info("command.search.invoked");
  const query = process.argv.slice(2).join(" ");
  const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  runSearch({ projectDir, query }).then((r) => {
    log.info(r.ok ? "command.search.ok" : "command.search.error", { error: r.error });
    if (r.ok) { console.log(r.output); process.exit(0); }
    console.error(r.error); process.exit(1);
  }).catch((e: any) => {
    log.error("command.search.error", { error: e?.message ?? String(e) });
    console.error(e?.message ?? String(e));
    process.exit(1);
  });
}
