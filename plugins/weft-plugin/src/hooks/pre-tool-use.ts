import { pluginDataDir } from "../lib/data-dir.js";
import { createLogger } from "../lib/logging.js";

const log = createLogger(pluginDataDir());
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
