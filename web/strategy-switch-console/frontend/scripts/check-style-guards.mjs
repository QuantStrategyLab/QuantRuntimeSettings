// Flat-design style guards for the console CSS (rules: docs/console-information-design.zh-CN.md, #1034).
// Warn-only by default: prints violations and exits 0. Pass --strict to exit 1 on any violation.
// Other flags: --markdown (grouped report for a PR body), --json.
// The dead legacy file src/styles.css is skipped; P0-2 deletes it.
import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const LEGACY_ALIASES = [
  "surface-default", "surface-subtle", "border-divider", "border-control", "status-attention",
  "status-blocked", "status-verified", "accent-foreground", "canvas", "ink", "muted", "line",
  "up-green", "down-green", "shadow", "surface", "radius-m",
];
const ALIAS_RE = new RegExp(`--(?:${LEGACY_ALIASES.join("|")})(?![\\w-])`);
const SKIP_FILES = new Set(["src/styles.css"]);
const COLOR_FILES = new Set(["tokens.css"]);
// Date matrices are not blocks, so repeat(7, ...) is allowed on calendar month grids.
const GRID_ALLOW_SELECTOR = /calendar-month|calendar-grid|month-matrix/;

export const RULES = {
  "color-literal": "colour literal outside tokens.css (use a token)",
  "box-shadow": "box-shadow outside :focus-visible (flat design: no shadows)",
  gradient: "gradient (flat design: solid fills only)",
  "border-1px": "1px border (use the 0.5px hairline token)",
  "font-size-px": "literal px font size (use a type token)",
  "grid-columns": "repeat(N > 4) grid (max 4 boxes per row)",
  "legacy-token": "legacy token alias or --benchmark-N (use the canonical token)",
};

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
}

/** Flat list of declarations with their selector chain and 1-based line. */
export function parseDeclarations(source) {
  const text = stripComments(source);
  const out = [];
  const stack = [];
  let buf = "";
  let line = 1;
  let bufLine = 1;
  const flushDecls = (chunk, startLine) => {
    let l = startLine;
    for (const part of chunk.split(";")) {
      const lead = part.match(/^\s*/)[0];
      l += (lead.match(/\n/g) || []).length;
      const decl = part.trim();
      const idx = decl.indexOf(":");
      if (idx > 0) out.push({ selector: stack.join(" "), prop: decl.slice(0, idx).trim().toLowerCase(), value: decl.slice(idx + 1).trim(), line: l });
      l += (part.slice(lead.length).match(/\n/g) || []).length;
    }
  };
  for (const ch of text) {
    if (ch === "{") {
      stack.push(buf.trim().replace(/\s+/g, " "));
      buf = "";
      bufLine = line;
    } else if (ch === "}") {
      flushDecls(buf, bufLine);
      stack.pop();
      buf = "";
      bufLine = line;
    } else {
      buf += ch;
    }
    if (ch === "\n") line += 1;
  }
  return out;
}

export function checkCss(source, file = "x.css") {
  const base = file.split("/").pop();
  const found = [];
  const add = (rule, d) => found.push({ rule, file, line: d.line, selector: d.selector, text: `${d.prop}: ${d.value}` });
  for (const d of parseDeclarations(source)) {
    const { prop, value } = d;
    if (!COLOR_FILES.has(base) && /#[0-9a-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\(/i.test(value)) add("color-literal", d);
    if (prop === "box-shadow" && !/:focus-visible/.test(d.selector) && !/^(none|0)$/.test(value)) add("box-shadow", d);
    if (/gradient\(/i.test(value)) add("gradient", d);
    if (/^border(-(top|right|bottom|left|inline|block)(-(start|end))?)?(-width)?$/.test(prop) && /(?<![\d.])1px/.test(value)) add("border-1px", d);
    if (prop === "font-size" && /(?<![\w.-])\d*\.?\d+px/.test(value)) add("font-size-px", d);
    if (/^grid-template(-columns)?$/.test(prop) && !GRID_ALLOW_SELECTOR.test(d.selector)) {
      for (const m of value.matchAll(/repeat\(\s*(\d+)\s*,/g)) if (Number(m[1]) > 4) add("grid-columns", d);
    }
    if (ALIAS_RE.test(prop) || ALIAS_RE.test(value) || /--benchmark-\d/.test(prop + value)) add("legacy-token", d);
  }
  return found;
}

async function listCss(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listCss(p)));
    else if (e.name.endsWith(".css")) out.push(p);
  }
  return out.sort();
}

export async function runGuards(root) {
  const violations = [];
  for (const p of await listCss(join(root, "src"))) {
    const rel = relative(root, p).split("\\").join("/");
    if (SKIP_FILES.has(rel)) continue;
    violations.push(...checkCss(await readFile(p, "utf8"), rel));
  }
  return violations;
}

function summarize(violations) {
  const byRule = {};
  const byFile = {};
  for (const v of violations) {
    byRule[v.rule] = (byRule[v.rule] || 0) + 1;
    (byFile[v.file] ||= {})[v.rule] = (byFile[v.file][v.rule] || 0) + 1;
  }
  return { byRule, byFile };
}

function markdown(violations) {
  const { byRule, byFile } = summarize(violations);
  const rules = Object.keys(RULES);
  const lines = [`Total: ${violations.length}`, "", `| File | ${rules.join(" | ")} | Total |`, `| --- | ${rules.map(() => "---:").join(" | ")} | ---: |`];
  for (const [f, c] of Object.entries(byFile)) {
    lines.push(`| ${f} | ${rules.map((r) => c[r] || 0).join(" | ")} | ${Object.values(c).reduce((a, b) => a + b, 0)} |`);
  }
  lines.push(`| **All** | ${rules.map((r) => byRule[r] || 0).join(" | ")} | ${violations.length} |`);
  return lines.join("\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = new Set(process.argv.slice(2));
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const violations = await runGuards(root);
  if (args.has("--json")) console.log(JSON.stringify(violations, null, 2));
  else if (args.has("--markdown")) console.log(markdown(violations));
  else {
    const gha = process.env.GITHUB_ACTIONS === "true";
    for (const v of violations) {
      const path = `web/strategy-switch-console/frontend/${v.file}`;
      console.log(gha ? `::warning file=${path},line=${v.line},title=style-guard ${v.rule}::${RULES[v.rule]}: ${v.text}` : `${path}:${v.line} [${v.rule}] ${v.text}`);
    }
    const { byRule } = summarize(violations);
    console.log(`\nstyle guards: ${violations.length} violation(s) ${args.has("--strict") ? "(strict)" : "(warn-only)"}`);
    for (const r of Object.keys(RULES)) console.log(`  ${r}: ${byRule[r] || 0}`);
  }
  if (args.has("--strict") && violations.length) process.exit(1);
}
