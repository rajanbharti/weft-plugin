import { writeFileSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { loadLinkedProject } from "../lib/config.js";
import { readGitIdentity } from "../git.js";
import { repoHash } from "../lib/repo-hash.js";
import { readAllCandidates, rewriteBuffer, BufferRecord } from "../lib/buffer.js";
import { existsSync, readFileSync as fsRead } from "node:fs";
import { bufferPathFor } from "../lib/buffer.js";
import { MemoryApiClient } from "../lib/api-client.js";
import { NotLinkedError, PluginError } from "../lib/errors.js";
import { createLogger } from "../lib/logging.js";

const log = createLogger(process.env.CLAUDE_PLUGIN_DATA ?? "/tmp");

export interface ReviewIO {
  write(s: string): void;
  nextInput(): Promise<string>;
  edit(text: string): Promise<string>;
  written?(): string;
}

export interface ReviewInput { projectDir: string; io?: ReviewIO }
export interface ReviewSummary {
  approved: number; sentPending: number; dropped: number; quit: boolean; remaining: number;
}

function defaultIO(): ReviewIO {
  const rl = createInterface({ input, output });
  return {
    write: (s) => process.stdout.write(s),
    nextInput: async () => (await rl.question("")).trim().toLowerCase(),
    edit: async (text) => {
      const editor = process.env.EDITOR || "vim";
      const tmpDir = mkdtempSync(join(tmpdir(), "memory-review-"));
      const tmpFile = join(tmpDir, "candidate.txt");
      writeFileSync(tmpFile, text, "utf8");
      const r = spawnSync(editor, [tmpFile], { stdio: "inherit" });
      if (r.status !== 0) {
        rmSync(tmpDir, { recursive: true, force: true });
        return text;
      }
      const out = readFileSync(tmpFile, "utf8");
      rmSync(tmpDir, { recursive: true, force: true });
      return out;
    },
  };
}

export async function runReview(input: ReviewInput): Promise<ReviewSummary> {
  const linked = await loadLinkedProject(input.projectDir);
  if (!linked) throw new NotLinkedError();

  const id = readGitIdentity(input.projectDir);
  if (!id) throw new PluginError("missing_git_identity",
    "Set git identity before running /memory-review: git config user.email <you@example.com>");

  const io = input.io ?? defaultIO();
  const hash = repoHash(input.projectDir);
  const candidates = (await readAllCandidates(hash)).sort((a, b) => a.ts.localeCompare(b.ts));

  if (candidates.length === 0) {
    io.write("No pending captures. Buffer is empty.\n");
    return { approved: 0, sentPending: 0, dropped: 0, quit: false, remaining: 0 };
  }

  const client = new MemoryApiClient(linked.server, linked.token);
  let approved = 0, sentPending = 0, dropped = 0, quit = false;
  const verdicts = new Map<string, "approved" | "pending" | "dropped">();
  const candidateContent = new Map<string, string>(candidates.map((c) => [c.id, c.content]));

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    let workingContent = candidateContent.get(c.id) ?? c.content;

    while (true) {
      io.write(
        `\n[${i + 1}/${candidates.length}] (${c.category}, ${c.source}) ${c.id}\n` +
        `─────────────────────────────────────────\n` +
        `${workingContent}\n` +
        `─────────────────────────────────────────\n` +
        `[a]pprove  [s]kip-to-pending  [d]rop  [e]dit  [q]uit\n` +
        `> `,
      );
      const answer = (await io.nextInput()).trim().toLowerCase();
      const ch = answer.charAt(0);
      if (ch === "a") {
        try {
          await client.createEntry({
            category: c.category, source: c.source, content: workingContent,
            tags: c.tags, namespace: c.namespace ?? undefined,
            authorEmail: id.email, authorName: id.name ?? undefined,
            status: "approved",
          });
          verdicts.set(c.id, "approved"); approved++;
        } catch (e: any) {
          io.write(`Service unreachable, leaving ${c.id} in buffer: ${e?.message ?? String(e)}\n`);
          log.warn("command.memory-review.service_error", { entry: c.id, error: e?.message });
          quit = true;
        }
        break;
      }
      if (ch === "s") {
        try {
          await client.createEntry({
            category: c.category, source: c.source, content: workingContent,
            tags: c.tags, namespace: c.namespace ?? undefined,
            authorEmail: id.email, authorName: id.name ?? undefined,
            status: "pending",
          });
          verdicts.set(c.id, "pending"); sentPending++;
        } catch (e: any) {
          io.write(`Service unreachable, leaving ${c.id} in buffer: ${e?.message ?? String(e)}\n`);
          log.warn("command.memory-review.service_error", { entry: c.id, error: e?.message });
          quit = true;
        }
        break;
      }
      if (ch === "d") {
        verdicts.set(c.id, "dropped"); dropped++;
        break;
      }
      if (ch === "e") {
        workingContent = await io.edit(workingContent);
        candidateContent.set(c.id, workingContent);
        continue;
      }
      if (ch === "q") {
        quit = true;
        break;
      }
      io.write(`Unknown choice "${ch}". Try a/s/d/e/q.\n`);
    }
    if (quit) break;
  }

  // Rebuild buffer: keep all non-candidate records + any candidate without a verdict.
  const path = bufferPathFor(hash);
  const allRecords: BufferRecord[] = !existsSync(path) ? [] : fsRead(path, "utf8")
    .split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l) as BufferRecord; } catch { return null; } })
    .filter((r): r is BufferRecord => r !== null);

  const keep: BufferRecord[] = allRecords.filter((r) => {
    if (r.kind !== "candidate") return true;
    return !verdicts.has(r.id); // unprocessed (likely after quit)
  });
  await rewriteBuffer(hash, keep);

  io.write(`Approved ${approved}, sent-to-pending ${sentPending}, dropped ${dropped}. ` +
    `${candidates.length - verdicts.size} remain in buffer.\n`);

  log.info("command.memory-review", { approved, sentPending, dropped, quit, remaining: candidates.length - verdicts.size });

  return { approved, sentPending, dropped, quit, remaining: candidates.length - verdicts.size };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  log.info("command.memory-review.invoked");
  runReview({ projectDir }).then(() => process.exit(0)).catch((e: any) => {
    log.error("command.memory-review.error", { error: e?.message ?? String(e) });
    process.stderr.write((e?.message ?? String(e)) + "\n");
    process.exit(1);
  });
}
