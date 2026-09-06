---
name: memory-recent
description: Show the most recent approved entries in this project's shared memory. Usage: /memory-recent [limit]
argument-hint: "[limit]"
disable-model-invocation: true
user-invocable: true
allowed-tools: "Bash"
---

!`node ${CLAUDE_PLUGIN_ROOT}/commands/recent.mjs "$ARGUMENTS[0]"`
