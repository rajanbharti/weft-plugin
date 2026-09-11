# Weft plugin

Claude Code client for centralized project memory. Requires Node.js 20+;
installed users do not need npm, TypeScript, or a local Weft service.

## Install

In Claude Code:

```text
/plugin marketplace add rajanbharti/weft-plugin
/plugin install weft-plugin@weft
```

For a downloaded release, extract the archive and add its `weft-plugin-0.1.1`
directory as a local marketplace with `/plugin marketplace add /absolute/path/to/weft-plugin-0.1.1`.
Then install `weft-plugin@weft`.

## Connect a project

Get a project ID and shared token from the Weft dashboard, then run:

```text
/weft-plugin:memory-link <project-id> <token>
```

The default API is https://service-production-a3ce.up.railway.app.
The `defaultServer` plugin option selects another deployment;
`AGENT_MEMORY_DEFAULT_SERVER` takes precedence when set.
Linking saves the server and project ID in `.claude/memory-config.json` and
stores the token privately in `CLAUDE_PLUGIN_DATA`. Commit the repository
configuration and `.projectmemoryignore`, never the token store.

Start a fresh session after linking. The plugin loads approved pinned and recent
memory and instructs Claude to search project-wide memory before substantial work.
Captures stay in the local review buffer until explicitly submitted through
`/weft-plugin:memory-review`. Submitted content and search queries go to the
configured service. Rotate compromised project tokens and relink each client.

## Development

From this package directory:

```bash
npm ci
npm run bundle
npm test
```

Seven skills, five hooks, and four MCP tools are included. Runtime entrypoints in
`commands/`, `hooks/`, and `mcp-server/` are self-contained committed bundles;
regenerate them after source changes. Tests use a local mock API.
