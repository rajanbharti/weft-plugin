import Fastify, { FastifyInstance } from "fastify";

export interface MockFixtures {
  rawActivity?: boolean;
  recent?: unknown[];
  pinned?: unknown[];
  validToken?: string;
}

export interface StoppedMock {
  url: string;
  app: FastifyInstance;
  createdEntries: any[];
  writeStatus: { code: number };
  rawEvents: any[];
  rawControl: { code: number; rejectNext: boolean; loseAck: boolean; capabilityCode: number };
  ignoreRulePushes: Array<{ projectId: string; patterns: string[]; repoId?: string }>;
  stop(): Promise<void>;
}

let counter = 0;
const newId = (prefix: string) => `${prefix}_${(++counter).toString(36)}`;

export async function startMockService(fixtures: MockFixtures = {}): Promise<StoppedMock> {
  const validToken = fixtures.validToken ?? "pmt_test";
  const app = Fastify({ logger: false });
  const createdEntries: any[] = [];
  const writeStatus = { code: 200 };
  const rawEvents: any[] = [];
  const rawControl = { code: 200, rejectNext: false, loseAck: false, capabilityCode: fixtures.rawActivity ? 200 : 404 };
  const ignoreRulePushes: Array<{ projectId: string; patterns: string[]; repoId?: string }> = [];

  app.addHook("preHandler", async (req, reply) => {
    if (req.url === "/healthz") return;
    const header = req.headers.authorization;
    if (header !== `Bearer ${validToken}`) {
      reply.code(401).send({ error: "unauthorized" });
    }
  });

  app.get("/v1/activity/capabilities", async (_, reply) => {
    if (rawControl.capabilityCode !== 200) return reply.code(rawControl.capabilityCode).send({ error: "unavailable" });
    return { schemaVersions: [1], maxBatchEvents: 50, maxPayloadBytes: 64000 };
  });
  app.post("/v1/activity/events", async (req: any, reply) => {
    if (rawControl.code !== 200) return reply.code(rawControl.code).send({ error: "unavailable" });
    const acknowledgements = req.body.events.map((event: any, index: number) => {
      if (rawControl.rejectNext) {
        rawControl.rejectNext = false;
        return { index, clientEventId: event.clientEventId, status: "rejected", reason: "invalid_event" };
      }
      const existing = rawEvents.find(e => e.clientEventId === event.clientEventId);
      if (!existing) rawEvents.push(event);
      return { index, clientEventId: event.clientEventId, status: existing ? "duplicate" : "accepted", id: event.clientEventId, sequence: rawEvents.length };
    });
    if (rawControl.loseAck) {
      rawControl.loseAck = false;
      return reply.code(503).send({ error: "lost_ack" });
    }
    return { schemaVersion: 1, acknowledgements };
  });

  app.get("/healthz", async () => ({ ok: true }));

  app.get("/v1/entries/recent", async () => ({ entries: fixtures.recent ?? [] }));
  app.get("/v1/entries/pinned", async () => ({ entries: fixtures.pinned ?? [] }));

  app.post("/v1/entries/search", async (req: any) => ({
    entries: (fixtures.recent ?? []).slice(0, req.body?.limit ?? 10),
  }));

  app.post("/v1/entries", async (req: any, reply) => {
    if (writeStatus.code !== 200) return reply.code(writeStatus.code).send({ error: "unavailable" });
    createdEntries.push(req.body);
    return { entry: { id: newId("entry"), pinned: false, ...(req.body ?? {}) } };
  });

  app.post("/v1/entries/:id/pin", async (req: any) => ({
    entry: { id: req.params.id, pinned: req.body?.pinned ?? true },
  }));

  app.post("/v1/projects/:id/link", async (req: any) => ({
    repo: { id: newId("repo"), projectId: req.params.id, remoteUrl: req.body.remoteUrl, label: req.body.label },
  }));

  app.post("/v1/projects/:id/ignore-rules", async (req: any) => {
    ignoreRulePushes.push({ projectId: req.params.id, patterns: req.body.patterns, repoId: req.body.repoId });
    return { ok: true };
  });

  app.get("/v1/projects/:id/ignore-rules", async (req: any) => ({
    patterns: ignoreRulePushes.filter((p) => p.projectId === req.params.id).flatMap((p) => p.patterns),
  }));

  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("bad address");
  return {
    url: `http://127.0.0.1:${address.port}`,
    app,
    ignoreRulePushes,
    createdEntries,
    writeStatus,
    rawEvents,
    rawControl,
    async stop() { await app.close(); },
  };
}
