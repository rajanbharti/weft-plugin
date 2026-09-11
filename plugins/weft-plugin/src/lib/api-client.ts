import { NetworkError, TokenInvalidError, UnexpectedStatusError, InsecureServerError } from "./errors.js";

export interface Entry {
  id: string;
  projectId?: string;
  repoId?: string | null;
  authorEmail: string;
  authorName?: string | null;
  category: "decision" | "active-work" | "codebase" | "cross-team";
  status: "pending" | "approved" | "archived";
  source: "manual" | "claude-proposed" | "git-commit" | "file-change";
  content: string;
  namespace?: string | null;
  tags?: string[];
  pinned: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface SearchFilters {
  tags?: string[];
  namespace?: string;
  category?: Entry["category"];
  repoId?: string;
}

export interface SearchInput { query: string; filters?: SearchFilters; limit?: number }

export interface CreateEntryInput {
  redactionApplied?: boolean;
  category: Entry["category"];
  source: Entry["source"];
  content: string;
  tags?: string[];
  namespace?: string;
  authorEmail: string;
  authorName?: string;
  status?: Entry["status"];
  repoId?: string;
}

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

export function assertAllowedServer(server: string): void {
  let parsed: URL;
  try {
    parsed = new URL(server);
  } catch {
    return; // Let downstream fail with a more relevant error
  }
  if (parsed.protocol === "http:" && !LOCAL_HOSTNAMES.has(parsed.hostname)) {
    throw new InsecureServerError(server);
  }
}

export interface RawActivityEvent {
  clientEventId: string;
  provider: "claude";
  instanceId: string;
  repositoryId: string;
  sessionId: string;
  eventType: "prompt.submitted" | "tool.completed" | "tool.failed" | "turn.completed" | "subagent.completed" | "session.ended";
  occurredAt: string;
  toolCallId?: string;
  actor?: { email: string; name?: string };
  payload: Record<string, unknown>;
  redactionApplied: boolean;
  truncated: boolean;
}

export type ActivityAcknowledgement = { index: number; clientEventId: string | null } & (
  { status: "accepted" | "duplicate"; id: string; sequence: number } |
  { status: "rejected"; reason: string }
);

export interface ApiClientOptions { timeoutMs?: number }

export class MemoryApiClient {
  private readonly timeoutMs: number;

  constructor(private readonly server: string, private readonly token: string, opts: ApiClientOptions = {}) {
    assertAllowedServer(server);
    this.timeoutMs = opts.timeoutMs ?? 10_000;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let res: Response;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      res = await fetch(`${this.server}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          ...(init.headers ?? {}),
          "authorization": `Bearer ${this.token}`,
          "content-type": "application/json",
        },
      });
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        throw new NetworkError(`timeout after ${this.timeoutMs / 1000}s`);
      }
      throw new NetworkError((e as Error).message);
    } finally {
      clearTimeout(timeout);
    }
    if (res.status === 401) throw new TokenInvalidError();
    if (!res.ok) {
      const body = await res.text();
      throw new UnexpectedStatusError(res.status, body);
    }
    return (await res.json()) as T;
  }

  activityCapabilities() {
    return this.request<{ schemaVersions: number[]; maxBatchEvents: number; maxPayloadBytes: number }>("/v1/activity/capabilities");
  }

  ingestActivity(events: RawActivityEvent[]) {
    return this.request<{ schemaVersion: number; acknowledgements: ActivityAcknowledgement[] }>("/v1/activity/events", {
      method: "POST", body: JSON.stringify({ schemaVersion: 1, events }),
    });
  }

  linkRepository(projectId: string, remoteUrl: string, label: string) {
    return this.request<{ repo: { id: string } }>(`/v1/projects/${projectId}/link`, {
      method: "POST", body: JSON.stringify({ remoteUrl, label }),
    });
  }

  listRecent(params?: { limit?: number; since?: string }) {
    const q = new URLSearchParams();
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.since) q.set("since", params.since);
    const suffix = q.toString() ? `?${q.toString()}` : "";
    return this.request<{ entries: Entry[] }>(`/v1/entries/recent${suffix}`);
  }

  listPinned() {
    return this.request<{ entries: Entry[] }>("/v1/entries/pinned");
  }

  search(body: SearchInput) {
    return this.request<{ entries: Entry[] }>("/v1/entries/search", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  createEntry(body: CreateEntryInput) {
    return this.request<{ entry: Entry }>("/v1/entries", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  pinEntry(entryId: string, pinned = true) {
    return this.request<{ entry: Entry }>(`/v1/entries/${entryId}/pin`, {
      method: "POST",
      body: JSON.stringify({ pinned }),
    });
  }

  pushIgnoreRules(projectId: string, patterns: string[]) {
    return this.request<{ ok: true }>(`/v1/projects/${projectId}/ignore-rules`, {
      method: "POST",
      body: JSON.stringify({ patterns }),
    });
  }
}
