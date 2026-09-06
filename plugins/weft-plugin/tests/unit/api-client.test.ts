import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MemoryApiClient } from "../../src/lib/api-client.js";
import { startMockService, StoppedMock } from "../integration/helpers/mock-service.js";
import * as net from "node:net";

let mock: Awaited<ReturnType<typeof startMockService>> & StoppedMock;
let client: MemoryApiClient;

beforeAll(async () => {
  mock = await startMockService({
    pinned: [{ id: "entry_pinned_1", content: "p", category: "codebase", status: "approved", pinned: true }],
    recent: [{ id: "entry_r_1", content: "r", category: "decision", status: "approved", pinned: false }],
  });
  client = new MemoryApiClient(mock.url, "pmt_test");
});

afterAll(async () => { await mock.stop(); });

describe("MemoryApiClient", () => {
  it("listRecent returns entries", async () => {
    const { entries } = await client.listRecent({ limit: 5 });
    expect(entries[0].id).toBe("entry_r_1");
  });

  it("listPinned returns pinned entries", async () => {
    const { entries } = await client.listPinned();
    expect(entries[0].pinned).toBe(true);
  });

  it("search returns matches", async () => {
    const { entries } = await client.search({ query: "whatever", limit: 2 });
    expect(Array.isArray(entries)).toBe(true);
  });

  it("createEntry returns a new entry", async () => {
    const { entry } = await client.createEntry({
      category: "decision",
      source: "manual",
      content: "x",
      authorEmail: "x@e.com",
      status: "approved",
    });
    expect(entry.id.startsWith("entry_")).toBe(true);
  });

  it("pinEntry toggles the pinned flag", async () => {
    const { entry } = await client.pinEntry("entry_r_1", true);
    expect(entry.pinned).toBe(true);
  });

  it("throws TokenInvalidError on 401", async () => {
    const bad = new MemoryApiClient(mock.url, "pmt_wrong");
    await expect(bad.listRecent()).rejects.toMatchObject({ code: "token_invalid" });
  });

  it("throws NetworkError on unreachable server", async () => {
    const unreachable = new MemoryApiClient("http://127.0.0.1:1", "pmt_x");
    await expect(unreachable.listRecent()).rejects.toMatchObject({ code: "network" });
  });

  it("refuses http:// with non-local hostname", () => {
    expect(() => new MemoryApiClient("http://memory.example.com", "pmt_x")).toThrow(/insecure/i);
  });

  it("allows http://localhost", () => {
    expect(() => new MemoryApiClient("http://localhost:3000", "pmt_x")).not.toThrow();
  });

  it("allows http://127.0.0.1", () => {
    expect(() => new MemoryApiClient("http://127.0.0.1:3000", "pmt_x")).not.toThrow();
  });

  it("allows https://", () => {
    expect(() => new MemoryApiClient("https://memory.example.com", "pmt_x")).not.toThrow();
  });

  it("throws NetworkError with 'timeout' on slow responses", async () => {
    const sockets = new Set<net.Socket>();
    const srv = net.createServer((sock) => {
      sockets.add(sock);
      sock.on("close", () => sockets.delete(sock));
      sock.pause(); // accept but never respond
    });
    await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", () => resolve()));
    const port = (srv.address() as net.AddressInfo).port;
    const slow = new MemoryApiClient(`http://127.0.0.1:${port}`, "pmt_x", { timeoutMs: 500 });
    await expect(slow.listRecent()).rejects.toMatchObject({ code: "network" });
    // Destroy lingering sockets so srv.close() doesn't hang.
    for (const s of sockets) s.destroy();
    await new Promise<void>((resolve) => srv.close(() => resolve()));
  }, 5_000);
});
