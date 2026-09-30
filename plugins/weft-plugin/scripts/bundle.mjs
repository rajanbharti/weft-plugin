// Claude Code never runs `npm install` for an installed plugin, so every
// entrypoint it invokes has to be a self-contained file with no imports to
// resolve. This inlines the dependency tree into the committed .mjs files.
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";

const HOOKS = ["context", "activity", "session-start", "pre-tool-use", "post-tool-bash", "post-tool-edit", "stop"];
const COMMANDS = ["link", "unlink", "search", "recent", "pin", "write", "review"];

const shared = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  logLevel: "error",
};

await mkdir("commands", { recursive: true });

await Promise.all([
  ...HOOKS.map((h) =>
    build({ ...shared, entryPoints: [`src/hooks/${h}.ts`], outfile: `hooks/${h}.mjs` }),
  ),
  ...COMMANDS.map((c) =>
    build({ ...shared, entryPoints: [`src/commands/${c}.ts`], outfile: `commands/${c}.mjs` }),
  ),
  build({ ...shared, entryPoints: ["src/mcp/server.ts"], outfile: "mcp-server/server.mjs" }),
]);

console.log(`bundled ${HOOKS.length} hooks, ${COMMANDS.length} commands, 1 mcp server`);

const codex = "../weft-codex";
const codexOptions = { ...shared, define: { __WEFT_CODEX__: "true" } };
await mkdir(`${codex}/commands`, { recursive: true });
await mkdir(`${codex}/mcp-server`, { recursive: true });
await Promise.all([
  ...COMMANDS.filter(c => c !== "review").map(c => build({ ...codexOptions, entryPoints: [`src/commands/${c}.ts`], outfile: `${codex}/commands/${c}.mjs` })),
  build({ ...codexOptions, entryPoints: ["src/codex/hook.ts"], outfile: `${codex}/hooks/activity.mjs` }),
  build({ ...codexOptions, entryPoints: ["src/codex/status.ts"], outfile: `${codex}/commands/status.mjs` }),
  build({ ...codexOptions, entryPoints: ["src/mcp/server.ts"], outfile: `${codex}/mcp-server/server.mjs` }),
]);
console.log("bundled Codex hooks, commands, and MCP server");
