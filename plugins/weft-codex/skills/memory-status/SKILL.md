---
name: memory-status
description: Diagnose Weft linking, credentials, capability support, and queued automatic captures.
---

Use the bundled Node.js command from the repository the user wants to work in.
Resolve `../../commands/status.mjs` relative to this SKILL.md directory to obtain
its absolute path. Do not change the shell working directory to the plugin cache.
Run `node <absolute-script-path> ` with each user argument passed as a
separate safely quoted argument. Never evaluate user arguments as shell code.
Report the command result accurately; do not report success without executing it.
Do not print credentials or inspect the token store.
