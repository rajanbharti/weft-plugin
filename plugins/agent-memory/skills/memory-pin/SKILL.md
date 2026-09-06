---
name: memory-pin
description: Pin an approved entry so it appears in SessionStart priming. Usage: /memory-pin <entry-id>
argument-hint: "<entry-id>"
disable-model-invocation: true
user-invocable: true
allowed-tools: "Bash"
---

!`node ${CLAUDE_PLUGIN_ROOT}/commands/pin.mjs "$ARGUMENTS[0]"`
