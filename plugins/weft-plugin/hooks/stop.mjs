var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/ignore@7.0.5/node_modules/ignore/index.js
var require_ignore = __commonJS({
  "node_modules/ignore@7.0.5/node_modules/ignore/index.js"(exports, module) {
    function makeArray(subject) {
      return Array.isArray(subject) ? subject : [subject];
    }
    var UNDEFINED = void 0;
    var EMPTY = "";
    var SPACE = " ";
    var ESCAPE = "\\";
    var REGEX_TEST_BLANK_LINE = /^\s+$/;
    var REGEX_INVALID_TRAILING_BACKSLASH = /(?:[^\\]|^)\\$/;
    var REGEX_REPLACE_LEADING_EXCAPED_EXCLAMATION = /^\\!/;
    var REGEX_REPLACE_LEADING_EXCAPED_HASH = /^\\#/;
    var REGEX_SPLITALL_CRLF = /\r?\n/g;
    var REGEX_TEST_INVALID_PATH = /^\.{0,2}\/|^\.{1,2}$/;
    var REGEX_TEST_TRAILING_SLASH = /\/$/;
    var SLASH = "/";
    var TMP_KEY_IGNORE = "node-ignore";
    if (typeof Symbol !== "undefined") {
      TMP_KEY_IGNORE = /* @__PURE__ */ Symbol.for("node-ignore");
    }
    var KEY_IGNORE = TMP_KEY_IGNORE;
    var define = (object, key, value) => {
      Object.defineProperty(object, key, { value });
      return value;
    };
    var REGEX_REGEXP_RANGE = /([0-z])-([0-z])/g;
    var RETURN_FALSE = () => false;
    var sanitizeRange = (range) => range.replace(
      REGEX_REGEXP_RANGE,
      (match, from, to) => from.charCodeAt(0) <= to.charCodeAt(0) ? match : EMPTY
    );
    var cleanRangeBackSlash = (slashes) => {
      const { length } = slashes;
      return slashes.slice(0, length - length % 2);
    };
    var REPLACERS = [
      [
        // Remove BOM
        // TODO:
        // Other similar zero-width characters?
        /^\uFEFF/,
        () => EMPTY
      ],
      // > Trailing spaces are ignored unless they are quoted with backslash ("\")
      [
        // (a\ ) -> (a )
        // (a  ) -> (a)
        // (a ) -> (a)
        // (a \ ) -> (a  )
        /((?:\\\\)*?)(\\?\s+)$/,
        (_, m1, m2) => m1 + (m2.indexOf("\\") === 0 ? SPACE : EMPTY)
      ],
      // Replace (\ ) with ' '
      // (\ ) -> ' '
      // (\\ ) -> '\\ '
      // (\\\ ) -> '\\ '
      [
        /(\\+?)\s/g,
        (_, m1) => {
          const { length } = m1;
          return m1.slice(0, length - length % 2) + SPACE;
        }
      ],
      // Escape metacharacters
      // which is written down by users but means special for regular expressions.
      // > There are 12 characters with special meanings:
      // > - the backslash \,
      // > - the caret ^,
      // > - the dollar sign $,
      // > - the period or dot .,
      // > - the vertical bar or pipe symbol |,
      // > - the question mark ?,
      // > - the asterisk or star *,
      // > - the plus sign +,
      // > - the opening parenthesis (,
      // > - the closing parenthesis ),
      // > - and the opening square bracket [,
      // > - the opening curly brace {,
      // > These special characters are often called "metacharacters".
      [
        /[\\$.|*+(){^]/g,
        (match) => `\\${match}`
      ],
      [
        // > a question mark (?) matches a single character
        /(?!\\)\?/g,
        () => "[^/]"
      ],
      // leading slash
      [
        // > A leading slash matches the beginning of the pathname.
        // > For example, "/*.c" matches "cat-file.c" but not "mozilla-sha1/sha1.c".
        // A leading slash matches the beginning of the pathname
        /^\//,
        () => "^"
      ],
      // replace special metacharacter slash after the leading slash
      [
        /\//g,
        () => "\\/"
      ],
      [
        // > A leading "**" followed by a slash means match in all directories.
        // > For example, "**/foo" matches file or directory "foo" anywhere,
        // > the same as pattern "foo".
        // > "**/foo/bar" matches file or directory "bar" anywhere that is directly
        // >   under directory "foo".
        // Notice that the '*'s have been replaced as '\\*'
        /^\^*\\\*\\\*\\\//,
        // '**/foo' <-> 'foo'
        () => "^(?:.*\\/)?"
      ],
      // starting
      [
        // there will be no leading '/'
        //   (which has been replaced by section "leading slash")
        // If starts with '**', adding a '^' to the regular expression also works
        /^(?=[^^])/,
        function startingReplacer() {
          return !/\/(?!$)/.test(this) ? "(?:^|\\/)" : "^";
        }
      ],
      // two globstars
      [
        // Use lookahead assertions so that we could match more than one `'/**'`
        /\\\/\\\*\\\*(?=\\\/|$)/g,
        // Zero, one or several directories
        // should not use '*', or it will be replaced by the next replacer
        // Check if it is not the last `'/**'`
        (_, index, str) => index + 6 < str.length ? "(?:\\/[^\\/]+)*" : "\\/.+"
      ],
      // normal intermediate wildcards
      [
        // Never replace escaped '*'
        // ignore rule '\*' will match the path '*'
        // 'abc.*/' -> go
        // 'abc.*'  -> skip this rule,
        //    coz trailing single wildcard will be handed by [trailing wildcard]
        /(^|[^\\]+)(\\\*)+(?=.+)/g,
        // '*.js' matches '.js'
        // '*.js' doesn't match 'abc'
        (_, p1, p2) => {
          const unescaped = p2.replace(/\\\*/g, "[^\\/]*");
          return p1 + unescaped;
        }
      ],
      [
        // unescape, revert step 3 except for back slash
        // For example, if a user escape a '\\*',
        // after step 3, the result will be '\\\\\\*'
        /\\\\\\(?=[$.|*+(){^])/g,
        () => ESCAPE
      ],
      [
        // '\\\\' -> '\\'
        /\\\\/g,
        () => ESCAPE
      ],
      [
        // > The range notation, e.g. [a-zA-Z],
        // > can be used to match one of the characters in a range.
        // `\` is escaped by step 3
        /(\\)?\[([^\]/]*?)(\\*)($|\])/g,
        (match, leadEscape, range, endEscape, close) => leadEscape === ESCAPE ? `\\[${range}${cleanRangeBackSlash(endEscape)}${close}` : close === "]" ? endEscape.length % 2 === 0 ? `[${sanitizeRange(range)}${endEscape}]` : "[]" : "[]"
      ],
      // ending
      [
        // 'js' will not match 'js.'
        // 'ab' will not match 'abc'
        /(?:[^*])$/,
        // WTF!
        // https://git-scm.com/docs/gitignore
        // changes in [2.22.1](https://git-scm.com/docs/gitignore/2.22.1)
        // which re-fixes #24, #38
        // > If there is a separator at the end of the pattern then the pattern
        // > will only match directories, otherwise the pattern can match both
        // > files and directories.
        // 'js*' will not match 'a.js'
        // 'js/' will not match 'a.js'
        // 'js' will match 'a.js' and 'a.js/'
        (match) => /\/$/.test(match) ? `${match}$` : `${match}(?=$|\\/$)`
      ]
    ];
    var REGEX_REPLACE_TRAILING_WILDCARD = /(^|\\\/)?\\\*$/;
    var MODE_IGNORE = "regex";
    var MODE_CHECK_IGNORE = "checkRegex";
    var UNDERSCORE = "_";
    var TRAILING_WILD_CARD_REPLACERS = {
      [MODE_IGNORE](_, p1) {
        const prefix = p1 ? `${p1}[^/]+` : "[^/]*";
        return `${prefix}(?=$|\\/$)`;
      },
      [MODE_CHECK_IGNORE](_, p1) {
        const prefix = p1 ? `${p1}[^/]*` : "[^/]*";
        return `${prefix}(?=$|\\/$)`;
      }
    };
    var makeRegexPrefix = (pattern) => REPLACERS.reduce(
      (prev, [matcher, replacer]) => prev.replace(matcher, replacer.bind(pattern)),
      pattern
    );
    var isString = (subject) => typeof subject === "string";
    var checkPattern = (pattern) => pattern && isString(pattern) && !REGEX_TEST_BLANK_LINE.test(pattern) && !REGEX_INVALID_TRAILING_BACKSLASH.test(pattern) && pattern.indexOf("#") !== 0;
    var splitPattern = (pattern) => pattern.split(REGEX_SPLITALL_CRLF).filter(Boolean);
    var IgnoreRule = class {
      constructor(pattern, mark, body, ignoreCase, negative, prefix) {
        this.pattern = pattern;
        this.mark = mark;
        this.negative = negative;
        define(this, "body", body);
        define(this, "ignoreCase", ignoreCase);
        define(this, "regexPrefix", prefix);
      }
      get regex() {
        const key = UNDERSCORE + MODE_IGNORE;
        if (this[key]) {
          return this[key];
        }
        return this._make(MODE_IGNORE, key);
      }
      get checkRegex() {
        const key = UNDERSCORE + MODE_CHECK_IGNORE;
        if (this[key]) {
          return this[key];
        }
        return this._make(MODE_CHECK_IGNORE, key);
      }
      _make(mode, key) {
        const str = this.regexPrefix.replace(
          REGEX_REPLACE_TRAILING_WILDCARD,
          // It does not need to bind pattern
          TRAILING_WILD_CARD_REPLACERS[mode]
        );
        const regex = this.ignoreCase ? new RegExp(str, "i") : new RegExp(str);
        return define(this, key, regex);
      }
    };
    var createRule = ({
      pattern,
      mark
    }, ignoreCase) => {
      let negative = false;
      let body = pattern;
      if (body.indexOf("!") === 0) {
        negative = true;
        body = body.substr(1);
      }
      body = body.replace(REGEX_REPLACE_LEADING_EXCAPED_EXCLAMATION, "!").replace(REGEX_REPLACE_LEADING_EXCAPED_HASH, "#");
      const regexPrefix = makeRegexPrefix(body);
      return new IgnoreRule(
        pattern,
        mark,
        body,
        ignoreCase,
        negative,
        regexPrefix
      );
    };
    var RuleManager = class {
      constructor(ignoreCase) {
        this._ignoreCase = ignoreCase;
        this._rules = [];
      }
      _add(pattern) {
        if (pattern && pattern[KEY_IGNORE]) {
          this._rules = this._rules.concat(pattern._rules._rules);
          this._added = true;
          return;
        }
        if (isString(pattern)) {
          pattern = {
            pattern
          };
        }
        if (checkPattern(pattern.pattern)) {
          const rule = createRule(pattern, this._ignoreCase);
          this._added = true;
          this._rules.push(rule);
        }
      }
      // @param {Array<string> | string | Ignore} pattern
      add(pattern) {
        this._added = false;
        makeArray(
          isString(pattern) ? splitPattern(pattern) : pattern
        ).forEach(this._add, this);
        return this._added;
      }
      // Test one single path without recursively checking parent directories
      //
      // - checkUnignored `boolean` whether should check if the path is unignored,
      //   setting `checkUnignored` to `false` could reduce additional
      //   path matching.
      // - check `string` either `MODE_IGNORE` or `MODE_CHECK_IGNORE`
      // @returns {TestResult} true if a file is ignored
      test(path, checkUnignored, mode) {
        let ignored = false;
        let unignored = false;
        let matchedRule;
        this._rules.forEach((rule) => {
          const { negative } = rule;
          if (unignored === negative && ignored !== unignored || negative && !ignored && !unignored && !checkUnignored) {
            return;
          }
          const matched = rule[mode].test(path);
          if (!matched) {
            return;
          }
          ignored = !negative;
          unignored = negative;
          matchedRule = negative ? UNDEFINED : rule;
        });
        const ret = {
          ignored,
          unignored
        };
        if (matchedRule) {
          ret.rule = matchedRule;
        }
        return ret;
      }
    };
    var throwError = (message, Ctor) => {
      throw new Ctor(message);
    };
    var checkPath = (path, originalPath, doThrow) => {
      if (!isString(path)) {
        return doThrow(
          `path must be a string, but got \`${originalPath}\``,
          TypeError
        );
      }
      if (!path) {
        return doThrow(`path must not be empty`, TypeError);
      }
      if (checkPath.isNotRelative(path)) {
        const r = "`path.relative()`d";
        return doThrow(
          `path should be a ${r} string, but got "${originalPath}"`,
          RangeError
        );
      }
      return true;
    };
    var isNotRelative = (path) => REGEX_TEST_INVALID_PATH.test(path);
    checkPath.isNotRelative = isNotRelative;
    checkPath.convert = (p) => p;
    var Ignore = class {
      constructor({
        ignorecase = true,
        ignoreCase = ignorecase,
        allowRelativePaths = false
      } = {}) {
        define(this, KEY_IGNORE, true);
        this._rules = new RuleManager(ignoreCase);
        this._strictPathCheck = !allowRelativePaths;
        this._initCache();
      }
      _initCache() {
        this._ignoreCache = /* @__PURE__ */ Object.create(null);
        this._testCache = /* @__PURE__ */ Object.create(null);
      }
      add(pattern) {
        if (this._rules.add(pattern)) {
          this._initCache();
        }
        return this;
      }
      // legacy
      addPattern(pattern) {
        return this.add(pattern);
      }
      // @returns {TestResult}
      _test(originalPath, cache, checkUnignored, slices) {
        const path = originalPath && checkPath.convert(originalPath);
        checkPath(
          path,
          originalPath,
          this._strictPathCheck ? throwError : RETURN_FALSE
        );
        return this._t(path, cache, checkUnignored, slices);
      }
      checkIgnore(path) {
        if (!REGEX_TEST_TRAILING_SLASH.test(path)) {
          return this.test(path);
        }
        const slices = path.split(SLASH).filter(Boolean);
        slices.pop();
        if (slices.length) {
          const parent = this._t(
            slices.join(SLASH) + SLASH,
            this._testCache,
            true,
            slices
          );
          if (parent.ignored) {
            return parent;
          }
        }
        return this._rules.test(path, false, MODE_CHECK_IGNORE);
      }
      _t(path, cache, checkUnignored, slices) {
        if (path in cache) {
          return cache[path];
        }
        if (!slices) {
          slices = path.split(SLASH).filter(Boolean);
        }
        slices.pop();
        if (!slices.length) {
          return cache[path] = this._rules.test(path, checkUnignored, MODE_IGNORE);
        }
        const parent = this._t(
          slices.join(SLASH) + SLASH,
          cache,
          checkUnignored,
          slices
        );
        return cache[path] = parent.ignored ? parent : this._rules.test(path, checkUnignored, MODE_IGNORE);
      }
      ignores(path) {
        return this._test(path, this._ignoreCache, false).ignored;
      }
      createFilter() {
        return (path) => !this.ignores(path);
      }
      filter(paths) {
        return makeArray(paths).filter(this.createFilter());
      }
      // @returns {TestResult}
      test(path) {
        return this._test(path, this._testCache, true);
      }
    };
    var factory = (options) => new Ignore(options);
    var isPathValid = (path) => checkPath(path && checkPath.convert(path), path, RETURN_FALSE);
    var setupWindows = () => {
      const makePosix = (str) => /^\\\\\?\\/.test(str) || /["<>|\u0000-\u001F]+/u.test(str) ? str : str.replace(/\\/g, "/");
      checkPath.convert = makePosix;
      const REGEX_TEST_WINDOWS_PATH_ABSOLUTE = /^[a-z]:\//i;
      checkPath.isNotRelative = (path) => REGEX_TEST_WINDOWS_PATH_ABSOLUTE.test(path) || isNotRelative(path);
    };
    if (
      // Detect `process` so that it can run in browsers.
      typeof process !== "undefined" && process.platform === "win32"
    ) {
      setupWindows();
    }
    module.exports = factory;
    factory.default = factory;
    module.exports.isPathValid = isPathValid;
    define(module.exports, /* @__PURE__ */ Symbol.for("setupWindows"), setupWindows);
  }
});

// src/hooks/stop.ts
import { readFileSync as readFileSync4 } from "node:fs";
import { isAbsolute, relative } from "node:path";

// src/lib/config.ts
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, chmodSync } from "node:fs";
import { join } from "node:path";
var REPO_CONFIG_PATH = [".claude", "memory-config.json"];
var DEFAULT_BUDGET = 3e3;
function repoConfigFile(projectDir) {
  return join(projectDir, ...REPO_CONFIG_PATH);
}
function pluginDataDir() {
  const dir = process.env.CLAUDE_PLUGIN_DATA;
  if (!dir) throw new Error("CLAUDE_PLUGIN_DATA env var not set");
  return dir;
}
function tokensFile() {
  return join(pluginDataDir(), "tokens.json");
}
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}
async function loadLinkedProject(projectDir) {
  const repo = readJson(repoConfigFile(projectDir));
  if (!repo || !repo.project_id || !repo.server) return null;
  const tokens = readJson(tokensFile()) ?? {};
  const token = tokens[repo.project_id];
  if (!token) return null;
  return {
    projectId: repo.project_id,
    token,
    server: repo.server,
    primingTokenBudget: repo.priming_token_budget ?? DEFAULT_BUDGET,
    captureFileEdits: repo.capture_file_edits ?? false,
    gitCommitMinMessageChars: repo.git_commit_min_message_chars ?? 12
  };
}

// src/lib/repo-hash.ts
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
function repoHash(absolutePath) {
  const real = (() => {
    try {
      return realpathSync(absolutePath);
    } catch {
      return absolutePath;
    }
  })();
  return createHash("sha256").update(real).digest("hex").slice(0, 16);
}

// src/lib/buffer.ts
import {
  mkdirSync as mkdirSync2,
  appendFileSync,
  readFileSync as readFileSync2,
  writeFileSync as writeFileSync2,
  statSync,
  existsSync as existsSync2,
  renameSync
} from "node:fs";
import { join as join2 } from "node:path";
function pluginDataDir2() {
  const d = process.env.CLAUDE_PLUGIN_DATA;
  if (!d) throw new Error("CLAUDE_PLUGIN_DATA env var not set");
  return d;
}
function bufferPathFor(repoHash2) {
  return join2(pluginDataDir2(), "buffers", `${repoHash2}.jsonl`);
}
async function appendRecord(repoHash2, record) {
  const path = bufferPathFor(repoHash2);
  mkdirSync2(join2(pluginDataDir2(), "buffers"), { recursive: true });
  appendFileSync(path, JSON.stringify(record) + "\n", "utf8");
}
async function rewriteBuffer(repoHash2, keep) {
  const path = bufferPathFor(repoHash2);
  mkdirSync2(join2(pluginDataDir2(), "buffers"), { recursive: true });
  const tmp = path + ".tmp";
  const body = keep.map((r) => JSON.stringify(r)).join("\n") + (keep.length ? "\n" : "");
  writeFileSync2(tmp, body, "utf8");
  renameSync(tmp, path);
}

// src/hooks/stop.ts
import { existsSync as existsSync4 } from "node:fs";

// src/lib/redaction.ts
var ignoreFilter = (input, ctx) => {
  if (ctx.referencedPaths.length === 0) {
    return { content: input, flagged: false };
  }
  const allIgnored = ctx.referencedPaths.every((p) => ctx.ignoreMatcher.isIgnored(p));
  if (allIgnored) return { content: input, flagged: false, dropped: true };
  return { content: input, flagged: false };
};
var SECRET_PATTERNS = [
  { name: "aws-access-key", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "github-token", re: /\bgh[posu]_[A-Za-z0-9]{36,251}\b/g },
  { name: "api-key", re: /\bapi[_-]?key\s*[=:]\s*["']?[A-Za-z0-9_\-]{16,}["']?/gi },
  { name: "bearer", re: /\bBearer\s+[A-Za-z0-9_\-\.]{20,}\b/g },
  { name: "private-key", re: /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----[\s\S]*?-----END [^-]+-----/g },
  { name: "blob", re: /\b[A-Za-z0-9+/=]{49,}\b/g }
];
var secretRegexFilter = (input) => {
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
var PATH_NEEDLES = ["/secrets/", "/.env", "/credentials/", "/.ssh/"];
var pathFilter = (input) => {
  let content = input;
  let flagged = false;
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
var LINE_LIMIT = 2e3;
var TRUNC_TAIL = "\u2026[truncated]";
var lineLengthFilter = (input) => {
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
function applyChain(content, ctx) {
  let cur = content;
  let flagged = false;
  for (const filter of [ignoreFilter, secretRegexFilter, pathFilter, lineLengthFilter]) {
    const out = filter(cur, ctx);
    if (out.dropped) return { content: cur, flagged: false, dropped: true };
    cur = out.content;
    if (out.flagged) flagged = true;
  }
  return { content: cur, flagged, dropped: false };
}

// src/lib/ignore.ts
var import_ignore = __toESM(require_ignore(), 1);
import { readFileSync as readFileSync3, existsSync as existsSync3 } from "node:fs";
import { join as join3 } from "node:path";
var PROJECT_FILE = [".projectmemoryignore"];
var DEV_FILE = [".claude", "memoryignore"];
function readPatterns(filePath) {
  if (!existsSync3(filePath)) return [];
  return readFileSync3(filePath, "utf8").split("\n").map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith("#"));
}
function expandNegations(patterns) {
  const expanded = [];
  for (const p of patterns) {
    expanded.push(p);
    if (p.startsWith("!") && (p.endsWith("/**") || p.endsWith("/*"))) {
      const dir = p.slice(1, p.lastIndexOf("/"));
      if (dir) expanded.push("!" + dir);
    }
  }
  return expanded;
}
function loadIgnoreMatcher(repoDir) {
  const projectPatterns = readPatterns(join3(repoDir, ...PROJECT_FILE));
  const devPatterns = readPatterns(join3(repoDir, ...DEV_FILE));
  const patterns = [...projectPatterns, ...devPatterns];
  const ig = (0, import_ignore.default)().add(expandNegations(patterns));
  return {
    patterns,
    isIgnored: (path) => ig.ignores(path)
  };
}

// src/lib/logging.ts
import { mkdirSync as mkdirSync3, appendFileSync as appendFileSync2, readdirSync, statSync as statSync2, unlinkSync } from "node:fs";
import { join as join4 } from "node:path";
var RETENTION_MS = 7 * 24 * 60 * 60 * 1e3;
function pruneOldLogs(logsDir) {
  let entries;
  try {
    entries = readdirSync(logsDir);
  } catch {
    return;
  }
  const cutoff = Date.now() - RETENTION_MS;
  for (const e of entries) {
    if (!e.endsWith(".log")) continue;
    const full = join4(logsDir, e);
    try {
      if (statSync2(full).mtimeMs < cutoff) unlinkSync(full);
    } catch {
    }
  }
}
function createLogger(baseDir) {
  const logsDir = join4(baseDir, "logs");
  try {
    mkdirSync3(logsDir, { recursive: true });
  } catch {
  }
  pruneOldLogs(logsDir);
  function write(level, event, fields) {
    const line = JSON.stringify({ time: (/* @__PURE__ */ new Date()).toISOString(), level, event, ...fields ?? {} }) + "\n";
    const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    try {
      appendFileSync2(join4(logsDir, `${today}.log`), line, { encoding: "utf8" });
    } catch {
    }
  }
  return {
    debug: (e, f) => write("debug", e, f),
    info: (e, f) => write("info", e, f),
    warn: (e, f) => write("warn", e, f),
    error: (e, f) => write("error", e, f)
  };
}

// src/hooks/stop.ts
var log = createLogger(process.env.CLAUDE_PLUGIN_DATA ?? "/tmp");
function readStdin() {
  try {
    return readFileSync4(0, "utf8");
  } catch {
    return "";
  }
}
function readAllRecords(repoHashStr) {
  const path = bufferPathFor(repoHashStr);
  if (!existsSync4(path)) return [];
  return readFileSync4(path, "utf8").split("\n").filter(Boolean).map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  }).filter((r) => r !== null);
}
function topDir(p) {
  const i = p.indexOf("/");
  return i < 0 ? "(root)" : p.slice(0, i);
}
async function main() {
  const projectDir = process.env.CLAUDE_PROJECT_DIR;
  if (!projectDir) {
    process.exit(0);
  }
  const linked = await loadLinkedProject(projectDir);
  if (!linked) {
    process.exit(0);
  }
  const input = (() => {
    try {
      return JSON.parse(readStdin());
    } catch {
      return {};
    }
  })();
  const sessionId = input.session_id ?? "unknown";
  const hash = repoHash(projectDir);
  const allRecords = readAllRecords(hash);
  const edits = allRecords.filter((r) => r.kind === "edit" && r.session_id === sessionId);
  if (edits.length === 0) {
    process.exit(0);
  }
  const others = allRecords.filter((r) => !(r.kind === "edit" && r.session_id === sessionId));
  if (!linked.captureFileEdits) {
    await rewriteBuffer(hash, others);
    log.info("hook.stop.cleared_disabled", { dropped: edits.length });
    process.exit(0);
  }
  const paths = Array.from(
    new Set(edits.map((e) => isAbsolute(e.path) ? relative(projectDir, e.path) : e.path))
  );
  const dirCounts = /* @__PURE__ */ new Map();
  for (const p of paths) {
    const d = topDir(p);
    dirCounts.set(d, (dirCounts.get(d) ?? 0) + 1);
  }
  const topDirs = [...dirCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([d, n]) => `${d} (${n})`).join(", ");
  const fileSummary = paths.length <= 15 ? paths.join(", ") : `${paths.slice(0, 15).join(", ")}, \u2026`;
  const content = `Edited ${paths.length} files across ${dirCounts.size} directories: ${topDirs}.
Files: ${fileSummary}.`;
  const ig = loadIgnoreMatcher(projectDir);
  const out = applyChain(content, { ignoreMatcher: ig, referencedPaths: paths });
  await rewriteBuffer(hash, others);
  if (out.dropped) {
    log.info("hook.stop.dropped", { reason: "all_paths_ignored" });
    process.exit(0);
  }
  const id = "buf_" + Math.random().toString(36).slice(2, 18).padEnd(16, "0");
  await appendRecord(hash, {
    kind: "candidate",
    id,
    session_id: sessionId,
    category: "active-work",
    source: "file-change",
    content: out.content,
    tags: ["file-change"],
    namespace: null,
    redactionApplied: out.flagged,
    ts: (/* @__PURE__ */ new Date()).toISOString()
  });
  log.info("hook.stop.rolled_up", { id, paths: paths.length });
  process.exit(0);
}
main().catch((e) => {
  log.error("hook.stop.uncaught", { error: e?.message ?? String(e) });
  process.exit(0);
});
