---
name: memory-link
description: Link this repo to a shared project memory service. Usage: /memory-link <project-id> <token>
argument-hint: "<project-id> <token>"
disable-model-invocation: true
user-invocable: true
allowed-tools: "Bash"
---

!`node ${CLAUDE_PLUGIN_ROOT}/commands/link.mjs "$ARGUMENTS[0]" "$ARGUMENTS[1]"`
