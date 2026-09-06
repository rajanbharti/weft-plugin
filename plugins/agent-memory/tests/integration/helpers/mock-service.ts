import Fastify, { FastifyInstance } from "fastify";

export interface MockFixtures {
  recent?: unknown[];
  pinned?: unknown[];
  validToken?: string;
}

export interface StoppedMock {
  url: string;
  app: FastifyInstance;
  ignoreRulePushes: Array<{ projectId: string; patterns: string[]; repoId?: string }>;
  stop(): Promise<void>;
}

let counter = 0;
const newId = (prefix: string) => `${prefix}_${(++counter).toString(36)}`;

export async function startMockService(fixtures: MockFixtures = {}): Promise<StoppedMock> {
  const validToken = fixtures.validToken ?? "pmt_test";
  const app = Fastify({ logger: false });
  const ignoreRulePushes: Array<{ projectId: string; patterns: string[]; repoId?: string }> = [];

  app.addHook("preHandler", async (req, reply) => {
    if (req.url === "/healthz") return;
    const header = req.headers.authorization;
    if (header !== `Bearer ${validToken}`) {
      reply.code(401).send({ error: "unauthorized" });
    }
  });

  app.get("/healthz", async () => ({ ok: true }));

  app.get("/v1/entries/recent", async () => ({ entries: fixtures.recent ?? [] }));
  app.get("/v1/entries/pinned", async () => ({ entries: fixtures.pinned ?? [] }));

  app.post("/v1/entries/search", async (req: any) => ({
    entries: (fixtures.recent ?? []).slice(0, req.body?.limit ?? 10),
  }));

  app.post("/v1/entries", async (req: any) => ({
    entry: { id: newId("entry"), pinned: false, ...(req.body ?? {}) },
  }));

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
    async stop() { await app.close(); },
  };
}
