---
name: memory-search
description: Search this project's shared memory for relevant entries. Usage: /memory-search <query>
argument-hint: "<query>"
disable-model-invocation: true
user-invocable: true
allowed-tools: "Bash"
---

!`node ${CLAUDE_PLUGIN_ROOT}/commands/search.mjs "$ARGUMENTS"`
