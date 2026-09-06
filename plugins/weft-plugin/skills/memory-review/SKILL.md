---
name: memory-review
description: Walk pending captured memory candidates one at a time and approve / send to dashboard / discard / edit each.
argument-hint: "(no arguments)"
disable-model-invocation: true
user-invocable: true
allowed-tools: "Bash"
---

!`node ${CLAUDE_PLUGIN_ROOT}/commands/review.mjs`
