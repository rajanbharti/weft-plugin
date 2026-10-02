import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, mkdirSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import type { LinkedProject } from "./config.js";
import { MemoryApiClient } from "./api-client.js";
import { pluginDataDir } from "./data-dir.js";
import { loadIgnoreMatcher } from "./ignore.js";
import { secretRegexFilter } from "./redaction.js";

const ROOT_FILES = ["CLAUDE.md", "AGENTS.md"];
const AGENT_FILES = new Set(["claude.md", "agents.md", "gemini.md", "copilot-instructions.md"]);
const SKIPPED_DIRS = new Set(["node_modules", "dist", "build", "coverage", "vendor", "target"]);
// Mirrors the service: visible segments only, at most one folder deep.
const SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
const MAX_FILES = 40;
const MAX_TOTAL_CHARS = 300000;

type GuidanceFile = { filename: string; content: string | null };

function readOne(projectDir: string, filename: string, token: string, matcher: ReturnType<typeof loadIgnoreMatcher>) {
  if (matcher.isIgnored(filename)) return null;
  try {
    const stat = lstatSync(join(projectDir, filename));
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32000) return null;
    return secretRegexFilter(readFileSync(join(projectDir, filename), "utf8").split(token).join("[REDACTED]"), { ignoreMatcher: matcher, referencedPaths: [filename] }).content;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return null;
  }
}

function markdownIn(projectDir: string, folder: string): string[] {
  let names: string[];
  try { names = readdirSync(join(projectDir, folder)); } catch { return []; }
  return names
    .filter((name) => SEGMENT.test(name) && name.toLowerCase().endsWith(".md"))
    .map((name) => (folder ? `${folder}/${name}` : name));
}

function discover(projectDir: string, matcher: ReturnType<typeof loadIgnoreMatcher>): string[] {
  const found = markdownIn(projectDir, "");
  let entries: string[] = [];
  try { entries = readdirSync(projectDir); } catch { /* Unreadable root: root files only. */ }
  for (const name of entries) {
    if (!SEGMENT.test(name) || SKIPPED_DIRS.has(name) || matcher.isIgnored(`${name}/`)) continue;
    try {
      const stat = lstatSync(join(projectDir, name));
      if (!stat.isDirectory() || stat.isSymbolicLink()) continue;
    } catch { continue; }
    found.push(...markdownIn(projectDir, name));
  }
  found.push(".github/copilot-instructions.md");
  const rank = (filename: string) => {
    const base = filename.split("/").at(-1)!.toLowerCase();
    return [AGENT_FILES.has(base) ? 0 : base === "readme.md" ? 1 : 2, filename.includes("/") ? 1 : 0];
  };
  return found.sort((a, b) => {
    const [ra, rb] = [rank(a), rank(b)];
    return ra[0] - rb[0] || ra[1] - rb[1] || (a < b ? -1 : a > b ? 1 : 0);
  });
}

/** Version 1 reports the two root files (null when absent); version 2 returns the
 * Markdown guidance found at the root and one folder down, agent files first. */
export function readGuidance(projectDir: string, token: string, version: 1 | 2 = 1): GuidanceFile[] {
  const matcher = loadIgnoreMatcher(projectDir);
  if (version === 1) return ROOT_FILES.map((filename) => ({ filename, content: readOne(projectDir, filename, token, matcher) }));
  const files: GuidanceFile[] = [];
  let total = 0;
  for (const filename of discover(projectDir, matcher)) {
    if (files.length >= MAX_FILES) break;
    const content = readOne(projectDir, filename, token, matcher);
    if (content === null || total + content.length > MAX_TOTAL_CHARS) continue;
    files.push({ filename, content });
    total += content.length;
  }
  return files;
}

export async function syncGuidance(projectDir: string, linked: LinkedProject, repository: { remoteUrl: string; label: string }, deadline: number) {
  const found = readGuidance(projectDir, linked.token, 2);
  const key = createHash("sha256").update(JSON.stringify([linked.server, linked.projectId, repository.remoteUrl])).digest("hex");
  const hash = createHash("sha256").update(JSON.stringify(found)).digest("hex");
  const dir = join(pluginDataDir(), "guidance");
  const path = join(dir, `${key}.json`);
  let prior: { hash?: string; syncedAt?: number; filenames?: string[] } = {};
  try { prior = JSON.parse(readFileSync(path, "utf8")); } catch { /* No successful sync yet. */ }
  if (prior.hash === hash && Date.now() - (prior.syncedAt ?? 0) < 3600000) return;
  if (!prior.hash && found.length === 0) return;
  const client = new MemoryApiClient(linked.server, linked.token, { timeoutMs: 1200, deadline });
  const capabilities = await client.activityCapabilities();
  const versions = capabilities.guidanceSchemaVersions ?? [];
  if (!versions.includes(1) && !versions.includes(2)) return;
  let files: GuidanceFile[];
  let filenames: string[];
  if (versions.includes(2)) {
    // Earlier releases synced only the two root files and did not record names.
    const previous = prior.filenames ?? (prior.hash ? ROOT_FILES : []);
    const current = new Set(found.map((file) => file.filename));
    files = [...found, ...previous.filter((name) => !current.has(name)).map((filename) => ({ filename, content: null }))];
    filenames = [...current];
  } else {
    files = readGuidance(projectDir, linked.token, 1);
    filenames = ROOT_FILES;
  }
  const { repo } = await client.linkRepository(linked.projectId, repository.remoteUrl, repository.label);
  await client.syncGuidance(repo.id, files);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify({ hash, syncedAt: Date.now(), filenames }), { mode: 0o600 });
  renameSync(temp, path);
}
