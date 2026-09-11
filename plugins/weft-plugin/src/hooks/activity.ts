import { readFileSync } from "node:fs";
import { loadLinkedProject } from "../lib/config.js";
import { enqueueActivity, flushActivity, type ActivityEvent } from "../lib/activity.js";
import { createLogger } from "../lib/logging.js";
import { pluginDataDir } from "../lib/data-dir.js";

async function main() {
  const event = JSON.parse(readFileSync(0, "utf8")) as ActivityEvent;
  const projectDir = process.env.CLAUDE_PROJECT_DIR || event.cwd;
  if (!projectDir) return;
  const linked = await loadLinkedProject(projectDir);
  if (!linked) return;
  // SessionStart retries the outbox; other registered events are retained centrally.
  if (event.hook_event_name !== "SessionStart") enqueueActivity(projectDir, linked, event);
  await flushActivity(projectDir, linked);
}
main().catch(() => {
  // Keep credentials and request/response bodies out of logs. The outbox survives errors.
  createLogger(pluginDataDir()).warn("activity.upload_pending", { reason: "capture or upload failed; retry on next activity" });
  process.stderr.write("[weft] Activity sync incomplete; queued activity will retry on the next event or session.\n");
});
