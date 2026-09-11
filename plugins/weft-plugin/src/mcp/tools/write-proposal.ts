import { z } from "zod";
import type { MemoryApiClient } from "../../lib/api-client.js";
import type { LinkedProject } from "../../lib/config.js";
import { readGitIdentity } from "../../git.js";

const InputSchema = z.object({
  content: z.string().min(1).max(20_000),
  category: z.enum(["decision", "active-work", "codebase", "cross-team"]),
  tags: z.array(z.string()).max(32).optional(),
  namespace: z.string().max(120).optional(),
});

export function registerWriteProposalTool(
  reg: (name: string, schema: unknown, handler: any) => void,
) {
  reg(
    "memory_write_proposal",
    {
      description: "Propose a new entry for this project's memory. Creates it in `pending` status; a human reviewer approves from the dashboard before it becomes visible.",
      inputSchema: {
        type: "object",
        properties: {
          content: { type: "string", minLength: 1, maxLength: 20000 },
          category: { type: "string", enum: ["decision", "active-work", "codebase", "cross-team"] },
          tags: { type: "array", items: { type: "string" }, maxItems: 32 },
          namespace: { type: "string", maxLength: 120 },
        },
        required: ["content", "category"],
      },
    },
    async (args: unknown, { client }: { client: MemoryApiClient; linked: LinkedProject }) => {
      const input = InputSchema.parse(args);
      const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
      const identity = readGitIdentity(projectDir);
      if (!identity) {
        return {
          isError: true,
          content: [{ type: "text", text: "Missing git identity. Run: git config user.email <you@example.com>" }],
        };
      }
      const { entry } = await client.createEntry({
        category: input.category,
        source: "claude-proposed",
        content: input.content,
        tags: input.tags,
        namespace: input.namespace,
        authorEmail: identity.email,
        authorName: identity.name ?? undefined,
        status: "pending",
      });
      return {
        content: [{ type: "text", text: `Proposed entry ${entry.id} (status=${entry.status}). A reviewer will approve it from the dashboard.` }],
      };
    },
  );
}
