#!/usr/bin/env node
/**
 * Structural check for the WordPress plugin.
 *
 *   npm run wp:lint
 *
 * The honest framing: this is NOT a PHP parser and NOT a substitute for
 * `php -l`. It is a character-level state machine that understands PHP strings,
 * comments, heredoc-free HTML/PHP boundaries and bracket nesting, so it catches
 * the mistakes that actually happen when editing PHP by hand — an unbalanced
 * brace, a missing `ABSPATH` guard, a raw superglobal read.
 *
 * Run `php -l` on a machine with PHP before shipping a release.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const pluginDir = path.join(root, "wordpress-plugin", "leadforge-connector");

/** Walks PHP source, tracking strings/comments/HTML so delimiters inside them are ignored. */
function analyse(source, file) {
  const problems = [];
  const stack = [];
  const pairs = { "{": "}", "(": ")", "[": "]" };
  const closers = { "}": "{", ")": "(", "]": "[" };

  let state = "code";
  let line = 1;
  let phpDepth = 0; // 0 = outer HTML, >0 = inside <?php ... ?>

  const open = (char, at) => stack.push({ char, line: at });
  const close = (char, at) => {
    const top = stack.pop();
    if (!top) {
      problems.push(`line ${at}: closing "${char}" with nothing open`);
      return;
    }
    if (pairs[top.char] !== char) {
      problems.push(`line ${at}: expected "${pairs[top.char]}" to close the "${top.char}" opened on line ${top.line}, found "${char}"`);
    }
  };

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];
    if (char === "\n") line += 1;

    if (state === "code") {
      // PHP open/close tags: outside <?php ... ?> the content is HTML and must be ignored.
      if (char === "<" && source.slice(i, i + 5) === "<?php") {
        phpDepth += 1;
        i += 4;
        continue;
      }
      if (phpDepth === 0) continue; // plain HTML — not our business
      if (char === "?" && next === ">") {
        phpDepth -= 1;
        i += 1;
        continue;
      }
      if (char === "'" || char === '"') {
        state = char === "'" ? "single" : "double";
        continue;
      }
      if (char === "/" && next === "/") {
        state = "lineComment";
        i += 1;
        continue;
      }
      if (char === "#") {
        state = "lineComment";
        continue;
      }
      if (char === "/" && next === "*") {
        state = "blockComment";
        i += 1;
        continue;
      }
      if (pairs[char]) {
        open(char, line);
        continue;
      }
      if (closers[char]) {
        close(char, line);
        continue;
      }
      continue;
    }

    if (state === "single" || state === "double") {
      if (char === "\\") {
        i += 1; // skip the escaped character, whatever it is
        continue;
      }
      if ((state === "single" && char === "'") || (state === "double" && char === '"')) {
        state = "code";
      }
      continue;
    }

    if (state === "lineComment") {
      if (char === "\n") state = "code";
      else if (char === "?" && next === ">") {
        // A close tag ends the comment too.
        phpDepth -= 1;
        state = "code";
        i += 1;
      }
      continue;
    }

    if (state === "blockComment" && char === "*" && next === "/") {
      state = "code";
      i += 1;
    }
  }

  if (state === "single" || state === "double") problems.push(`unterminated ${state} quoted string`);
  if (state === "blockComment") problems.push("unterminated /* block comment");
  stack.forEach((entry) => problems.push(`"${entry.char}" opened on line ${entry.line} was never closed`));

  if (!/WP_UNINSTALL_PLUGIN/.test(source) && !/defined\(\s*'ABSPATH'\s*\)/.test(source)) {
    problems.push("missing direct-access guard (defined('ABSPATH') || exit;)");
  }
  if (/\$_+(GET|POST|REQUEST|COOKIE|SERVER)\s*\[/.test(source)) {
    problems.push("reads a raw superglobal — use a WordPress helper (get_option, shortcode attributes, wp_unslash + sanitize_*)");
  }

  return problems;
}

function main() {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".php")) files.push(full);
    }
  };

  if (!fs.existsSync(pluginDir)) throw new Error(`Plugin not found at ${pluginDir}`);
  walk(pluginDir);

  let failures = 0;
  for (const file of files.sort()) {
    const problems = analyse(fs.readFileSync(file, "utf8"), file);
    const relative = path.relative(root, file);
    if (problems.length === 0) {
      console.log(`  ok    ${relative}`);
    } else {
      failures += problems.length;
      console.log(`  FAIL  ${relative}`);
      problems.forEach((problem) => console.log(`        · ${problem}`));
    }
  }

  console.log(
    `\n${files.length} PHP file(s) checked, ${failures} structural problem(s).` +
      `\nThis is a heuristic check, not a PHP parser — run \`php -l\` before publishing a release.`,
  );
  process.exitCode = failures ? 1 : 0;
}

main();
