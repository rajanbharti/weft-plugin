import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, chmodSync } from "node:fs";
import { join } from "node:path";

export interface LinkedProject {
  projectId: string;
  token: string;
  server: string;
  primingTokenBudget: number;
  captureFileEdits: boolean;
  gitCommitMinMessageChars: number;
}

export interface RepoConfig {
  project_id: string;
  server: string;
  priming_token_budget?: number;
  capture_file_edits?: boolean;
  git_commit_min_message_chars?: number;
}

const REPO_CONFIG_PATH = [".claude", "memory-config.json"] as const;
const DEFAULT_BUDGET = 3000;

function repoConfigFile(projectDir: string): string {
  return join(projectDir, ...REPO_CONFIG_PATH);
}

function pluginDataDir(): string {
  const dir = process.env.CLAUDE_PLUGIN_DATA;
  if (!dir) throw new Error("CLAUDE_PLUGIN_DATA env var not set");
  return dir;
}

function tokensFile(): string {
  return join(pluginDataDir(), "tokens.json");
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function writeJson(path: string, data: unknown, mode?: number): void {
  const dir = path.slice(0, path.lastIndexOf("/"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf8");
  if (mode !== undefined) chmodSync(path, mode);
}

export async function loadLinkedProject(projectDir: string): Promise<LinkedProject | null> {
  const repo = readJson<RepoConfig>(repoConfigFile(projectDir));
  if (!repo || !repo.project_id || !repo.server) return null;

  const tokens = readJson<Record<string, string>>(tokensFile()) ?? {};
  const token = tokens[repo.project_id];
  if (!token) return null;

  return {
    projectId: repo.project_id,
    token,
    server: repo.server,
    primingTokenBudget: repo.priming_token_budget ?? DEFAULT_BUDGET,
    captureFileEdits: repo.capture_file_edits ?? false,
    gitCommitMinMessageChars: repo.git_commit_min_message_chars ?? 12,
  };
}

export async function saveRepoConfig(projectDir: string, cfg: RepoConfig): Promise<void> {
  writeJson(repoConfigFile(projectDir), cfg);
}

export async function clearRepoConfig(projectDir: string): Promise<void> {
  const p = repoConfigFile(projectDir);
  if (existsSync(p)) rmSync(p);
}

export async function saveToken(projectId: string, token: string): Promise<void> {
  const f = tokensFile();
  const tokens = readJson<Record<string, string>>(f) ?? {};
  tokens[projectId] = token;
  writeJson(f, tokens, 0o600);
}

export async function clearToken(projectId: string): Promise<void> {
  const f = tokensFile();
  const tokens = readJson<Record<string, string>>(f) ?? {};
  if (projectId in tokens) {
    delete tokens[projectId];
    writeJson(f, tokens, 0o600);
  }
}
