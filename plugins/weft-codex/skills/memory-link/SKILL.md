---
name: memory-link
description: Link this working directory to hosted Weft when the user asks to connect project memory.
---

Use the bundled Node.js command from the repository the user wants to work in.
Resolve `../../commands/link.mjs` relative to this SKILL.md directory to obtain
its absolute path. Do not change the shell working directory to the plugin cache.
Run `node <absolute-script-path> <project-id> <token>` with each user argument passed as a
separate safely quoted argument. Never evaluate user arguments as shell code.
Report the command result accurately; do not report success without executing it.
Do not print credentials or inspect the token store.

The command stores .codex/memory-config.json in the current repository and a private token outside it. After linking, use $memory-status. Automatic capture also requires trusting the installed hooks in Codex /hooks.
