import { createHash } from "node:crypto";
import { lstatSync, readFileSync, mkdirSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import type { LinkedProject } from "./config.js";
import { MemoryApiClient } from "./api-client.js";
import { pluginDataDir } from "./data-dir.js";
import { loadIgnoreMatcher } from "./ignore.js";
import { secretRegexFilter } from "./redaction.js";

export function readGuidance(projectDir: string, token: string) {
  const matcher = loadIgnoreMatcher(projectDir);
  return ["CLAUDE.md", "AGENTS.md"].map((filename) => {
    const path = join(projectDir, filename);
    let content: string | null = null;
    if (!matcher.isIgnored(filename)) {
      try {
        const stat = lstatSync(path);
        if (stat.isFile() && !stat.isSymbolicLink() && stat.size <= 32000) {
          content = secretRegexFilter(readFileSync(path, "utf8").split(token).join("[REDACTED]"), { ignoreMatcher: matcher, referencedPaths: [filename] }).content;
        }
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    return { filename, content };
  });
}

export async function syncGuidance(projectDir: string, linked: LinkedProject, repository: { remoteUrl: string; label: string }, deadline: number) {
  const files = readGuidance(projectDir, linked.token);
  const key = createHash("sha256").update(JSON.stringify([linked.server, linked.projectId, repository.remoteUrl])).digest("hex");
  const hash = createHash("sha256").update(JSON.stringify(files)).digest("hex");
  const dir = join(pluginDataDir(), "guidance");
  const path = join(dir, `${key}.json`);
  let prior: { hash?: string; syncedAt?: number } = {};
  try { prior = JSON.parse(readFileSync(path, "utf8")); } catch { /* No successful sync yet. */ }
  if (prior.hash === hash && Date.now() - (prior.syncedAt ?? 0) < 3600000) return;
  if (!prior.hash && files.every((file) => file.content === null)) return;
  const client = new MemoryApiClient(linked.server, linked.token, { timeoutMs: 1200, deadline });
  const capabilities = await client.activityCapabilities();
  if (!capabilities.guidanceSchemaVersions?.includes(1)) return;
  const { repo } = await client.linkRepository(linked.projectId, repository.remoteUrl, repository.label);
  await client.syncGuidance(repo.id, files);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify({ hash, syncedAt: Date.now() }), { mode: 0o600 });
  renameSync(temp, path);
}
