import { pluginDataDir } from "../lib/data-dir.js";
import { MemoryApiClient } from "../lib/api-client.js";
import { loadLinkedProject } from "../lib/config.js";
import { readGitIdentity } from "../git.js";
import { NotLinkedError, PluginError } from "../lib/errors.js";
import { createLogger } from "../lib/logging.js";

export interface WriteInput { projectDir: string; content: string }
export interface WriteResult { ok: boolean; output?: string; error?: string }

export async function runWrite(input: WriteInput): Promise<WriteResult> {
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
      authorName: identity.name ?? undefined,
      status: "approved",
    });
    return { ok: true, output: `Wrote approved entry ${entry.id}.` };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const log = createLogger(pluginDataDir());
  log.info("command.write.invoked");
  const content = process.argv.slice(2).join(" ");
  const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  runWrite({ projectDir, content }).then((r) => {
    log.info(r.ok ? "command.write.ok" : "command.write.error", { error: r.error });
    if (r.ok) { console.log(r.output); process.exit(0); }
    console.error(r.error); process.exit(1);
  }).catch((e: any) => {
    log.error("command.write.error", { error: e?.message ?? String(e) });
    console.error(e?.message ?? String(e));
    process.exit(1);
  });
}
