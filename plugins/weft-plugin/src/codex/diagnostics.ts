import { PluginError, UnexpectedStatusError, TokenInvalidError } from "../lib/errors.js";

/** Never log exception messages: HTTP bodies and URLs may contain credentials. */
export function safeError(error: unknown) {
  return {
    code: error instanceof PluginError ? error.code : "capture_failed",
    ...(error instanceof UnexpectedStatusError ? { status: error.status } : {}),
    ...(error instanceof TokenInvalidError ? { status: 401 } : {}),
  };
}
