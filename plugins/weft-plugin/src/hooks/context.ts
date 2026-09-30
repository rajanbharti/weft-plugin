import { readFileSync } from "node:fs";
import { loadLinkedProject } from "../lib/config.js";
import { refreshContext } from "../lib/context.js";
import { safeError } from "../codex/diagnostics.js";
async function main() {
  const event=JSON.parse(readFileSync(0,"utf8"));
  const linked=await loadLinkedProject(process.cwd());
  if(linked) await refreshContext(linked,event);
}
main().catch(e=>process.stderr.write(`[weft] context refresh unavailable: ${safeError(e).code}\n`));
