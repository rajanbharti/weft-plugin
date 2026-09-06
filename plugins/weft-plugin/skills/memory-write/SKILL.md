---
name: memory-write
description: Create a new approved decision entry in this project's shared memory. Usage: /memory-write <content>
argument-hint: "<content>"
disable-model-invocation: true
user-invocable: true
allowed-tools: "Bash"
---

!`node ${CLAUDE_PLUGIN_ROOT}/commands/write.mjs "$ARGUMENTS"`
