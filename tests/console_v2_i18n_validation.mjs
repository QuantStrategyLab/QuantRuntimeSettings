import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "../web/strategy-switch-console/frontend/node_modules/typescript/lib/typescript.js";
import { build } from "../web/strategy-switch-console/frontend/node_modules/esbuild/lib/main.js";
import { translate } from "../web/strategy-switch-console/frontend/src/locales.ts";

const root = path.resolve(import.meta.dirname, "..");
const frontend = path.join(root, "web/strategy-switch-console/frontend");

// Live dictionary: the merged zh/en tables behind src/i18n (hasTranslation).
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "v2-i18n-"));
let hasTranslation;
try {
  const outfile = path.join(directory, "i18n.cjs");
  await build({
    stdin: { resolveDir: frontend, contents: "export { hasTranslation } from './src/i18n';" },
    bundle: true, platform: "node", format: "cjs", outfile, jsx: "automatic",
    loader: { ".css": "empty" }, define: { "import.meta.env": "{}" }, logLevel: "silent",
  });
  ({ hasTranslation } = createRequire(import.meta.url)(outfile));
} finally { fs.rmSync(directory, { recursive: true, force: true }); }

function listSources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listSources(full);
    return /\.tsx$/.test(entry.name) ? [full] : [];
  });
}
const liveFiles = ["app", "pages", "components", "charts"].flatMap(dir => listSources(path.join(frontend, "src", dir)));
assert.ok(liveFiles.length > 20, "live UI sources must be discovered");

let checkedKeys = 0;
const missing = new Set();
const unwrapped = new Set();
function containsCjk(text) { return /[\u3400-\u9fff]/u.test(text); }
function visit(node) {
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "t" && node.arguments.length > 0) {
    const keyNode = node.arguments[0];
    if (ts.isStringLiteral(keyNode) || ts.isNoSubstitutionTemplateLiteral(keyNode)) {
      checkedKeys += 1;
      if (!hasTranslation(keyNode.text)) missing.add(keyNode.text);
    }
  }
  if (ts.isJsxText(node) && containsCjk(node.text.trim())) unwrapped.add(node.text.trim());
  if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer) && containsCjk(node.initializer.text)) unwrapped.add(node.initializer.text);
  ts.forEachChild(node, visit);
}
for (const file of liveFiles) visit(ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX));
assert.ok(checkedKeys > 100, `t() calls with literal keys must be discovered (found ${checkedKeys})`);
assert.deepEqual([...missing], [], `Translation keys are missing from the live i18n tables: ${[...missing].join(" | ")}`);
assert.deepEqual([...unwrapped], [], `Chinese JSX text is not routed through t(): ${[...unwrapped].join(" | ")}`);
for (const label of ["停用", "请求停用", "正在提交…", "这次停用已确认", "停用结果未知，不能再次提交"]) {
  assert.notEqual(translate(label, "en"), "Information unavailable", `runtime control label requires complete English copy: ${label}`);
}
assert.equal(translate("unknown_scope_enum", "en"), "Information unavailable", "unknown enums keep the existing fail-closed translation fallback");
console.log(`console_v2_i18n_validation: PASS (${liveFiles.length} live UI files, ${checkedKeys} keys)`);
