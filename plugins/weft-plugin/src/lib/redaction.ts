import type { IgnoreMatcher } from "./ignore.js";

export interface RedactionContext {
  ignoreMatcher: IgnoreMatcher;
  referencedPaths: string[];
}

export interface FilterResult {
  content: string;
  flagged: boolean;
  dropped?: boolean;
}

export type Filter = (input: string, ctx: RedactionContext) => FilterResult;

export const ignoreFilter: Filter = (input, ctx) => {
  if (ctx.referencedPaths.length === 0) {
    return { content: input, flagged: false };
  }
  const allIgnored = ctx.referencedPaths.every((p) => ctx.ignoreMatcher.isIgnored(p));
  if (allIgnored) return { content: input, flagged: false, dropped: true };
  return { content: input, flagged: false };
};

const SECRET_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "weft-token", re: /\b(?:pmt|sess|mlr)_[A-Za-z0-9_-]+/g },
  { name: "aws-access-key", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "github-token", re: /\bgh[posu]_[A-Za-z0-9]{36,251}\b/g },
  { name: "api-key", re: /\bapi[_-]?key\s*[=:]\s*["']?[A-Za-z0-9_\-]{16,}["']?/gi },
  { name: "bearer", re: /\bBearer\s+[A-Za-z0-9_\-\.]{20,}\b/g },
  { name: "private-key", re: /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----[\s\S]*?-----END [^-]+-----/g },
  { name: "blob", re: /\b[A-Za-z0-9+/=]{49,}\b/g },
];

export const secretRegexFilter: Filter = (input) => {
  let content = input;
  let flagged = false;
  for (const { name, re } of SECRET_PATTERNS) {
    const replaced = content.replace(re, () => {
      flagged = true;
      return `[REDACTED:${name}]`;
    });
    content = replaced;
  }
  return { content, flagged };
};

const PATH_NEEDLES = ["/secrets/", "/.env", "/credentials/", "/.ssh/"];

export const pathFilter: Filter = (input) => {
  let content = input;
  let flagged = false;
  // Match a non-whitespace token that contains any needle.
  const tokenRe = /\S+/g;
  content = content.replace(tokenRe, (tok) => {
    if (PATH_NEEDLES.some((n) => tok.includes(n))) {
      flagged = true;
      return "[redacted-path]";
    }
    return tok;
  });
  return { content, flagged };
};

const LINE_LIMIT = 2000;
const TRUNC_TAIL = "…[truncated]";

export const lineLengthFilter: Filter = (input) => {
  let flagged = false;
  const lines = input.split("\n").map((l) => {
    if (l.length > LINE_LIMIT) {
      flagged = true;
      return l.slice(0, LINE_LIMIT) + TRUNC_TAIL;
    }
    return l;
  });
  return { content: lines.join("\n"), flagged };
};

export function applyChain(content: string, ctx: RedactionContext): { content: string; flagged: boolean; dropped: boolean } {
  let cur = content;
  let flagged = false;
  for (const filter of [ignoreFilter, secretRegexFilter, pathFilter, lineLengthFilter] as Filter[]) {
    const out = filter(cur, ctx);
    if (out.dropped) return { content: cur, flagged: false, dropped: true };
    cur = out.content;
    if (out.flagged) flagged = true;
  }
  return { content: cur, flagged, dropped: false };
}
