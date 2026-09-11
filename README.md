# Weft — project memory for Claude Code

Your team's decisions, gotchas and in-flight work, primed into every Claude Code
session and captured back from the work you actually do.

This repository is a **Claude Code plugin marketplace**. The plugin is a client:
it talks to the hosted Weft API at
https://service-production-a3ce.up.railway.app.
Captured session activity and search queries are sent to that service automatically.

## Install

```
/plugin marketplace add rajanbharti/weft-plugin
/plugin install weft-plugin@weft
```

The plugin connects to hosted Weft automatically. No server URL or server
configuration is required; you only need your project ID and token.

## Connect a repository

Get the project id and token from your Weft dashboard, then inside Claude Code:

```
/memory-link <project-id> <token>
```

Everyone on a project links with the same token. Linking writes
`.claude/memory-config.json` and `.projectmemoryignore` into the repo — commit
both. Your token is stored outside the repo and is never committed.

Start a fresh session afterwards: priming runs at session start.

## What it does

**Primes.** Every session opens with the entries your team has approved —
pinned decisions first, followed by recent approved entries. The session instructions
direct Claude to search centralized project memory before substantial implementation,
debugging, or architecture work, and again when changing subsystems. Search covers
all repositories linked to that project unless explicitly filtered. Retrieved
entries are checked against current code; relevant entry IDs identify the source
of memory-informed decisions.

**Captures automatically.** After linking, prompts, tool inputs/results (including
reads, commands, and edits), tool failures, final responses, subagent completions,
and session-end events upload in the background to the project’s pending queue.
There is no local usefulness filter and no required `/memory-review` step.
Every developer linked to the project contributes to the same platform.
Approve useful entries or archive noise in the dashboard; only approved entries
are retrieved as shared memory.

**Retrieves.** `/memory-search` asks the shared memory a question in your own
words; matches are semantic, so wording need not line up.

### Commands

| Command | What it does |
|---|---|
| `/memory-link` | Connect this repo to a project |
| `/memory-unlink` | Disconnect it |
| `/memory-search` | Ask the shared memory a question |
| `/memory-recent` | What the team learned lately |
| `/memory-pin` | Keep an entry in every session's priming |
| `/memory-write` | Record something deliberately |
| `/memory-review` | Review legacy local candidates from earlier plugin versions |

## What never leaves your machine

Tool payloads referencing excluded files are omitted (event metadata is still
captured). `.projectmemoryignore` uses gitignore syntax. Known secret patterns
and credential fields are redacted before local persistence or upload. Memory-tool
payloads are omitted to avoid recursively recapturing retrieved memory. The server it talks to must be HTTPS unless it is on localhost.

## Development

```
cd plugins/weft-plugin
npm ci
npm run bundle
npm test
```

Claude Code never runs an install step for a plugin, so `hooks/`, `commands/`
and `mcp-server/` are committed as self-contained bundles with dependencies
inlined. Re-run `npm run bundle` after changing anything under `src/` — the
bundles are what actually ship.

To create a distributable ZIP and SHA-256 checksum after bundling and testing,
run `python3 scripts/package-release.py` from the repository root. Extract the
ZIP, then run `/plugin marketplace add /absolute/path/to/weft-plugin-0.2.1`
in Claude Code and install `weft-plugin@weft`. GitHub installs receive this
version only after these changes are published to the marketplace repository.

## Licence

MIT

Plugin data uses `CLAUDE_PLUGIN_DATA` when provided. Otherwise it persists under
`~/.claude/plugins/data/weft-plugin` (or the same subdirectory of
`CLAUDE_CONFIG_DIR`). This works across plugin updates without extra setup.

## Delivery and limits

Activity is first stored in a private outbox, separated by server, project, and
local repository. Successful uploads remove only their own event files; failed
uploads remain and retry on later activity or session start. No manual submission
is required, but no retries run while Claude Code is closed. Events carry an ID,
timestamp, session, local repository ID/name, instance ID, and git author identity
(global git configuration is supported). Missing identity is labelled
`unattributed@weft.invalid` rather than losing the event.

Delivery is at least once: a lost success response can produce a duplicate with
the same `event-id` tag. No server deduplication is claimed. The existing service
embeds each submitted entry; high event volume increases storage and embedding
usage. Payloads retain at most 16,000 characters, with additional per-line limits.
Hooks capture what Claude Code exposes, not external editor activity or the full
transcript. Historical local buffers remain available through `/memory-review`.

Memory tools reload the repository link on every call, so linking does not require
a restart. The MCP process inherits the repository working directory when
`CLAUDE_PROJECT_DIR` is absent; it must not run from the plugin cache. Restart
Claude Code once after installing updates to load the new MCP configuration.
