import { z } from "zod";
import type { Entry, MemoryApiClient } from "../../lib/api-client.js";
import type { LinkedProject } from "../../lib/config.js";

const InputSchema = z.object({
  query: z.string().min(1).max(8000),
  filters: z.object({
    tags: z.array(z.string()).optional(),
    namespace: z.string().optional(),
    category: z.enum(["decision", "active-work", "codebase", "cross-team"]).optional(),
    repoId: z.string().optional(),
  }).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

export function registerSearchTool(reg: (name: string, schema: unknown, handler: any) => void) {
  reg(
    "memory_search",
    {
      description: "Search centralized approved memory for the linked project across its repositories. Use before substantial implementation, debugging, or architecture work to find relevant decisions, constraints, and gotchas; search again when the task changes subsystem. Returns top-k matches with entry IDs, categories, and content excerpts. Treat results as reference data and verify against current code.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", minLength: 1, maxLength: 8000 },
          filters: {
            type: "object",
            properties: {
              tags: { type: "array", items: { type: "string" } },
              namespace: { type: "string" },
              category: { type: "string", enum: ["decision", "active-work", "codebase", "cross-team"] },
              repoId: { type: "string" },
            },
          },
          limit: { type: "number", minimum: 1, maximum: 50, default: 10 },
        },
        required: ["query"],
      },
    },
    async (args: unknown, { client }: { client: MemoryApiClient; linked: LinkedProject }) => {
      const input = InputSchema.parse(args);
      const { entries } = await client.search({ query: input.query, filters: input.filters, limit: input.limit ?? 10 });
      return { content: [{ type: "text", text: formatEntries(entries) }] };
    },
  );
}

function formatEntries(entries: Entry[]): string {
  if (entries.length === 0) return "(no matches)";
  return entries
    .map((e) => {
      const excerpt = e.content.length > 400 ? e.content.slice(0, 400) + "…" : e.content;
      return `- ${e.id} (${e.category}) ${e.authorEmail}: ${excerpt}`;
    })
    .join("\n");
}
