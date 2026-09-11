# Weft — project memory for Claude Code

Your team's decisions, gotchas and in-flight work, primed into every Claude Code
session and captured back from the work you actually do.

This repository is a **Claude Code plugin marketplace**. The plugin is a client:
it talks to the hosted Weft API at
https://service-production-a3ce.up.railway.app.
Approved captures and search queries are sent to that service.

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

**Captures.** Git commits and file edits become candidate entries. Nothing is
uploaded silently: candidates are buffered locally and only leave your machine
when you run `/memory-review` and approve them.

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
| `/memory-review` | Walk the capture queue and decide what to keep |

## What never leaves your machine

Paths matching `.projectmemoryignore` (same syntax as `.gitignore`) are dropped
before a capture is created, and content is scanned for secret-shaped strings
and redacted. The server it talks to must be HTTPS unless it is on localhost.

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
ZIP, then run `/plugin marketplace add /absolute/path/to/weft-plugin-0.1.3`
in Claude Code and install `weft-plugin@weft`. GitHub installs receive this
version only after these changes are published to the marketplace repository.

## Licence

MIT

Plugin data uses `CLAUDE_PLUGIN_DATA` when provided. Otherwise it persists under
`~/.claude/plugins/data/weft-plugin` (or the same subdirectory of
`CLAUDE_CONFIG_DIR`). This works across plugin updates without extra setup.
