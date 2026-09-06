import { z } from "zod";
import type { MemoryApiClient } from "../../lib/api-client.js";
import type { LinkedProject } from "../../lib/config.js";

const InputSchema = z.object({
  entryId: z.string(),
});

export function registerPinTool(
  reg: (name: string, schema: unknown, handler: any) => void,
) {
  reg(
    "memory_pin",
    {
      description: "Pin an existing approved entry so it appears in SessionStart priming.",
      inputSchema: {
        type: "object",
        properties: { entryId: { type: "string" } },
        required: ["entryId"],
      },
    },
    async (args: unknown, { client }: { client: MemoryApiClient; linked: LinkedProject }) => {
      const input = InputSchema.parse(args);
      const { entry } = await client.pinEntry(input.entryId, true);
      return { content: [{ type: "text", text: `Pinned ${entry.id} (pinned=${entry.pinned}).` }] };
    },
  );
}
