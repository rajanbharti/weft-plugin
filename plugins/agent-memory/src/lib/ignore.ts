import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import ignoreLib from "ignore";

export interface IgnoreMatcher {
  isIgnored(path: string): boolean;
  patterns: string[];
}

const PROJECT_FILE = [".projectmemoryignore"] as const;
const DEV_FILE = [".claude", "memoryignore"] as const;

function readPatterns(filePath: string): string[] {
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
}

/**
 * Expand negation glob patterns to also un-ignore parent directories.
 * The `ignore` library follows strict gitignore semantics: a file inside a
 * directory can only be un-ignored if the directory itself is also un-ignored.
 * e.g. "!docs/public/**" must be accompanied by "!docs/public".
 */
function expandNegations(patterns: string[]): string[] {
  const expanded: string[] = [];
  for (const p of patterns) {
    expanded.push(p);
    if (p.startsWith("!") && (p.endsWith("/**") || p.endsWith("/*"))) {
      const dir = p.slice(1, p.lastIndexOf("/"));
      if (dir) expanded.push("!" + dir);
    }
  }
  return expanded;
}

export function loadIgnoreMatcher(repoDir: string): IgnoreMatcher {
  const projectPatterns = readPatterns(join(repoDir, ...PROJECT_FILE));
  const devPatterns = readPatterns(join(repoDir, ...DEV_FILE));
  const patterns = [...projectPatterns, ...devPatterns];
  const ig = ignoreLib().add(expandNegations(patterns));
  return {
    patterns,
    isIgnored: (path: string) => ig.ignores(path),
  };
}
