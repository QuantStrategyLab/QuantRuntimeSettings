import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "../web/strategy-switch-console/frontend/node_modules/typescript/lib/typescript.js";

const root = path.resolve(import.meta.dirname, "..");
const appPath = path.join(root, "web/strategy-switch-console/frontend/src/App.tsx");
const localePath = path.join(root, "web/strategy-switch-console/frontend/src/locales.ts");
const appText = fs.readFileSync(appPath, "utf8");
const localeText = fs.readFileSync(localePath, "utf8");
const app = ts.createSourceFile(appPath, appText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const locale = ts.createSourceFile(localePath, localeText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

let dictionary;
function findDictionary(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(locale) === "EN_COPY" && node.initializer && ts.isAsExpression(node.initializer) && ts.isObjectLiteralExpression(node.initializer.expression)) dictionary = node.initializer.expression;
  ts.forEachChild(node, findDictionary);
}
findDictionary(locale);
assert.ok(dictionary, "typed English locale dictionary must exist");
const keys = new Set(dictionary.properties.filter(ts.isPropertyAssignment).map(property => property.name && (ts.isStringLiteral(property.name) || ts.isIdentifier(property.name)) ? property.name.text : ""));
const missing = new Set();
const unwrapped = new Set();
const unmappedStatusLabels = new Set();
function containsCjk(text) { return /[\u3400-\u9fff]/u.test(text); }
function inspectStatusMap(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(app) === "labels" && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
    for (const property of node.initializer.properties) {
      if (!ts.isPropertyAssignment(property) || !ts.isStringLiteral(property.initializer) || !containsCjk(property.initializer.text)) continue;
      if (!keys.has(property.initializer.text)) unmappedStatusLabels.add(property.initializer.text);
    }
  }
  ts.forEachChild(node, inspectStatusMap);
}
const statusFunction = app.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "displayStatus");
if (statusFunction) inspectStatusMap(statusFunction);
function visit(node) {
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ["t", "copy"].includes(node.expression.text) && node.arguments.length > 0) {
    const keyNode = node.arguments[0];
    if (ts.isStringLiteral(keyNode) || ts.isNoSubstitutionTemplateLiteral(keyNode)) if (!keys.has(keyNode.text)) missing.add(keyNode.text);
  }
  if (ts.isJsxText(node) && containsCjk(node.text.trim())) unwrapped.add(node.text.trim());
  if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer) && containsCjk(node.initializer.text)) unwrapped.add(node.initializer.text);
  ts.forEachChild(node, visit);
}
visit(app);
assert.deepEqual([...missing], [], `Translation keys are missing from EN_COPY: ${[...missing].join(" | ")}`);
assert.deepEqual([...unwrapped], [], `Chinese JSX text is not routed through t(): ${[...unwrapped].join(" | ")}`);
assert.deepEqual([...unmappedStatusLabels], [], `Status labels are missing locale entries: ${[...unmappedStatusLabels].join(" | ")}`);
console.log(`console_v2_i18n_validation: PASS (${keys.size} locale entries)`);
