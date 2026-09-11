import { realpathSync } from "node:fs";
import { dirname, basename, join, relative, isAbsolute } from "node:path";

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
