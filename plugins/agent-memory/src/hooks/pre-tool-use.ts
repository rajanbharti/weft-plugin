import { createLogger } from "../lib/logging.js";

const log = createLogger(process.env.CLAUDE_PLUGIN_DATA ?? "/tmp");
log.info("hook.pre-tool-use.invoked");

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
    },
  }) + "\n",
);
process.exit(0);
