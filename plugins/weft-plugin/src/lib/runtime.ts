// Selected when bundling; a Claude installation can never switch provider via env.
declare const __WEFT_CODEX__: boolean;
export const isCodex = typeof __WEFT_CODEX__ !== "undefined" && __WEFT_CODEX__;
export const provider = isCodex ? "codex" : "claude";
export const configDirectory = isCodex ? ".codex" : ".claude";
export const linkCommand = isCodex ? "$memory-link" : "/weft-plugin:memory-link";
