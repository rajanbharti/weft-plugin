import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { saveRepoConfig, saveToken } from "../../../../src/lib/config.js";
import { startMockService, MockFixtures } from "../../helpers/mock-service.js";

export interface Harness {
  client: Client;
  stop: () => Promise<void>;
  projectDir: string;
  pluginDataDir: string;
  serverUrl: string;
}

const serverPath = fileURLToPath(new URL("../../../../mcp-server/server.mjs", import.meta.url));

export async function makeHarness(opts: { fixtures?: MockFixtures; linked?: boolean; tokenOverride?: string; omitProjectEnv?: boolean }): Promise<Harness> {
  const projectDir = mkdtempSync(join(tmpdir(), "mcp-harness-repo-"));
  const pluginDataDir = mkdtempSync(join(tmpdir(), "mcp-harness-data-"));
  process.env.CLAUDE_PLUGIN_DATA = pluginDataDir;
  const mock = await startMockService(opts.fixtures ?? {});

  if (opts.linked !== false) {
    await saveRepoConfig(projectDir, { project_id: "proj_mcp", server: mock.url });
    await saveToken("proj_mcp", opts.tokenOverride ?? opts.fixtures?.validToken ?? "pmt_test");
  }

  const transport = new StdioClientTransport({
    command: "node",
    args: [serverPath],
    cwd: projectDir,
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: opts.omitProjectEnv ? "" : projectDir,
      CLAUDE_PLUGIN_DATA: pluginDataDir,
    },
  });
  const client = new Client({ name: "test", version: "0.0.0" }, { capabilities: {} });
  await client.connect(transport);

  return {
    client,
    projectDir,
    pluginDataDir,
    serverUrl: mock.url,
    async stop() {
      await client.close();
      await mock.stop();
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(pluginDataDir, { recursive: true, force: true });
      delete process.env.CLAUDE_PLUGIN_DATA;
    },
  };
}
