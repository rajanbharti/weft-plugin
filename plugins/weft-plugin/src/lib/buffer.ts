import { pluginDataDir } from "./data-dir.js";
import {
  mkdirSync, appendFileSync, readFileSync, writeFileSync, statSync,
  existsSync, renameSync,
} from "node:fs";
import { join } from "node:path";

export interface EditRecord {
  kind: "edit";
  session_id: string;
  path: string;
  loc_delta: number;
  ts: string;
}

export interface CandidateRecord {
  kind: "candidate";
  id: string;
  session_id: string;
  category: "decision" | "active-work" | "codebase" | "cross-team";
  source: "manual" | "claude-proposed" | "git-commit" | "file-change";
  content: string;
  tags: string[];
  namespace: string | null;
  redactionApplied: boolean;
  ts: string;
}

export type BufferRecord = EditRecord | CandidateRecord;


export function bufferPathFor(repoHash: string): string {
  return join(pluginDataDir(), "buffers", `${repoHash}.jsonl`);
}

export async function appendRecord(repoHash: string, record: BufferRecord): Promise<void> {
  const path = bufferPathFor(repoHash);
  mkdirSync(join(pluginDataDir(), "buffers"), { recursive: true });
  appendFileSync(path, JSON.stringify(record) + "\n", "utf8");
}

function readAllRecords(repoHash: string): BufferRecord[] {
  const path = bufferPathFor(repoHash);
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf8").split("\n");
  const out: BufferRecord[] = [];
  for (const l of lines) {
    if (!l.trim()) continue;
    try {
      out.push(JSON.parse(l) as BufferRecord);
    } catch {
      // Skip malformed line.
    }
  }
  return out;
}

export async function readAllCandidates(repoHash: string): Promise<CandidateRecord[]> {
  return readAllRecords(repoHash).filter((r): r is CandidateRecord => r.kind === "candidate");
}

export async function readEditLogsForSession(repoHash: string, sessionId: string): Promise<EditRecord[]> {
  return readAllRecords(repoHash).filter((r): r is EditRecord => r.kind === "edit" && r.session_id === sessionId);
}

export async function rewriteBuffer(repoHash: string, keep: BufferRecord[]): Promise<void> {
  const path = bufferPathFor(repoHash);
  mkdirSync(join(pluginDataDir(), "buffers"), { recursive: true });
  const tmp = path + ".tmp";
  const body = keep.map((r) => JSON.stringify(r)).join("\n") + (keep.length ? "\n" : "");
  writeFileSync(tmp, body, "utf8");
  renameSync(tmp, path);
}

export async function trimIfTooLarge(repoHash: string, maxBytes: number): Promise<boolean> {
  const path = bufferPathFor(repoHash);
  if (!existsSync(path)) return false;
  const size = statSync(path).size;
  if (size <= maxBytes) return false;
  const buf = readFileSync(path);
  const target = 1_000_000;   // keep last 1 MB per spec §7.3/§8
  const tail = buf.subarray(buf.length - target);
  // Drop a possibly-partial first line.
  const nl = tail.indexOf(0x0a);
  const kept = nl >= 0 ? tail.subarray(nl + 1) : tail;
  writeFileSync(path, kept);
  return true;
}
