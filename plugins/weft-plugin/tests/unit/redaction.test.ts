import { describe, it, expect } from "vitest";
import {
  ignoreFilter, secretRegexFilter, pathFilter, lineLengthFilter, applyChain,
} from "../../src/lib/redaction.js";
import type { IgnoreMatcher } from "../../src/lib/ignore.js";

const noopIgnore: IgnoreMatcher = { isIgnored: () => false, patterns: [] };

describe("ignoreFilter", () => {
  it("drops candidate when every referenced path is ignored", () => {
    const ig: IgnoreMatcher = { isIgnored: (p) => p.startsWith("secrets/"), patterns: ["secrets/**"] };
    const out = ignoreFilter("anything", { ignoreMatcher: ig, referencedPaths: ["secrets/a", "secrets/b"] });
    expect(out.dropped).toBe(true);
  });

  it("passes through when at least one path is not ignored", () => {
    const ig: IgnoreMatcher = { isIgnored: (p) => p === "secrets/a", patterns: ["secrets/a"] };
    const out = ignoreFilter("hello", { ignoreMatcher: ig, referencedPaths: ["secrets/a", "src/app.ts"] });
    expect(out.dropped).toBeFalsy();
    expect(out.content).toBe("hello");
  });

  it("passes through when no paths referenced", () => {
    const out = ignoreFilter("hello", { ignoreMatcher: noopIgnore, referencedPaths: [] });
    expect(out.dropped).toBeFalsy();
  });
});

// Fixtures are assembled from fragments rather than written as literals: a
// whole key-shaped string in the file trips GitHub push protection and every
// scanner a contributor runs, even though these are invented values.
const FAKE_AWS_KEY = "AKIA" + "ABCDEFGHIJKLMNOP";
const FAKE_TOKEN_BODY = "abcdefghijklmnopqrstuvwxyz" + "0123456789" + "ABCD";

describe("secretRegexFilter", () => {
  const ctx = { ignoreMatcher: noopIgnore, referencedPaths: [] };

  it("redacts AWS access keys", () => {
    const out = secretRegexFilter(`token ${FAKE_AWS_KEY} done`, ctx);
    expect(out.flagged).toBe(true);
    expect(out.content).toContain("[REDACTED:");
    expect(out.content).not.toContain(FAKE_AWS_KEY);
  });

  it("redacts GitHub tokens (ghp_ / gho_ / ghs_)", () => {
    for (const prefix of ["ghp_", "gho_", "ghs_"]) {
      const tok = prefix + FAKE_TOKEN_BODY;
      const out = secretRegexFilter(`token ${tok} end`, ctx);
      expect(out.flagged).toBe(true);
      expect(out.content).not.toContain(tok);
    }
  });

  it("redacts generic api_key=...", () => {
    const out = secretRegexFilter('api_key="abcdef0123456789abcdef"', ctx);
    expect(out.flagged).toBe(true);
    expect(out.content).toContain("[REDACTED:");
  });

  it("redacts Bearer tokens", () => {
    const out = secretRegexFilter("Authorization: Bearer abcdef0123456789abcdef", ctx);
    expect(out.flagged).toBe(true);
    expect(out.content).not.toContain("abcdef0123456789abcdef");
  });

  it("redacts PEM private key blocks", () => {
    const blob = "-----BEGIN RSA PRIVATE KEY-----\nMIICXQIBAAKBgQ\n-----END RSA PRIVATE KEY-----";
    const out = secretRegexFilter(`prefix ${blob} suffix`, ctx);
    expect(out.flagged).toBe(true);
    expect(out.content).toContain("[REDACTED:");
  });

  it("redacts long base64-like blobs", () => {
    const blob = "A".repeat(60);
    const out = secretRegexFilter(`token ${blob} end`, ctx);
    expect(out.flagged).toBe(true);
  });

  it("does not flag normal content", () => {
    const out = secretRegexFilter("Refactored auth middleware to use JWT.", ctx);
    expect(out.flagged).toBe(false);
    expect(out.content).toBe("Refactored auth middleware to use JWT.");
  });
});

describe("pathFilter", () => {
  const ctx = { ignoreMatcher: noopIgnore, referencedPaths: [] };

  it("redacts paths containing /secrets/", () => {
    const out = pathFilter("Updated /home/me/secrets/keys.json today", ctx);
    expect(out.flagged).toBe(true);
    expect(out.content).toContain("[redacted-path]");
    expect(out.content).not.toContain("secrets/keys.json");
  });

  it("redacts /.env, /credentials/, /.ssh/", () => {
    for (const seg of ["/.env", "/credentials/x", "/.ssh/id_rsa"]) {
      const out = pathFilter(`see /home/me${seg} for details`, ctx);
      expect(out.flagged).toBe(true);
      expect(out.content).toContain("[redacted-path]");
    }
  });

  it("does not flag normal text", () => {
    const out = pathFilter("Edited src/auth/middleware.ts in the repo.", ctx);
    expect(out.flagged).toBe(false);
  });
});

describe("lineLengthFilter", () => {
  const ctx = { ignoreMatcher: noopIgnore, referencedPaths: [] };

  it("truncates lines longer than 2000 chars", () => {
    const long = "x".repeat(2500);
    const out = lineLengthFilter(`prefix\n${long}\nsuffix`, ctx);
    const lines = out.content.split("\n");
    expect(lines[1].length).toBeLessThanOrEqual(2000 + "…[truncated]".length);
    expect(lines[1].endsWith("…[truncated]")).toBe(true);
    expect(lines[0]).toBe("prefix");
    expect(lines[2]).toBe("suffix");
  });

  it("leaves short lines alone", () => {
    const out = lineLengthFilter("a\nb\nc", ctx);
    expect(out.content).toBe("a\nb\nc");
    expect(out.flagged).toBe(false);
  });
});

describe("applyChain", () => {
  it("composes all filters and reports flagged when any filter flags", () => {
    const out = applyChain(
      `Found ${FAKE_AWS_KEY} in /home/me/.ssh/config`,
      { ignoreMatcher: noopIgnore, referencedPaths: [] },
    );
    expect(out.dropped).toBe(false);
    expect(out.flagged).toBe(true);
    expect(out.content).not.toContain(FAKE_AWS_KEY);
    expect(out.content).toContain("[redacted-path]");
  });

  it("short-circuits when ignoreFilter drops", () => {
    const ig: IgnoreMatcher = { isIgnored: () => true, patterns: ["**"] };
    const out = applyChain("x", { ignoreMatcher: ig, referencedPaths: ["a"] });
    expect(out.dropped).toBe(true);
  });
});
