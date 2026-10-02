import { existsSync, realpathSync } from "node:fs";
import { configDirectory, isCodex } from "./runtime.js";
import { dirname, basename, join, relative, isAbsolute, resolve } from "node:path";

function canonicalPath(path: string): string {
  try { return realpathSync(path); }
  catch {
    const parent = dirname(path);
    return parent === path ? path : join(canonicalPath(parent), basename(path));
  }
}

/** Normalize symlinked parents even when a newly written file does not exist yet. */
export function repoRelativePath(projectDir: string, path: string): string {
  return isAbsolute(path) ? relative(canonicalPath(projectDir), canonicalPath(path)) : path;
}

function findLinkedRoot(start: string): string | null {
  // Keep the path as given: outbox and repository IDs are keyed on it.
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, configDirectory, "memory-config.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * The repository a hook, command or MCP call acts on. Claude Code's working directory
 * follows `cd` in Bash, so prefer the session's starting directory, then the nearest
 * linked ancestor of the working directory, so capture survives moving into subfolders.
 */
export function resolveProjectDir(): string {
  const sessionRoot = isCodex ? undefined : process.env.CLAUDE_PROJECT_DIR?.trim();
  const cwd = process.cwd();
  return (sessionRoot && findLinkedRoot(sessionRoot)) || findLinkedRoot(cwd) || cwd;
}
