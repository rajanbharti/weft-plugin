# Weft for Codex CLI

Shared project memory with automatic lifecycle capture. Requires Node.js 20+;
tested with Codex CLI 0.155.0. Installed bundles are self-contained: no npm install
is required for users. The service is https://service-production-a3ce.up.railway.app.

## Connect and use

Install `weft-codex` from your local personal marketplace with
`codex plugin add weft-codex@personal`, then open a fresh Codex CLI session in the
repository you want linked. If your personal marketplace has a different name,
substitute that name.

1. Open `/hooks`, review and trust the Weft hooks. Installing a plugin alone does
   not authorize Codex to run its hooks.
2. Invoke `$memory-link <project-id> <token>`.
3. Invoke `$memory-status` to verify authentication and automatic-capture transport.
4. Continue working. New prompts and tool results are captured automatically.
   Shared context refreshes at session start and before every new task prompt.

Skills: `$memory-link`, `$memory-unlink`, `$memory-search`, `$memory-recent`,
`$memory-write`, `$memory-pin`, `$memory-status`. These are Codex skills, not
Claude slash commands. The MCP server supplies `memory_search`, `memory_recent`,
`memory_write_proposal`, `memory_pin`, and `memory_context` (shared generated progress plus reviewed guidance).

The corresponding `commands/*.mjs` scripts can also be run directly with Node
from the linked repository. Resolve their paths against this plugin directory.
For example: `node /absolute/path/to/weft-codex/commands/status.mjs`.

## Automatic events

| Codex hook | Behavior |
| --- | --- |
| SessionStart | Load shared context snapshot and retry queued uploads |
| UserPromptSubmit | Refresh shared task context, then capture the submitted prompt |
| PostToolUse | Capture supported local tool inputs/results, including nonzero shell exits |
| Stop | Capture the final assistant response |
| SubagentStop | Capture subagent completion |
| SessionEnd | Capture session ending and attempt a short flush |

Hooks run synchronously so Codex cannot cancel background capture at teardown.
Normal upload attempts have a four-second budget; SessionEnd uses 1.2 seconds
within Codex's three-second limit. Failed uploads stay on disk and retry on later
activity or session start. No background daemon runs while Codex is closed.
Concurrent activity or large backlogs may require a later hook to finish draining.
Startup retries do not create a synthetic session-start event.

Codex does not expose Claude's PostToolUseFailure event. Failed commands are
captured with their PostToolUse result; hosted tool calls may not emit local hooks.
The plugin does not change tool permissions, block turns, or read transcripts.

## Configuration and privacy

Linking writes `.codex/memory-config.json` and `.projectmemoryignore` in the
current directory. Commit those non-secret files if desired. It does not reuse
or modify Claude's `.claude/memory-config.json` or Claude token store.

Hooks, commands, and MCP use one persistent data location:
`$CODEX_HOME/plugins/data/weft-codex` (normally `~/.codex/plugins/data/weft-codex`).
`WEFT_CODEX_DATA_DIR` can override it for tests/custom installations; set it
consistently for all three entrypoints. Host `PLUGIN_DATA` and Claude data variables
are intentionally ignored because skill shell commands may not receive them.
The token file is private (0600). Do not commit or share that directory.

Repository lookup starts at the working directory and uses the nearest linked
ancestor, so subdirectories of a linked repository are covered. A separate worktree
must be linked separately. Startup and status
diagnostics identify missing configuration/token instead of silently claiming sync.

Prompts, final responses and tool payloads are sent to the linked Weft service.
Credential fields and known secret formats are redacted before persistence.
Excluded file payloads, including paths inside Codex `apply_patch` commands, are
omitted; event metadata remains. `.projectmemoryignore` and `.codex/memoryignore`
use gitignore patterns. Shell commands aren't a complete file-access audit, and
pattern-based redaction cannot guarantee detection of every secret.
Memory-tool payloads are omitted to avoid recapturing retrieved memory.

## Service compatibility

New raw events use `provider: "codex"`. The service changes accompanying this
plugin advertise `supportedProviders: ["claude", "codex"]` and accept Codex evidence.
Database provider columns already store text, so no schema migration is needed
for this extension (the original raw-activity migration is still required).

Until those service changes are deployed, a successful capability response without
Codex support selects legacy pending entries tagged `provider:codex`. A 404 also
selects legacy. Authentication, network, and server failures never select fallback.
Transport is persisted per event before sending; retries never switch endpoints.
Raw retries deduplicate; legacy retries are at least once. Permanent raw rejections
move to an outbox quarantine. The legacy API's existing `claude-proposed` source
enum is retained for compatibility; provider tags and content identify Codex.

Legacy captures appear in Pending. Raw events are separate from ordinary memory
entries; the current dashboard Activity page displays audit records, not full raw
payloads. Automatic summarization is not implemented by this plugin.

## Development and tests

Shared TypeScript source and build tooling are in the sibling `weft-plugin`
package, including `src/codex/`. Do not hand-edit generated `.mjs` bundles.

```sh
cd ../weft-plugin
npm ci
npm run bundle
npm run build
npm test
npm run test:codex-cli
```

The CLI smoke test installs a copy in an isolated temporary Codex home, runs the
real Codex CLI against local deterministic Responses/Weft fixtures, and asserts
automatic prompt, tool, turn, and session-end delivery. No OpenAI model or account
is needed. It bypasses hook trust only for that isolated, test-created invocation;
normal installation requires `/hooks` review.

Official contracts: [Codex hooks](https://learn.chatgpt.com/docs/hooks) and
[plugin packaging](https://developers.openai.com/plugins/build/plugins).

## Living memory service rollout

The companion service migration `0011_supreme_misty_knight.sql` and worker must be deployed
before the new shared-context behavior is available on the hosted endpoint. The
installed plugin uses the configured hosted service; local API/model fixtures are
used only by tests. An older service retains approved-entry startup priming and
legacy pending capture, with no new task-context endpoint.

The platform summarizes events asynchronously. Generated progress is labeled as
unverified; proposed guidelines and decisions require review under Knowledge.
Corrections and archived items reach an active CLI at its next prompt. A context
receipt is acknowledged after hook stdout succeeds; this records emission, not
proof that the model used the memory. Auth or network failures leave queued events
and context cursors intact. Context fetch/ack has a four-second total deadline.
`$memory-status` reports whether the server advertises task context support.
