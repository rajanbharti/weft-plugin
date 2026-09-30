import { homedir } from "node:os";
import { join } from "node:path";
import { isCodex } from "./runtime.js";

/** Persistent storage outside both the project and the versioned plugin cache. */
export function pluginDataDir(): string {
  // Skills run via the shell and do not necessarily inherit PLUGIN_DATA. Use
  // one stable location for skills, MCP, and hooks rather than split credentials.
  if (isCodex) return process.env.WEFT_CODEX_DATA_DIR?.trim()
    || join(process.env.CODEX_HOME?.trim() || join(homedir(), ".codex"), "plugins", "data", "weft-codex");
  return process.env.CLAUDE_PLUGIN_DATA?.trim()
    || join(process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), ".claude"), "plugins", "data", "weft-plugin");
}
