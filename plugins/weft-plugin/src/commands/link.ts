import { pluginDataDir } from "../lib/data-dir.js";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MemoryApiClient, assertAllowedServer } from "../lib/api-client.js";
import { saveRepoConfig, saveToken } from "../lib/config.js";
import { TokenInvalidError, NetworkError, InsecureServerError } from "../lib/errors.js";
import { createLogger } from "../lib/logging.js";

const STARTER_IGNORE = `# Patterns matching paths inside the repo will prevent
# captures referencing those paths from being recorded.
# Same syntax as .gitignore.

*.env
.env.*
.env*.local
secrets/**
credentials/**
.ssh/**
`;

function writeStarterIgnoreIfAbsent(projectDir: string): boolean {
  const f = join(projectDir, ".projectmemoryignore");
  if (existsSync(f)) return false;
  writeFileSync(f, STARTER_IGNORE, "utf8");
  return true;
}

export interface LinkInput {
  projectId: string;
  token: string;
  projectDir: string;
  /** Fallback server URL if the repo has no existing config. */
  defaultServer: string;
}

export interface LinkResult {
  ok: boolean;
  error?: string;
  message?: string;
}

export async function runLink(input: LinkInput): Promise<LinkResult> {
  if (!input.projectId) return { ok: false, error: "Missing <project-id>. Usage: /memory-link <project-id> <token>" };
  if (!input.token) return { ok: false, error: "Missing <token>. Usage: /memory-link <project-id> <token>" };

  const server = input.defaultServer;
  try {
    assertAllowedServer(server);
  } catch (e: any) {
    if (e instanceof InsecureServerError) return { ok: false, error: e.message };
    return { ok: false, error: `Invalid server URL: ${e.message ?? String(e)}` };
  }

  const client = new MemoryApiClient(server, input.token);
  try {
    await client.listRecent({ limit: 1 });
  } catch (e: any) {
    if (e instanceof TokenInvalidError) return { ok: false, error: "Invalid token. Double-check what the project admin shared." };
    if (e instanceof NetworkError) return { ok: false, error: `Could not reach server at ${server}: ${e.message}` };
    return { ok: false, error: `Unexpected error validating token: ${e.message ?? String(e)}` };
  }

  await saveRepoConfig(input.projectDir, { project_id: input.projectId, server });
  await saveToken(input.projectId, input.token);
  const wroteStarter = writeStarterIgnoreIfAbsent(input.projectDir);
  return {
    ok: true,
    message: `Linked ${input.projectId}.${wroteStarter ? " Wrote .projectmemoryignore with sensible defaults — review and commit it." : ""} Memory tools can use this link immediately. Start a new session only to refresh startup memory.`,
  };
}

// CLI entrypoint (invoked by skills/memory-link/SKILL.md)
if (import.meta.url === `file://${process.argv[1]}`) {
  const log = createLogger(pluginDataDir());
  log.info("command.link.invoked");
  const [, , projectId, token] = process.argv;
  const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const defaultServer = "https://service-production-a3ce.up.railway.app";
  runLink({ projectId, token, projectDir, defaultServer }).then((r) => {
    log.info(r.ok ? "command.link.ok" : "command.link.error", { error: r.error });
    if (r.ok) { console.log(r.message); process.exit(0); }
    console.error(r.error); process.exit(1);
  }).catch((e: any) => {
    log.error("command.link.error", { error: e?.message ?? String(e) });
    console.error(e?.message ?? String(e));
    process.exit(1);
  });
}
