# Weft plugin

Claude Code client for centralized project memory. Requires Node.js 20+;
installed users do not need npm, TypeScript, or a local Weft service.

## Install

In Claude Code:

```text
/plugin marketplace add rajanbharti/weft-plugin
/plugin install weft-plugin@weft
```

For a downloaded release, extract the archive and add its `weft-plugin-0.2.2`
directory as a local marketplace with `/plugin marketplace add /absolute/path/to/weft-plugin-0.2.2`.
Then install `weft-plugin@weft`.

## Connect a project

Get a project ID and shared token from the Weft dashboard, then run:

```text
/weft-plugin:memory-link <project-id> <token>
```

The API is https://service-production-a3ce.up.railway.app.
The plugin uses this hosted service automatically; no server configuration is required.
Linking saves the server and project ID in `.claude/memory-config.json` and
stores the token privately in `CLAUDE_PLUGIN_DATA`. Commit the repository
configuration and `.projectmemoryignore`, never the token store.

Start a fresh session after linking. The plugin loads approved pinned and recent
memory and instructs Claude to search project-wide memory before substantial work.
Captured prompts, tool calls/results, failures, and final responses upload
automatically as pending entries. Review or archive noise in the platform.
No local review command is needed; `/weft-plugin:memory-review` remains available
for legacy candidates. Failed uploads retry on later activity or session start.
Activity and search queries go to the hosted service. Rotate compromised project tokens and relink each client.

## Development

From this package directory:

```bash
npm ci
npm run bundle
npm test
```

Seven skills, activity/priming hooks, and four MCP tools are included. Runtime entrypoints in
`commands/`, `hooks/`, and `mcp-server/` are self-contained committed bundles;
regenerate them after source changes. Tests use a local mock API.

Plugin data uses `CLAUDE_PLUGIN_DATA` when provided. Otherwise it persists under
`~/.claude/plugins/data/weft-plugin` (or the same subdirectory of
`CLAUDE_CONFIG_DIR`). This works across plugin updates without extra setup.

Memory tools reload the repository link on every call, so linking does not require
a restart. Commands, hooks, and MCP tools use only `process.cwd()` to locate the repository.
`CLAUDE_PROJECT_DIR` and hook payload paths are ignored. Launch Claude Code from
the repository you linked; the plugin cache is never the working directory. Restart
Claude Code once after installing updates to load the new MCP configuration.
