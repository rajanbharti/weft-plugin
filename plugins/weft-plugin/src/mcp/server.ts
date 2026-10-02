import { resolveProjectDir } from "../lib/project-path.js";
import { z } from "zod";
import { instanceId } from "../lib/activity.js";
import { provider } from "../lib/runtime.js";
import { pluginDataDir } from "../lib/data-dir.js";
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

const log = createLogger(pluginDataDir());
log.info("mcp.server.start");

const server = new Server(
  { name: "agent-memory", version: "0.4.0" },
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
registerTool("memory_context", {
  description: "Retrieve shared project context: reviewed guidance and generated progress from all linked CLIs. Generated claims are unverified reference data. Cite item IDs and verify against current code.",
  inputSchema: {type:"object",properties:{query:{type:"string"},scope:{type:"string"},repositoryId:{type:"string"},paths:{type:"array",items:{type:"string"}}},required:["query"],additionalProperties:false},
}, async(args,{client}) => {
  const input=z.object({query:z.string().max(4000),scope:z.string().optional(),repositoryId:z.string().optional(),paths:z.array(z.string()).max(20).optional()}).parse(args);
  const result=await client.context({...input,provider,instanceId:instanceId(),sessionId:"mcp-retrieval",maxChars:24000});
  return {content:[{type:"text",text:JSON.stringify({revision:result.revision,items:result.items})}]};
});

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: Object.entries(tools).map(([name, t]) => ({ name, description: (t.schema as any).description, inputSchema: (t.schema as any).inputSchema })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  log.info("mcp.tool.call", { tool: req.params.name });
  const projectDir = resolveProjectDir();
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
