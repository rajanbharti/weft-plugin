import { mkdirSync, mkdtempSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { readGuidance, syncGuidance } from "../../src/lib/guidance.js";
import { MemoryApiClient } from "../../src/lib/api-client.js";
const roots: string[] = [];
const temp = () => { const dir = mkdtempSync(join(tmpdir(), "weft-guidance-")); roots.push(dir); return dir; };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true }); });
it("reads the two root guidance files and redacts project credentials", () => {
 const dir = temp();
 writeFileSync(join(dir, "CLAUDE.md"), "Use pnpm\npmt_secret_token");
 writeFileSync(join(dir, "AGENTS.md"), "Run tests");
 expect(readGuidance(dir, "pmt_secret_token")).toEqual([{ filename: "CLAUDE.md", content: "Use pnpm\n[REDACTED]" }, { filename: "AGENTS.md", content: "Run tests" }]);
});
it("does not upload ignored files, symlinks, or oversized files", () => {
 const dir = temp(); const outside = temp();
 writeFileSync(join(outside, "private"), "private guidance");
 symlinkSync(join(outside, "private"), join(dir, "AGENTS.md"));
 writeFileSync(join(dir, "CLAUDE.md"), "x".repeat(32001));
 expect(readGuidance(dir, "secret").every((file) => file.content === null)).toBe(true);
 writeFileSync(join(dir, "CLAUDE.md"), "private");
 writeFileSync(join(dir, ".projectmemoryignore"), "CLAUDE.md\n");
 expect(readGuidance(dir, "secret")[0].content).toBeNull();
});
it("retries failures and syncs changes and deletions", async () => {
 const dir = temp();
 vi.stubEnv("CLAUDE_PLUGIN_DATA", temp());
 const capabilities = vi.spyOn(MemoryApiClient.prototype, "activityCapabilities").mockResolvedValue({ schemaVersions: [1], guidanceSchemaVersions: [1], maxBatchEvents: 20, maxPayloadBytes: 10000 });
 vi.spyOn(MemoryApiClient.prototype, "linkRepository").mockResolvedValue({ repo: { id: "repo" } });
 const upload = vi.spyOn(MemoryApiClient.prototype, "syncGuidance").mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ ok: true });
 writeFileSync(join(dir, "AGENTS.md"), "Use pnpm");
 const linked = { projectId: dir, server: "http://localhost", token: "secret", primingTokenBudget: 1000, captureFileEdits: false, gitCommitMinMessageChars: 12 };
 const sync = () => syncGuidance(dir, linked, { remoteUrl: dir, label: "repo" }, Date.now() + 5000);
 await expect(sync()).rejects.toThrow("offline");
 await sync(); await sync();
 expect(upload).toHaveBeenCalledTimes(2);
 rmSync(join(dir, "AGENTS.md")); await sync();
 expect(upload).toHaveBeenLastCalledWith("repo", [{filename: "CLAUDE.md", content: null}, {filename: "AGENTS.md", content: null}]);
 expect(capabilities).toHaveBeenCalledTimes(3);
});
const tree = (dir: string, files: Record<string, string>) => {
 for (const [path, content] of Object.entries(files)) {
  mkdirSync(join(dir, path, ".."), { recursive: true });
  writeFileSync(join(dir, path), content);
 }
};
it("discovers Markdown at the root and one folder down, agent files first", () => {
 const dir = temp();
 tree(dir, {
  "README.md": "root readme", "CLAUDE.md": "root claude", "NOTES.md": "notes",
  "weft/CLAUDE.md": "nested claude", "weft/USER_GUIDE.md": "guide", "weft-plugin/README.md": "plugin readme",
  ".github/copilot-instructions.md": "copilot", ".github/other.md": "skip",
  ".hidden/CLAUDE.md": "skip", "node_modules/README.md": "skip", "dist/AGENTS.md": "skip",
  "a/b/deep.md": "skip", "my notes.md": "skip", "weft/private.md": "skip", "weft/notes.txt": "skip",
 });
 writeFileSync(join(dir, ".projectmemoryignore"), "weft/private.md\n");
 expect(readGuidance(dir, "secret", 2).map((f) => f.filename)).toEqual([
  "CLAUDE.md", ".github/copilot-instructions.md", "weft/CLAUDE.md",
  "README.md", "weft-plugin/README.md",
  "NOTES.md", "weft/USER_GUIDE.md",
 ]);
});
it("caps discovery at 40 files and 300 KB, keeping agent files", () => {
 const dir = temp();
 const files: Record<string, string> = { "AGENTS.md": "agents" };
 for (let i = 0; i < 50; i++) files[`doc${String(i).padStart(2, "0")}.md`] = "x".repeat(10000);
 tree(dir, files);
 const found = readGuidance(dir, "secret", 2);
 expect(found[0].filename).toBe("AGENTS.md");
 expect(found.length).toBeLessThanOrEqual(40);
 expect(found.reduce((n, f) => n + (f.content?.length ?? 0), 0)).toBeLessThanOrEqual(300000);
});
it("syncs nested guidance and deletes files that disappear", async () => {
 const dir = temp();
 vi.stubEnv("CLAUDE_PLUGIN_DATA", temp());
 vi.spyOn(MemoryApiClient.prototype, "activityCapabilities").mockResolvedValue({ schemaVersions: [1], guidanceSchemaVersions: [1, 2], maxBatchEvents: 20, maxPayloadBytes: 10000 });
 vi.spyOn(MemoryApiClient.prototype, "linkRepository").mockResolvedValue({ repo: { id: "repo" } });
 const upload = vi.spyOn(MemoryApiClient.prototype, "syncGuidance").mockResolvedValue({ ok: true });
 tree(dir, { "weft/CLAUDE.md": "nested", "README.md": "readme" });
 const linked = { projectId: dir, server: "http://localhost", token: "secret", primingTokenBudget: 1000, captureFileEdits: false, gitCommitMinMessageChars: 12 };
 const sync = () => syncGuidance(dir, linked, { remoteUrl: dir, label: "repo" }, Date.now() + 5000);
 await sync();
 expect(upload).toHaveBeenLastCalledWith("repo", [{ filename: "weft/CLAUDE.md", content: "nested" }, { filename: "README.md", content: "readme" }]);
 rmSync(join(dir, "weft/CLAUDE.md"));
 await sync();
 expect(upload).toHaveBeenLastCalledWith("repo", [{ filename: "README.md", content: "readme" }, { filename: "weft/CLAUDE.md", content: null }]);
});
