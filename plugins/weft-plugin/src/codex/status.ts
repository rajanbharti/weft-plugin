import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadLinkedProject } from "../lib/config.js";
import { MemoryApiClient } from "../lib/api-client.js";
import { activityQueueDir } from "../lib/activity.js";
import { safeError } from "./diagnostics.js";

async function main() {
  const linked = await loadLinkedProject(process.cwd());
  if (!linked) { console.log(JSON.stringify({ linked: false, reason: "missing_config_or_token" })); process.exitCode = 1; return; }
  const queue = activityQueueDir(process.cwd(), linked);
  const count = (dir: string) => existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith(".json")).length : 0;
  const result: Record<string, unknown> = { linked: true, projectId: linked.projectId,
    queued: count(queue), quarantined: count(join(queue, "quarantine")) };
  const client = new MemoryApiClient(linked.server, linked.token, { timeoutMs: 3000 });
  for (const stage of ["authentication", "capabilities"] as const) {
    try {
      if (stage === "authentication") { await client.listRecent({ limit: 1 }); result[stage] = "ok"; }
      else {
        const caps = await client.activityCapabilities();
        result.contextRefresh = caps.contextSchemaVersions?.includes(1) ? "session_and_task" : "legacy_startup_only";
        result.transport = caps.supportedProviders?.includes("codex") && caps.schemaVersions.includes(1) ? "raw" : "legacy";
      }
    } catch (error) { result[stage] = safeError(error); process.exitCode = 1; }
  }
  console.log(JSON.stringify(result, null, 2));
}
main().catch(error => { console.log(JSON.stringify(safeError(error))); process.exitCode = 1; });
