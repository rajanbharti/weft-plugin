import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";

/** Stable per-repo identifier used to key buffer files. */
export function repoHash(absolutePath: string): string {
  const real = (() => {
    try { return realpathSync(absolutePath); }
    catch { return absolutePath; }
  })();
  return createHash("sha256").update(real).digest("hex").slice(0, 16);
}
