import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { loadLinkedProject, LinkedProject } from "../lib/config.js";
import { MemoryApiClient } from "../lib/api-client.js";
import { NotLinkedError } from "../lib/errors.js";
import { createLogger } from "../lib/logging.js";
import { registerSearchTool } from "./tools/search.js";
import { registerRecentTool } from "./tools/recent.js";
import { registerWriteProposalTool } from "./tools/write-proposal.js";
import { registerPinTool } from "./tools/pin.js";

const log = createLogger(process.env.CLAUDE_PLUGIN_DATA ?? "/tmp");
log.info("mcp.server.start");

const server = new Server(
  { name: "agent-memory", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

type ToolHandler = (args: unknown, ctx: { client: MemoryApiClient; linked: LinkedProject }) => Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }>;
const tools: Record<string, { schema: unknown; handler: ToolHandler }> = {};

export function registerTool(name: string, schema: unknown, handler: ToolHandler) {
  tools[name] = { schema, handler };
}

registerSearchTool(registerTool);
registerRecentTool(registerTool);
registerWriteProposalTool(registerTool);
registerPinTool(registerTool);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: Object.entries(tools).map(([name, t]) => ({ name, description: (t.schema as any).description, inputSchema: (t.schema as any).inputSchema })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  log.info("mcp.tool.call", { tool: req.params.name });
  const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const linked = await loadLinkedProject(projectDir);
  if (!linked) {
    const out = {
      isError: true,
      content: [{ type: "text", text: new NotLinkedError().message }],
    } as const;
    log.info("mcp.tool.result", { tool: req.params.name, isError: true });
    return out;
  }
  const t = tools[req.params.name];
  if (!t) {
    const out = { isError: true, content: [{ type: "text", text: `Unknown tool: ${req.params.name}` }] } as const;
    log.info("mcp.tool.result", { tool: req.params.name, isError: true });
    return out;
  }
  const client = new MemoryApiClient(linked.server, linked.token);
  try {
    const out = await t.handler(req.params.arguments ?? {}, { client, linked });
    log.info("mcp.tool.result", { tool: req.params.name, isError: out.isError === true });
    return out;
  } catch (e: any) {
    const out = { isError: true, content: [{ type: "text", text: `Error: ${e.message ?? String(e)}` }] } as const;
    log.info("mcp.tool.result", { tool: req.params.name, isError: true });
    return out;
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
