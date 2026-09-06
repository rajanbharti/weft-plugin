---
name: memory-unlink
description: Remove this repo's link to a shared project memory. No server state changes; only local config is removed.
argument-hint: "(no arguments)"
disable-model-invocation: true
user-invocable: true
allowed-tools: "Bash"
---

!`node ${CLAUDE_PLUGIN_ROOT}/commands/unlink.mjs`
