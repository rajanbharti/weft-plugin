import { homedir } from "node:os";
import { join } from "node:path";
import { isCodex } from "./runtime.js";

function claudePluginsDataRoot(): string {
  return join(process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), ".claude"), "plugins", "data");
}

/** Persistent storage outside both the project and the versioned plugin cache. */
export function pluginDataDir(): string {
  // Skills run via the shell and do not necessarily inherit PLUGIN_DATA. Use
  // one stable location for skills, MCP, and hooks rather than split credentials.
  if (isCodex) return process.env.WEFT_CODEX_DATA_DIR?.trim()
    || join(process.env.CODEX_HOME?.trim() || join(homedir(), ".codex"), "plugins", "data", "weft-codex");
  // Claude Code names the directory it gives hooks and MCP `<plugin>-<marketplace>`;
  // the fallback must match it exactly or `/memory-link` saves tokens hooks never see.
  return process.env.CLAUDE_PLUGIN_DATA?.trim() || join(claudePluginsDataRoot(), "weft-plugin-weft");
}

/** Where releases up to 0.5.0 wrote state when CLAUDE_PLUGIN_DATA was unset. */
export function legacyPluginDataDir(): string | null {
  if (isCodex) return null;
  const legacy = join(claudePluginsDataRoot(), "weft-plugin");
  return legacy === pluginDataDir() ? null : legacy;
}
