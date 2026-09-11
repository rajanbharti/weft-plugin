import { pluginDataDir } from "../lib/data-dir.js";
import { MemoryApiClient } from "../lib/api-client.js";
import { loadLinkedProject } from "../lib/config.js";
import { NotLinkedError } from "../lib/errors.js";
import { createLogger } from "../lib/logging.js";

export interface PinInput { projectDir: string; entryId: string; pinned?: boolean }
export interface PinResult { ok: boolean; output?: string; error?: string }

export async function runPin(input: PinInput): Promise<PinResult> {
  if (!input.entryId) return { ok: false, error: "Missing <entry-id>. Usage: /memory-pin <entry-id>" };
  try {
    const linked = await loadLinkedProject(input.projectDir);
    if (!linked) throw new NotLinkedError();

    const client = new MemoryApiClient(linked.server, linked.token);
    const { entry } = await client.pinEntry(input.entryId, input.pinned ?? true);
    return { ok: true, output: `Pinned ${entry.id} (pinned=${entry.pinned}).` };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const log = createLogger(pluginDataDir());
  log.info("command.pin.invoked");
  const [, , entryId] = process.argv;
  const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  runPin({ projectDir, entryId }).then((r) => {
    log.info(r.ok ? "command.pin.ok" : "command.pin.error", { error: r.error });
    if (r.ok) { console.log(r.output); process.exit(0); }
    console.error(r.error); process.exit(1);
  }).catch((e: any) => {
    log.error("command.pin.error", { error: e?.message ?? String(e) });
    console.error(e?.message ?? String(e));
    process.exit(1);
  });
}
