import { z } from "zod";
import type { Entry, MemoryApiClient } from "../../lib/api-client.js";

const InputSchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
  since: z.string().optional(),
});

export function registerRecentTool(reg: (name: string, schema: unknown, handler: any) => void) {
  reg(
    "memory_recent",
    {
      description: "Most recently approved memory entries for this project.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", minimum: 1, maximum: 100, default: 20 },
          since: { type: "string", format: "date-time" },
        },
      },
    },
    async (args: unknown, { client }: { client: MemoryApiClient }) => {
      const input = InputSchema.parse(args);
      const { entries } = await client.listRecent({ limit: input.limit ?? 20, since: input.since });
      return { content: [{ type: "text", text: formatEntries(entries) }] };
    },
  );
}

function formatEntries(entries: Entry[]): string {
  if (entries.length === 0) return "(no recent entries)";
  return entries
    .map((e) => {
      const excerpt = e.content.length > 200 ? e.content.slice(0, 200) + "…" : e.content;
      const when = e.createdAt ? e.createdAt.slice(0, 10) : "?";
      return `- ${e.id} (${e.category}) ${when}: ${excerpt}`;
    })
    .join("\n");
}
