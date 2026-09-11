import { homedir } from "node:os";
import { join } from "node:path";

/** Persistent storage outside both the project and the versioned plugin cache. */
export function pluginDataDir(): string {
  return process.env.CLAUDE_PLUGIN_DATA?.trim()
    || join(process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), ".claude"), "plugins", "data", "weft-plugin");
}
