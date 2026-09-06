# @agent-memory/plugin

Claude Code plugin for the agent-memory service.

## What's in this package

- `skills/` — six slash commands (`/memory-link`, `/memory-unlink`, `/memory-search`, `/memory-recent`, `/memory-pin`, `/memory-write`).
- `hooks/` — `SessionStart` priming and `PreToolUse` auto-allow for `mcp__memory__*`.
- `mcp-server/` — stdio MCP server exposing `memory_search`, `memory_recent`, `memory_write_proposal`, `memory_pin`.
- `src/` — TypeScript source; compiled to `dist/` by `tsc`.

## Building

From the repo root:

```bash
pnpm install
pnpm --filter @agent-memory/plugin build
```

`dist/` must be up to date before you install the plugin — the hook/MCP `.mjs` wrappers load from it.

## Installing into Claude Code (local path)

```bash
claude plugin install --plugin-dir $(pwd)/packages/plugin
```

Claude Code will prompt once for `defaultServer` (the fallback memory service URL — overridden per-repo when you `/memory-link`).

## First-time setup in a repo

1. Ask a project admin to create a project in the memory service (see the top-level `USER_GUIDE.md`). They share the `project-id` and `token`.
2. In the repo:
   ```
   /memory-link <project-id> <token>
   ```
   This writes `.claude/memory-config.json` (safe to commit — no secrets) and stores the token in `${CLAUDE_PLUGIN_DATA}/tokens.json` (private to your machine).
3. Start a new Claude Code session. You'll see a "Project memory (auto-primed)" block at the top of the context.
4. Claude can call `memory_search`, `memory_recent`, `memory_write_proposal`, and `memory_pin` mid-session without permission prompts.

## Tests

```bash
pnpm --filter @agent-memory/plugin test
```

Unit tests run with no infra. Integration tests spin up a local mock service on an ephemeral port and spawn the MCP server as a subprocess — no Docker, no external DB required.

## Gotchas

- `/memory-link` and the write-path MCP tool need `git config user.email` (and ideally `user.name`) set in the repo.
- If you rotate the project token, every dev must re-run `/memory-link` with the new token. The old one starts returning 401 immediately.
- Hook/MCP wrapper files (`hooks/*.mjs`, `mcp-server/server.mjs`) import from `dist/`. If you edit source, run `pnpm --filter @agent-memory/plugin build` again.
