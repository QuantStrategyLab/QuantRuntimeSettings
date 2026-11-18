// Classified dispatch surface of the console Worker and the RuntimeInstances
// Durable Object, read from a strict TypeScript AST (ADR 0002, review F2).
//
// The dispatch set D is: the Worker default export entries and its `fetch`;
// RuntimeInstances `fetch` (its reviewed preamble: the fixed inventory path,
// then storage initialization), `alarm` and the transaction callback at the
// end of `fetch`; the inventory delegate `inventoryResponse` and its section
// gates; the `rotation_` delegate chain (`durableRotationCommand`,
// `rotationCommand`); `ux1ResearchCommand`; `KvDirectory.command` and
// `KvDirectory.run`; and the action families those bodies test.
//
// Admission is closed. A source fails before comparison with the registry when:
//
// - a file in D does not parse cleanly (any parse diagnostic), or an entry is
//   missing, duplicated, replaced or declared in an unhandled form;
// - a dispatch-level statement is neither a recognised dispatch branch nor an
//   exact reviewed AST template (templates have no holes: the whole statement
//   is compared, ignoring trivia and redundant parentheses). In the Durable
//   Object levels, a `const` bound to a single literal is also admitted: it
//   runs nothing;
// - a catch clause is not the whole reviewed clause;
// - any reference to a request, URL or command receiver (resolved through
//   bindings) is not one of the admitted forms: direct or optional property
//   access, truthiness, or a reviewed forward call inside a gated branch,
//   whose module-level names resolve to their reviewed bindings (the same
//   import, namespace element or local declaration, not a same-named
//   replacement).
//   Method calls on a receiver and computed access whatever its key are
//   rejected; so are aliases, destructuring, spread, reflection, IIFEs,
//   reassignment, mutation, shadowing and dynamic evaluation;
// - a dispatch key (`action`, `method`, `url`, `pathname`) is read outside a
//   recognised dispatch form or a reviewed template;
// - an action family does not resolve, through the import and export graph, to
//   one `const NAME = new Set([...string literals])`, or an action family or
//   entry binding is used other than in its admitted form in any module the
//   Worker reaches (`options.modules` supplies the whole console tree), or a
//   module exporting one is dynamically imported or re-exported as a namespace;
// - in any module the Worker reaches, `this` or `super` stands other than as
//   the object of a dotted access, `super(...)` or a literal-key destructuring
//   source (the instance as a value), or, in an entry class, a call
//   `this.name()` names no declared method or a declared method is written.
//   The one exception is the exact reviewed RuntimeInstances `sql` setter
//   (`REVIEWED.sqlSetter`), matched as a whole member.
//
// There is no fallback tokenizer: unsupported syntax is an error, never an empty
// extraction.
import { createRequire } from "node:module";
import { dirname, join, normalize } from "node:path";

export const CONSOLE = "web/strategy-switch-console";
const WORKER = `${CONSOLE}/worker.js`;
const DURABLE = `${CONSOLE}/application/runtime_instances/durable_object.js`;
const ROTATION = `${CONSOLE}/secretRotation.js`;
const DIRECTORY = `${CONSOLE}/kv_directory.js`;

/** The pinned frontend TypeScript (5.9.2), as in the existing AST tests. */
export function loadTypeScript(root) {
  const require = createRequire(join(root, CONSOLE, "frontend/package.json"));
  return require("typescript");
}

export class SurfaceError extends Error {}

// --- Parsing and canonical form ------------------------------------------------

/**
 * A least-recently-used cache keyed by source text, bounded by the total
 * length of the cached keys. Probes parse hundreds of edited variants of large
 * files and each tree keeps its checker alive, so an unbounded cache exhausts
 * the default heap. The unedited tree and the reviewed templates are read by
 * every extraction and stay cached; a probe variant ages out. One extraction
 * reads far less than the bound, so nothing it read is evicted before it ends.
 */
export function textCache(limit = 16 * 1024 * 1024) {
  const entries = new Map();
  let size = 0;
  return {
    get(key) {
      if (!entries.has(key)) return undefined;
      const value = entries.get(key);
      entries.delete(key);
      entries.set(key, value);
      return value;
    },
    set(key, value) {
      if (entries.has(key)) size -= key.length;
      entries.delete(key);
      entries.set(key, value);
      size += key.length;
      for (const oldest of entries.keys()) {
        if (size <= limit || oldest === key) break;
        entries.delete(oldest);
        size -= oldest.length;
      }
    },
  };
}

const parsed = textCache();
// Binding resolution: each parsed file keeps its own checker, so identifiers
// resolve to their declarations by scope, not by spelling.
const checkers = new WeakMap();

/** Parse `text` as JavaScript; any syntactic diagnostic is an error. */
export function parseStrict(ts, file, text) {
  const key = `${file}\u0000${text}`;
  const cached = parsed.get(key);
  if (cached) return cached;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const host = {
    getSourceFile: name => (name === file ? sf : undefined),
    getDefaultLibFileName: () => "lib.d.ts",
    writeFile: () => {}, getCurrentDirectory: () => "/", getCanonicalFileName: name => name,
    useCaseSensitiveFileNames: () => true, getNewLine: () => "\n", fileExists: name => name === file,
    readFile: () => undefined, directoryExists: () => true, getDirectories: () => [],
  };
  const program = ts.createProgram({ rootNames: [file], options: { allowJs: true, noLib: true, noResolve: true, noEmit: true, types: [] }, host });
  const diagnostics = program.getSyntacticDiagnostics(sf);
  if (diagnostics.length) {
    const first = diagnostics[0];
    const { line } = sf.getLineAndCharacterOfPosition(first.start ?? 0);
    throw new SurfaceError(`${file}: parse_error: ${ts.flattenDiagnosticMessageText(first.messageText, " ")} (line ${line + 1})`);
  }
  checkers.set(sf, program.getTypeChecker());
  parsed.set(key, sf);
  return sf;
}

/** Symbol an identifier refers to; for a shorthand property, the value it reads. */
function symbolOf(ts, sf, id) {
  const checker = checkers.get(sf);
  if (ts.isShorthandPropertyAssignment(id.parent) && id.parent.name === id) return checker.getShorthandAssignmentValueSymbol(id.parent);
  return checker.getSymbolAtLocation(id);
}

const unwrap = (ts, node) => { while (node && ts.isParenthesizedExpression(node)) node = node.expression; return node; };

/**
 * Canonical form of a node: an S-expression over node kinds and literal values.
 * Comments, whitespace, quote style and redundant parentheses disappear;
 * operators, literal values and structure remain.
 */
const canonicalCache = new WeakMap();
export function canonical(ts, node) {
  const K = ts.SyntaxKind;
  const walk = input => {
    const n = unwrap(ts, input);
    if (canonicalCache.has(n)) return canonicalCache.get(n);
    const value = form(n);
    canonicalCache.set(n, value);
    return value;
  };
  const form = n => {
    switch (n.kind) {
      case K.Identifier: case K.PrivateIdentifier: return n.text;
      case K.StringLiteral: case K.NoSubstitutionTemplateLiteral: return JSON.stringify(n.text);
      case K.NumericLiteral: case K.BigIntLiteral: return `#${n.text}`;
      case K.RegularExpressionLiteral: return `re${JSON.stringify(n.text)}`;
      case K.TemplateHead: case K.TemplateMiddle: case K.TemplateTail: return `t${JSON.stringify(n.text)}`;
      default: break;
    }
    const parts = [String(n.kind)];
    if (ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) parts.push(`op${n.operator}`);
    if (ts.isVariableDeclarationList(n)) parts.push(`f${n.flags & 7}`);
    if (ts.isMetaProperty(n)) parts.push(`kw${n.keywordToken}`);
    if (ts.isHeritageClause(n)) parts.push(`kw${n.token}`);
    ts.forEachChild(n, child => { parts.push(walk(child)); }, list => { parts.push(`[${list.map(walk).join(" ")}]`); });
    return `(${parts.join(" ")})`;
  };
  return walk(node);
}

/** Canonical form of an expression written as source text (registry `match`). */
export function canonicalExpression(ts, text) {
  const sf = parseStrict(ts, "expression.js", `(${text}\n);`);
  const [statement] = sf.statements;
  if (sf.statements.length !== 1 || !ts.isExpressionStatement(statement)) throw new SurfaceError(`not one expression: ${text}`);
  return canonical(ts, statement.expression);
}

/** Canonical forms of statements written as source text (reviewed templates). */
export function canonicalStatements(ts, text) {
  const sf = parseStrict(ts, "template.js", `async function template() {\n${text}\n}`);
  return sf.statements[0].body.statements.map(statement => canonical(ts, statement));
}

/** Canonical form of a catch clause written as source text (reviewed handlers). */
function canonicalCatch(ts, text) {
  const sf = parseStrict(ts, "catch.js", `try {} ${text}`);
  return canonical(ts, sf.statements[0].catchClause);
}

const collapse = text => text.replace(/\s+/g, " ").trim();
const sourceOf = (sf, node) => collapse(sf.text.slice(node.getStart(sf), node.end));
const lineOf = (sf, node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
const excerpt = (sf, node) => { const text = sourceOf(sf, node); return text.length > 160 ? `${text.slice(0, 157)}...` : text; };

/**
 * Body of the one function, method, constructor or class whose header (source
 * from the declaration start through its opening brace, whitespace collapsed)
 * is `signature`. Returns { text, start, end }, or null when absent; a
 * repeated header is an error.
 */
export function astBlock(ts, file, source, signature) {
  const sf = parseStrict(ts, file, source);
  const wanted = collapse(signature);
  const found = [];
  const visit = node => {
    let open = null;
    let close = null;
    if ((ts.isFunctionLike(node) && node.body && ts.isBlock(node.body))) { open = node.body.getStart(sf); close = node.body.end - 1; }
    else if (ts.isClassLike(node)) {
      const children = node.getChildren(sf);
      const brace = children.find(child => child.kind === ts.SyntaxKind.OpenBraceToken);
      const end = children.find(child => child.kind === ts.SyntaxKind.CloseBraceToken);
      if (brace && end) { open = brace.getStart(sf); close = end.getStart(sf); }
    }
    if (open !== null && collapse(source.slice(node.getStart(sf), open + 1)) === wanted) found.push({ open, close });
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (!found.length) return null;
  if (found.length > 1) throw new SurfaceError(`signature occurs more than once: ${signature}`);
  const [{ open, close }] = found;
  return { text: source.slice(open + 1, close), start: open + 1, end: close };
}

// --- Reviewed data ---------------------------------------------------------------
//
// Exact AST templates: each entry is compared as a whole statement, with its
// multiplicity. A template that no longer occurs is an error, so stale review
// data cannot linger.

export const REVIEWED = {
  // `url.pathname` reads inside a Worker route branch body. They serve the
  // already-classified branch; they do not dispatch a new route.
  workerNestedPathname: [
    ["const asset = V2_ASSETS[url.pathname];", 1],
    ["const hashedBundle = /^\\/v2\\/assets\\/index-[A-Za-z0-9_-]{8,}\\.(?:js|css)$/.test(url.pathname);", 1],
    ['const today = url.pathname === "/api/runtime/today";', 1],
    ['const rest = url.pathname.slice("/api/decisions/".length);', 1],
    ['return await operationResponse(request, env, url.pathname.slice("/api/operations/".length));', 1],
  ],
  // Other statements of the console API route branch that the forwarded
  // dependencies close over; their bindings are part of the reviewed forward.
  workerBranch: [
    ["let todaySession, todayOptions, todayRegistered;", 1],
    ["const readTodaySession = () => todaySession ??= readSession(request, env);", 1],
    ["const readTodayOptions = () => todayOptions ??= loadAccountOptionsConfig(env);", 1],
    ["const readTodayRegistered = () => todayRegistered ??= readTodayOptions().then(config => runtimeDailyRegisteredBindings(env, config.options));", 1],
  ],
  // Whole-receiver forwards inside Worker route branches: the complete call
  // (target, arguments and the dependency closures it passes), with its
  // multiplicity. Each target is the module binding the call resolves to; a
  // local declaration of the same name is not the reviewed target.
  workerForwards: [
    ...["readSession", "startLogin", "finishLogin", "sessionPayload", "marketBenchmarkResponse", "syncMarketBenchmarkResponse",
      "reviseMarketBenchmarkResponse", "runtimeCatalogResponse", "runtimeInstancesResponse", "adminConfigResponse", "saveAdminConfig",
      "riskProfileBindingsResponse", "saveRiskProfileBindings", "accountSettingsResponse", "saveAccountSettings",
      "approveAccountSettingsProfileApplication", "claimAccountSettingsProfileApplicationFromGitHub", "syncAccountDefaultResponse",
      "syncStrategyProfilesResponse", "syncStrategyHealthResponse", "strategyHealthResponse", "syncControlPlaneResponse",
      "syncControlPlaneSourceResponse", "controlPlaneResponse", "syncAdaptiveSelectionSourceResponse", "adaptiveSelectionResponse",
      "syncM0ResearchLedgerResponse", "m0ResearchLedgerResponse", "ownerDecisionQueueResponse", "recordOwnerDecisionResponse",
      "syncReconciliationRecoverySourceResponse", "reconciliationRecoveryResponse", "recordReconciliationRecoveryConfirmationResponse",
      "syncBinancePrivateScopeResponse", "binancePrivateScopeResponse", "binanceAccountFactsReadinessResponse",
      "syncBinanceAccountFactsResponse", "binanceAccountFactsResponse", "acceptHkStopResult", "syncExecutionEvidenceSourceResponse",
      "executionEvidenceResponse", "syncRuntimeDailyResponse", "syncAccountPeriodReturnResponse", "syncAccountExternalFlowResponse",
      "syncAccountExecutionsResponse", "syncAccountFactsResponse", "accountFactsResponse", "runtimeCycleHealthAdmissionResponse",
      "runtimeCycleHealthSourceResponse", "syncRuntimeTargetLifecycleSourceResponse", "runtimeTargetLifecycleResponse",
      "syncResearchTaskSourceResponse", "researchTaskResponse", "syncResearchPromotionTicketResponse",
      "fetchResearchPromotionTicketResponse", "researchPromotionTicketsResponse", "recordResearchPromotionDecisionResponse",
      "ux1DraftGet", "ux1DraftPost", "ux1PreviewPost", "ux1IntentPost", "ux1JobClaimPost", "ux1JobResultPost", "dispatchSwitch",
      "dispatchRuntimeStop", "dispatchBinanceResume"].map(target => [`${target}(request, env)`, 1]),
    // The read-only inventory route; its only dependency is the session reader.
    ["accountIdentityInventoryResponse(request, env, { readSession })", 1],
    // The registered management readback route; its only dependency is the session reader.
    ["accountManagementReadResponse(request, env, { readSession })", 1],
    ...["credentialMaintenanceResponse", "runtimeReadbackResponse", "auditEventsResponse", "reconciliationRecoveryControllerReadResponse",
      "binanceDetailArchiveResponse", "binanceDigestSnapshotResponse", "binanceWalletHistoryResponse", "runtimeDailyResponse",
      "accountFactsHistoryResponse", "accountDiagnosisResponse", "accountDiagnosisInternalResponse", "researchPromotionApplicationResponse",
      "researchPromotionApplicationInternalResponse", "readRuntimeStop"].map(target => [`${target}(request, env, url)`, 1]),
    ...["deskRibbonResponse", "deskOverviewResponse", "deskAccountsResponse", "deskPerformanceResponse", "deskSwitchStrategiesResponse"]
      .map(target => [`${target}(request, env, deskN1Deps())`, 1]),
    ["requireSameOrigin(request, { requireOrigin: true })", 1],
    ["overviewFxResponse(request)", 1],
    ["logout(request)", 1],
    ["configPayload(request, env, ctx)", 1],
    ["syncAccountFactsResponse(request, env, { historical: true })", 1],
    ['decisionActionResponse(request, env, rest.slice(0, -"/actions".length))', 1],
    ["decisionReviewResponse(request, env, rest)", 1],
    ["deskCredentialsResponse(request, env, { auth: deskAuth, command: runtimeInstanceCommand })", 1],
    ["deskSwitchTargetsResponse(request, env, { auth: deskAuth, options: loadAccountOptionsConfig })", 1],
    ["deskReadbackResponse(request, env, { auth: deskAuth, command: runtimeInstanceCommand, options: loadAccountOptionsConfig })", 1],
    ["performanceBenchmarkResponse(request, env, { command: runtimeInstanceCommand })", 1],
    ["credentialRotationResponse(request, env, { session: readSession, command: runtimeInstanceCommand })", 1],
    [`performanceResponse(request, env, {
      json, readSession, accountOptions: loadAccountOptionsConfig, facts: accountFactsResponse,
      executions: readBoundAccountExecutions,
      history: (req, e) => accountFactsHistoryResponse(req, e, new URL(req.url)),
      binanceCurrent: binanceAccountFactsResponse,
      wallet: (req, e) => binanceWalletHistoryResponse(req, e, new URL(req.url)), benchmarks: marketBenchmarkResponse,
    })`, 1],
    [`consoleApiResponse(request, env, {
      json, readSession: today ? readTodaySession : readSession, command: runtimeInstanceCommand,
      accountOptions: today ? readTodayOptions : loadAccountOptionsConfig,
      settings: accountSettingsResponse, saveDraft: saveCombinedAccountDraft,
      owner: ownerDecisionQueueResponse, promotion: researchPromotionTicketsResponse,
      recovery: reconciliationRecoveryResponse, credential: (req, e) => credentialMaintenanceResponse(req, e, new URL("/api/credential-maintenance", req.url)),
      audit: loadAuditLog,
      profiles: loadStrategyProfilesConfig, health: strategyHealthResponse,
      currentStrategies: (options, e) => readCurrentStrategies(options, e, ctx),
      dailyBindings: async e => runtimeDailyReadModelEnabled(e) ? runtimeDailyPublicBindings(e, (await (today ? readTodayOptions() : loadAccountOptionsConfig(e))).options, today ? readTodayRegistered : undefined) : [],
      daily: (req, e) => runtimeDailyResponse(req, e, new URL(req.url), today ? { readSession: readTodaySession, readOptions: readTodayOptions, readRegistered: readTodayRegistered } : undefined),
      notificationReceipts: e => readNotificationLog({ repository: e.RUNTIME_SETTINGS_REPO || DEFAULT_REPOSITORY, token: e.RUNTIME_SETTINGS_DISPATCH_TOKEN }),
      runControls: consoleRunControls,
    })`, 1],
  ],
  // Binding identity of every module-level name a Worker forward references:
  // the reviewed import, the reviewed element of the runtime_support.js
  // namespace destructuring, or a local declaration. A same-named local
  // replacement of a reviewed import is a different binding.
  workerForwardTargets: {
    "local": ["deskN1Deps"],
    "namespace:./application/worker/runtime_support.js": [
      "DEFAULT_REPOSITORY", "acceptHkStopResult", "accountDiagnosisInternalResponse", "accountDiagnosisResponse",
      "accountFactsHistoryResponse", "accountFactsResponse", "accountSettingsResponse", "adaptiveSelectionResponse", "adminConfigResponse",
      "approveAccountSettingsProfileApplication", "auditEventsResponse", "binanceAccountFactsReadinessResponse",
      "binanceAccountFactsResponse", "binanceDetailArchiveResponse", "binanceDigestSnapshotResponse", "binancePrivateScopeResponse",
      "binanceWalletHistoryResponse", "claimAccountSettingsProfileApplicationFromGitHub", "configPayload", "consoleRunControls",
      "controlPlaneResponse", "credentialMaintenanceResponse", "decisionActionResponse", "decisionReviewResponse", "deskAuth",
      "dispatchBinanceResume", "dispatchRuntimeStop", "dispatchSwitch", "executionEvidenceResponse",
      "fetchResearchPromotionTicketResponse", "json", "loadAccountOptionsConfig", "loadAuditLog", "loadStrategyProfilesConfig", "logout",
      "m0ResearchLedgerResponse", "marketBenchmarkResponse", "overviewFxResponse", "ownerDecisionQueueResponse",
      "readBoundAccountExecutions", "readCurrentStrategies", "readRuntimeStop", "reconciliationRecoveryControllerReadResponse",
      "reconciliationRecoveryResponse", "recordOwnerDecisionResponse", "recordReconciliationRecoveryConfirmationResponse",
      "recordResearchPromotionDecisionResponse", "requireSameOrigin", "researchPromotionApplicationInternalResponse",
      "researchPromotionApplicationResponse", "researchPromotionTicketsResponse", "researchTaskResponse", "reviseMarketBenchmarkResponse",
      "riskProfileBindingsResponse", "runtimeCatalogResponse", "runtimeCycleHealthAdmissionResponse", "runtimeCycleHealthSourceResponse",
      "runtimeDailyPublicBindings", "runtimeDailyReadModelEnabled", "runtimeDailyResponse", "runtimeInstancesResponse",
      "runtimeReadbackResponse", "runtimeTargetLifecycleResponse", "saveAccountSettings", "saveAdminConfig", "saveCombinedAccountDraft",
      "saveRiskProfileBindings", "sessionPayload", "strategyHealthResponse", "syncAccountDefaultResponse", "syncAccountExecutionsResponse",
      "syncAccountExternalFlowResponse", "syncAccountFactsResponse", "syncAccountPeriodReturnResponse",
      "syncAdaptiveSelectionSourceResponse", "syncBinanceAccountFactsResponse", "syncBinancePrivateScopeResponse",
      "syncControlPlaneResponse", "syncControlPlaneSourceResponse", "syncExecutionEvidenceSourceResponse", "syncM0ResearchLedgerResponse",
      "syncMarketBenchmarkResponse", "syncReconciliationRecoverySourceResponse", "syncResearchPromotionTicketResponse",
      "syncResearchTaskSourceResponse", "syncRuntimeDailyResponse", "syncRuntimeTargetLifecycleSourceResponse",
      "syncStrategyHealthResponse", "syncStrategyProfilesResponse",
    ],
    "import:./application/account_identity_inventory/http.js": ["accountIdentityInventoryResponse"],
    "import:./application/runtime_instances/account_management_readback.js": ["accountManagementReadResponse"],
    "import:./application/auth/login.js": ["finishLogin", "startLogin"],
    "import:./application/auth/session.js": ["readSession"],
    "import:./application/console_api/notification_receipts.js": ["readNotificationLog"],
    "import:./application/console_api/performance_benchmarks.js": ["performanceBenchmarkResponse"],
    "import:./application/console_api/performance_routes.js": ["performanceResponse"],
    "import:./application/console_api/routes.js": ["consoleApiResponse"],
    "import:./application/desk/accounts.js": ["deskAccountsResponse"],
    "import:./application/desk/credentials.js": ["deskCredentialsResponse"],
    "import:./application/desk/overview.js": ["deskOverviewResponse"],
    "import:./application/desk/performance.js": ["deskPerformanceResponse"],
    "import:./application/desk/readback.js": ["deskReadbackResponse"],
    "import:./application/desk/ribbon.js": ["deskRibbonResponse"],
    "import:./application/desk/switch_strategies.js": ["deskSwitchStrategiesResponse"],
    "import:./application/desk/switch_targets.js": ["deskSwitchTargetsResponse"],
    "import:./application/runtime_instances/command.js": ["runtimeInstanceCommand"],
    "import:./application/ux1/research.js": [
      "ux1DraftGet", "ux1DraftPost", "ux1IntentPost", "ux1JobClaimPost", "ux1JobResultPost", "ux1PreviewPost",
    ],
    "import:./secretRotation.js": ["credentialRotationResponse"],
  },
  // Statements whose computed member access is reviewed (a non-literal key).
  workerComputed: [
    ["bytes[index] = binary.charCodeAt(index);", 1],
  ],
  workerPreamble: "const url = new URL(request.url);",
  workerFallthrough: 'return json({ ok: false, error: "not_found" }, 404);',
  // The whole catch clause of the Worker dispatch try statement.
  workerCatch: `catch (error) {
      const directoryError = /^(kv_directory_|kv_list_daily_limit_exceeded)/.test(error.message || "");
      return json({ ok: false, error: error.message || "unexpected error" }, error.status || (directoryError ? 503 : 500),
        directoryError ? { "Retry-After": String(error.retry_after || 300) } : {});
    }`,
  // The whole catch clause of RuntimeInstances.fetch, and the alarm body.
  doCatch: `catch (error) {
      return json({ ok: false, error: error instanceof HttpError || error instanceof CycleHealthError || error instanceof CredentialMaintenanceError || error instanceof RotationError ? error.message : "runtime_instance_transaction_failed" }, error instanceof HttpError || error instanceof CycleHealthError || error instanceof CredentialMaintenanceError || error instanceof RotationError ? error.status : 409);
    }`,
  // The alarm initializes storage, then runs the Desk readback alarm.
  doAlarm: ["this.initializeStorage();", "await this.deskReadbacks.alarm();"],
  // The statements of RuntimeInstances.fetch before its try statement, in
  // order: the fixed inventory path is served before storage initialization,
  // then every ordinary request initializes storage. The inventory delegate's
  // names resolve to these bindings; its section dispatch is read from
  // `inventoryResponse` (`inventorySections`).
  doPreamble: [
    "if (new URL(request.url).pathname === INVENTORY_DO_PATH) return inventoryResponse(request, this.inventory);",
    "if (new URL(request.url).pathname === MANAGEMENT_READ_DO_PATH) return managementReadResponse(request, this.managementRead);",
    "this.initializeStorage();",
  ],
  doPreambleTargets: {
    "import:../account_identity_inventory/constants.js": ["INVENTORY_DO_PATH"],
    "import:../account_identity_inventory/http.js": ["inventoryResponse"],
    "import:./account_management_readback.js": ["MANAGEMENT_READ_DO_PATH", "managementReadResponse"],
  },
  // `inventoryResponse(request, cap)`: its response helper, then one try
  // statement with this catch clause. The try block holds these statements,
  // the section gates and the final rejection of an unknown section.
  inventoryRespond: 'const respond = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store" } });',
  inventoryCatch: `catch (error) {
    return error instanceof InventoryError ? respond({ ok: false, error: error.code }, error.status) : respond({ ok: false, error: "inventory_read_failed" }, 500);
  }`,
  inventory: [
    ['if (request.method !== "POST") throw new InventoryError("method_not_allowed", 405);', 1],
    ["const text = await request.text();", 1],
    ['if (byteLength(text) > REQUEST_BYTE_LIMIT) throw new InventoryError("invalid_request");', 1],
    ["let command;", 1],
    ['try { command = JSON.parse(text); } catch { throw new InventoryError("invalid_request"); }', 1],
    [`if (!command || typeof command !== "object" || Array.isArray(command) || Object.keys(command).some(key => !COMMAND_FIELDS.has(key))) {
      throw new InventoryError("invalid_request");
    }`, 1],
    ['if (!Object.hasOwn(INVENTORY_OBJECTS, command.object)) throw new InventoryError("unsupported_object");', 1],
    [`const base = { schema_version: INVENTORY_SCHEMA_VERSION, object: command.object, section: command.section,
      ordering: INVENTORY_ORDERING, observed_at: new Date().toISOString() };`, 1],
  ],
  inventoryFallthrough: 'throw new InventoryError("unsupported_section");',
  // The one reviewed position of the instance as a value (`classMethods` and
  // the module graph): the RuntimeInstances `sql` setter turns an assigned
  // handle (unit fixtures) into a plain own data property.
  sqlSetter: 'set sql(value) {\n    Object.defineProperty(this, "sql", { value, writable: true, configurable: true, enumerable: true });\n  }',
  // Whole-command forwards inside gated RuntimeInstances.fetch branches.
  doForwards: [
    ["this.deskReadbacks.command(command)", 1],
    ["credentialMaintenanceCommand(this.sql, command)", 1],
    ["this.accountDiagnosisCommand(command)", 1],
    ["this.consoleReadCommand(command)", 1],
    ["this.humanDecisionCommand(command)", 1],
    ["this.applicationCommand(command)", 1],
    ["this.cycleHealthProvisionCommand(command)", 1],
    ["this.cycleHealthCommand(command)", 1],
    ["this.accountSettingsCommand(command)", 1],
    ["this.accountFactsCommand(command)", 1],
    ["this.marketBenchmarkCommand(command)", 1],
    ["this.runtimeControlCommand(command)", 1],
    ["this.hkStopCommand(command)", 1],
  ],
  doForwardTargets: {
    "import:../../credentialMaintenance.js": ["credentialMaintenanceCommand"],
  },
  doComputed: [
    ["const config = update.options[instance.platform]?.find((option) => option.key === instance.key);", 1],
    ["if (instance.config[field] !== undefined) defaults[field] = instance.config[field];", 1],
  ],
  doFetch: [
    ['if (request.method !== "POST") throw new HttpError("method_not_allowed", 405);', 1],
    ["let command;", 1],
    ['try { command = await request.json(); } catch { throw new HttpError("invalid_runtime_instance_request", 400); }', 1],
  ],
  // Delegate branches: the exact statement a gate may run, per gate.
  doDirectoryBranch: [
    'if (request.method !== "POST") throw new HttpError("method_not_allowed", 405);',
    "const result = await this.directory.command(await request.json());",
    "return json(result, result.ok ? 200 : 503);",
  ],
  doPrefixBranch: {
    rotation_: "return json(await durableRotationCommand(this.storage, this.sql, this.rotationEnv, command));",
    ux1_: "return json(this.ux1ResearchCommand(command));",
  },
  doTransaction: [
    ["const state = this.read();", 1],
    ['if (!command || typeof command.actor !== "string" || !command.actor) throw new HttpError("runtime_instance_actor_required", 400);', 1],
    ['if (!Number.isSafeInteger(command.expected_revision) || command.expected_revision < 0) throw new HttpError("runtime_instance_revision_required", 400);', 1],
    ['if (command.expected_revision !== state.revision) throw new HttpError("runtime_instance_revision_conflict", 409);', 1],
    ["const ts = new Date().toISOString();", 1],
    ["let changed = true;", 1],
    ["let before = null;", 1],
    ["let after = null;", 1],
    ['if (!state.initialized) throw new HttpError("runtime_instances_not_initialized", 409);', 1],
    ["const item = state.instances.find((candidate) => candidate.platform === command.platform && candidate.key === command.key);", 1],
    ['throw new HttpError("unsupported_runtime_instance_action", 400);', 1],
    // The history row records the action; it does not dispatch on it.
    [`if (changed) {
      state.revision += 1;
      this.sql.exec("INSERT INTO instance_state (id, revision, payload) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, payload = excluded.payload", state.revision, JSON.stringify(state.instances));
      try {
        this.sql.exec("INSERT INTO instance_history (revision, entry) VALUES (?, ?)", state.revision, JSON.stringify({ revision: state.revision, ts, login: command.actor, action: command.action, before, after }));
      } catch (error) {
        throw new HttpError(error?.message || "runtime_instance_transaction_failed", 409);
      }
    }`, 1],
    ["return this.response(state);", 1],
  ],
  ux1: [
    ['const login = String(command?.login || "");', 1],
    ['if (!/^[a-z0-9-]{1,39}$/.test(login)) throw new HttpError("ux1_login_invalid", 400);', 1],
    ["const row = ux1SelectSlot(this.sql, login);", 1],
    ["const found = ux1SlotPayload(row);", 1],
    ['throw new HttpError("unsupported_ux1_action", 400);', 1],
  ],
  ux1Forwards: [
    ["ux1MutateJob(this.sql, command)", 1],
  ],
  ux1ForwardTargets: {
    "import:../ux1/research.js": ["ux1MutateJob"],
  },
  durableRotation: [
    ["let factors = [];", 1],
    // The one forward of the rotation command, to the local dispatcher.
    ["return storage.transactionSync(() => rotationCommand(sql, command, factors));", 1],
  ],
  rotation: [
    ["let op = c.operation_id ? load(sql, c.operation_id) : latest(sql);", 1],
    ["throw new RotationError();", 1],
  ],
  // The completion audit copies the command with the operation's actor; the
  // audit helper records fields, it does not dispatch. The statements that
  // declare the values it records are reviewed with it.
  rotationUses: [
    ["audit(sql, { ...c, actor: op.actor, event_id: op.current_request_id }, `credential_rotation_${action}`, state, reason);", 1],
    ["const action = op.current_action;", 1],
    ["const expected = DONE[action];", 1],
    ["let state = c.proxy_state === expected ? expected : c.proxy_state === 'failed' ? 'failed' : UNKNOWN[action];", 1],
    ["let reason = state === UNKNOWN[action] ? 'proxy_unconfirmed' : state === 'failed' ? 'provider_failed' : null;", 1],
  ],
  // Denial audits record the command; the audit helper does not dispatch.
  rotationForwards: [
    ["audit(sql, c, 'credential_rotation_denied', 'denied', c.reason)", 1],
    ["audit(sql, c, 'credential_rotation_denied', 'denied', 'step_up_rate_limited')", 1],
    ["audit(sql, c, 'credential_rotation_denied', 'denied', 'step_up_invalid')", 1],
  ],
  rotationForwardTargets: {
    "local": ["audit"],
  },
  rotationComputed: [
    ["Object.assign(op, { state: PENDING[c.write_action], updated_at: at, reason_code: null, current_action: c.write_action, current_request_id: c.request_id });", 1],
  ],
  directoryCommand: [
    ["const work = this.queue.then(() => this.run(command));", 1],
    ["this.queue = work.catch(() => {});", 1],
    ["return work;", 1],
  ],
  directoryRun: [
    ["const stored = await this.storage.get(STATE_KEY) || await sharedManifest(this.store);", 1],
    ["const state = stored || { keys: [], complete: false, cursor: null, retry_at: 0, failures: 0, };", 1],
    ['if (command.action !== "read" || !indexedKey(command.prefix)) throw Error("kv_directory_invalid_request");', 1],
    ["if (!state.complete) return this.unavailable(state);", 1],
    ["const keys = state.keys.filter(key => key.startsWith(command.prefix)).sort();", 1],
    ["const limit = bounded(command.limit, 100, 1, 100000);", 1],
    ['if (keys.length > limit) return { ok: false, error: "kv_directory_truncated", retry_after: 300 };', 1],
    ["return { ok: true, keys: keys.map(name => ({ name })), list_complete: true };", 1],
  ],
};

// --- Extraction ------------------------------------------------------------------

/**
 * Extract the classified surface. `sources` maps repository-relative paths to
 * text; with `options.modules` (more path-to-text entries) it must hold every
 * module the Worker bundle reaches. Returns
 * { routes: Map<canonical condition, { condition, text }>, internal: Set,
 * sections: Map<internal id, section names>, errors }.
 */
export function extractSurface(ts, sources, options = {}) {
  const reviewed = { ...REVIEWED, ...(options.reviewed || {}) };
  const modules = options.modules ? new Map([...options.modules, ...sources]) : sources;
  const errors = [];
  const internal = new Set();
  const sections = new Map();
  const routes = new Map();
  const files = new Map();
  const families = [];
  const file = path => {
    if (files.has(path)) return files.get(path);
    const text = modules.get(path);
    if (text === undefined) throw new SurfaceError(`${path}: entry_missing: file not found`);
    const sf = parseStrict(ts, path, text);
    files.set(path, sf);
    return sf;
  };
  const guard = (label, fn) => { try { return fn(); } catch (error) { if (!(error instanceof SurfaceError)) throw error; errors.push(`${label}: ${error.message}`); return null; } };
  const templates = (label, list) => {
    const map = new Map();
    for (const [text, count, kind] of list) {
      for (const key of kind === "expression" ? [canonicalExpression(ts, text)] : canonicalStatements(ts, text)) map.set(key, { text, count: (map.get(key)?.count || 0) + count, seen: 0 });
    }
    return { label, map };
  };
  const finishTemplates = (set, report) => {
    for (const entry of set.map.values()) {
      if (entry.seen !== entry.count) report(`${set.label}: template_multiplicity: reviewed ${entry.count}x, found ${entry.seen}x: ${collapse(entry.text)}`);
    }
  };

  guard("worker.js", () => extractWorker(ts, file(WORKER), reviewed, { routes, internal, errors, templates, finishTemplates }));
  guard("durable_object.js", () => extractDurable(ts, file, reviewed, { internal, sections, errors, templates, finishTemplates, families }));
  guard("module graph", () => auditModules(ts, file, modules, families, errors));
  if (!routes.size) errors.push("worker.js fetch: empty_extraction: no route branch extracted");
  if (![...internal].some(id => id.startsWith("action:"))) errors.push("durable_object.js: empty_extraction: no internal action extracted");
  return { routes, internal, sections, errors };
}

// Identifier positions that are names, not references.
function isNamePosition(ts, id) {
  const p = id.parent;
  if (!p) return true;
  if ((ts.isPropertyAccessExpression(p) || ts.isQualifiedName(p)) && p.name === id) return true;
  if ((ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p) || ts.isGetAccessorDeclaration(p)
    || ts.isSetAccessorDeclaration(p) || ts.isEnumMember(p)) && p.name === id) return true;
  if (ts.isBindingElement(p) && p.propertyName === id) return true;
  if ((ts.isLabeledStatement(p) || ts.isBreakStatement(p) || ts.isContinueStatement(p)) && p.label === id) return true;
  if (ts.isImportSpecifier(p) || ts.isExportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p) || ts.isNamespaceExport(p)) return true;
  if (ts.isMetaProperty(p)) return true;
  return false;
}
const isReference = (ts, id) => !isNamePosition(ts, id) && !isDeclarationName(ts, id);

/** `node` (through parentheses) is written: assigned, updated or a destructuring target. */
function isWriteTarget(ts, node) {
  let n = outer(ts, node);
  for (;;) {
    const p = n.parent;
    if (!p) return false;
    if (ts.isBinaryExpression(p) && p.left === n && isAssignmentOperator(ts, p.operatorToken.kind)) return true;
    if ((ts.isPrefixUnaryExpression(p) || ts.isPostfixUnaryExpression(p)) && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(p.operator)) return true;
    if ((ts.isForInStatement(p) || ts.isForOfStatement(p)) && p.initializer === n) return true;
    if (ts.isDeleteExpression(p)) return true;
    if (ts.isArrayLiteralExpression(p) || ts.isSpreadElement(p) || ts.isSpreadAssignment(p) || ts.isParenthesizedExpression(p)) { n = p; continue; }
    if ((ts.isShorthandPropertyAssignment(p) && p.name === n) || (ts.isPropertyAssignment(p) && p.initializer === n)) { n = p.parent; continue; }
    if (ts.isObjectLiteralExpression(p)) { n = p; continue; }
    return false;
  }
}

// Dynamic evaluation and prototype reach. Inside the dispatch set a global
// is admitted only from this closed list, `Object` only through these
// members, and no property may name a prototype or constructor link.
const GLOBALS = new Set(["Array", "BigInt", "Boolean", "Date", "Error", "Headers", "Infinity", "JSON", "Map", "Math", "NaN", "Number", "Object",
  "Promise", "RangeError", "Request", "Response", "Set", "String", "TextDecoder", "TextEncoder", "TypeError", "URL", "URLSearchParams",
  "Uint8Array", "atob", "btoa", "crypto", "decodeURIComponent", "encodeURIComponent", "isFinite", "isNaN", "parseFloat", "parseInt",
  "structuredClone", "undefined"]);
const EVALUATION_GLOBALS = new Set(["eval", "Function", "globalThis", "self", "window", "global", "Reflect", "Proxy", "setTimeout", "setInterval", "WebAssembly"]);
const OBJECT_MEMBERS = new Set(["assign", "entries", "freeze", "fromEntries", "hasOwn", "keys", "values"]);
const PROTOTYPE_LINKS = new Set(["constructor", "prototype", "__proto__", "getPrototypeOf", "setPrototypeOf", "__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__"]);
const literalKey = (ts, node) => { const n = unwrap(ts, node); return n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isNumericLiteral(n)) ? n.text : null; };
function isDeclarationName(ts, id) {
  const p = id.parent;
  return (ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isBindingElement(p) || ts.isFunctionDeclaration(p)
    || ts.isFunctionExpression(p) || ts.isClassDeclaration(p) || ts.isClassExpression(p)) && p.name === id;
}

/** Walk up through parentheses. */
function outer(ts, node) {
  while (node.parent && ts.isParenthesizedExpression(node.parent)) node = node.parent;
  return node;
}
const isStringLiteral = (ts, node) => { const n = unwrap(ts, node); return !!n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)); };
const literalValue = (ts, node) => unwrap(ts, node).text;
const isEquality = (ts, node) => ts.isBinaryExpression(node) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(node.operatorToken.kind);
const isAssignmentOperator = (ts, kind) => kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
const contains = (ancestor, node) => node.pos >= ancestor.pos && node.end <= ancestor.end;

/**
 * Recognise the dispatch form around a dispatch-key read `access` (a property
 * access `receiver.key`, already through parentheses). Returns
 * { kind, values?, family?, prefix?, node } or null.
 */
function dispatchForm(ts, access) {
  const top = outer(ts, access);
  const parent = top.parent;
  if (parent && isEquality(ts, parent)) {
    const other = parent.left === top ? parent.right : parent.left;
    if (isStringLiteral(ts, other)) return { kind: parent.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ? "eq" : "neq", values: [literalValue(ts, other)], node: parent };
    return null;
  }
  if (parent && ts.isCallExpression(parent) && parent.arguments.length === 1 && parent.arguments[0] === top) {
    const callee = unwrap(ts, parent.expression);
    if (ts.isPropertyAccessExpression(callee) && !callee.questionDotToken && !parent.questionDotToken) {
      const object = unwrap(ts, callee.expression);
      if (callee.name.text === "includes" && ts.isArrayLiteralExpression(object) && object.elements.length
        && object.elements.every(element => isStringLiteral(ts, element))) {
        return { kind: "list", values: object.elements.map(element => literalValue(ts, element)), node: parent };
      }
      if (callee.name.text === "has" && ts.isIdentifier(object)) return { kind: "family", family: object.text, node: parent };
    }
    return null;
  }
  // typeof R.key === "string" && R.key.startsWith("prefix")
  if (parent && ts.isTypeOfExpression(parent)) {
    const compare = outer(ts, parent).parent;
    if (!compare || !isEquality(ts, compare) || compare.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken) return null;
    const other = compare.left === outer(ts, parent) ? compare.right : compare.left;
    if (!isStringLiteral(ts, other) || literalValue(ts, other) !== "string") return null;
    const and = outer(ts, compare).parent;
    if (!and || !ts.isBinaryExpression(and) || and.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken || unwrap(ts, and.left) !== compare) return null;
    const prefix = prefixCall(ts, unwrap(ts, and.right));
    if (!prefix || stripOptional(ts, prefix.access) !== stripOptional(ts, access)) return null;
    return { kind: "prefix", prefix: prefix.value, node: and, partner: prefix.access };
  }
  if (parent && ts.isPropertyAccessExpression(parent) && parent.name.text === "startsWith") {
    const and = findPrefixAnd(ts, parent);
    if (and) return { kind: "prefix-partner", node: and };
  }
  return null;
}
function prefixCall(ts, call) {
  if (!ts.isCallExpression(call) || call.arguments.length !== 1 || !isStringLiteral(ts, call.arguments[0])) return null;
  const callee = unwrap(ts, call.expression);
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== "startsWith" || callee.questionDotToken || call.questionDotToken) return null;
  return { access: unwrap(ts, callee.expression), value: literalValue(ts, call.arguments[0]) };
}
function findPrefixAnd(ts, startsWith) {
  const call = outer(ts, startsWith).parent;
  if (!call || !ts.isCallExpression(call) || unwrap(ts, call.expression) !== startsWith) return null;
  const and = outer(ts, call).parent;
  if (!and || !ts.isBinaryExpression(and) || and.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken || unwrap(ts, and.right) !== call) return null;
  const left = unwrap(ts, and.left);
  if (!isEquality(ts, left)) return null;
  const typeOf = [left.left, left.right].map(side => unwrap(ts, side)).find(side => ts.isTypeOfExpression(side));
  if (!typeOf) return null;
  return stripOptional(ts, unwrap(ts, typeOf.expression)) === stripOptional(ts, unwrap(ts, startsWith.expression)) ? and : null;
}
/** `receiver.key` and `receiver?.key` name the same read. */
function stripOptional(ts, access) {
  const n = unwrap(ts, access);
  if (!ts.isPropertyAccessExpression(n)) return null;
  const object = unwrap(ts, n.expression);
  return ts.isIdentifier(object) ? `${object.text}.${n.name.text}` : null;
}

/**
 * Examine every reference to the receivers inside `body`. A reference is an
 * identifier that resolves to a receiver's declaration, whatever its spelling.
 * `policy`:
 *   keys: { receiver: Set(dispatch keys) }
 *   payload: { receiver: Set(other admitted property names) | "any" }
 *   declarations: the receivers' own declaration identifiers
 *   gated: nodes whose subtrees may forward a receiver (gated branch bodies)
 *   forwards: reviewed forward calls ({ label, map } from `templates`)
 *   covered: nodes inside an exact reviewed template
 *   consumed: dispatch-key access nodes already admitted by the caller
 *   onForm(form, access): record a recognised dispatch form
 *   onKeyRead(access, receiver, key) -> true when the caller admits it
 * Errors are pushed to `report`. Returns the admitted forward calls.
 */
function scanReceivers(ts, sf, body, policy, report) {
  const names = new Set(Object.keys(policy.keys));
  const receivers = new Map([...policy.declarations].map(declaration => [symbolOf(ts, sf, declaration), declaration.text]));
  const inAny = (set, node) => [...set].some(region => contains(region, node));
  const fail = (code, node, detail) => report(`${code}: ${detail} (line ${lineOf(sf, node)}): ${excerpt(sf, enclosingStatement(ts, node))}`);
  const forwarded = new Set();
  const visit = node => {
    if (ts.isWithStatement(node)) fail("dynamic_evaluation", node, "with statement");
    if (ts.isDebuggerStatement(node)) fail("unsupported_syntax", node, "debugger statement");
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) fail("dynamic_evaluation", node, "dynamic import");
    if (ts.isIdentifier(node) && ["eval", "arguments", "Function"].includes(node.text) && !isNamePosition(ts, node)) fail("dynamic_evaluation", node, `${node.text} reference`);
    if (ts.isIdentifier(node)) {
      if (isDeclarationName(ts, node)) {
        if (names.has(node.text) && !policy.declarations.has(node)) fail("shadowing", node, `declaration shadows receiver ${node.text}`);
      } else if (!isNamePosition(ts, node) && receivers.has(symbolOf(ts, sf, node))) {
        if (ts.isShorthandPropertyAssignment(node.parent) && node.parent.name === node) {
          if (!inAny(policy.covered, node)) fail("alias", node, `shorthand property passes receiver ${receivers.get(symbolOf(ts, sf, node))}`);
        } else {
          reference(node, receivers.get(symbolOf(ts, sf, node)));
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  const reference = (id, receiver) => {
    const top = outer(ts, id);
    const parent = top.parent;
    const covered = inAny(policy.covered, id);
    if (ts.isElementAccessExpression(parent) && parent.expression === top) {
      fail("computed_access", parent, `computed access on receiver ${receiver}`);
      return;
    }
    if (ts.isPropertyAccessExpression(parent) && parent.expression === top) {
      const access = parent;
      const accessTop = outer(ts, access);
      const use = accessTop.parent;
      if (use && ((ts.isBinaryExpression(use) && use.left === accessTop && isAssignmentOperator(ts, use.operatorToken.kind))
        || ((ts.isPrefixUnaryExpression(use) || ts.isPostfixUnaryExpression(use)) && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(use.operator))
        || ts.isDeleteExpression(use))) {
        if (!covered) fail("mutation", access, `write to ${receiver}.${access.name.text}`);
        return;
      }
      const key = access.name.text;
      // A method called on the receiver may return the receiver itself
      // (`valueOf`) or a copy (`clone`): an untracked alias.
      if (use && (((ts.isCallExpression(use) || ts.isNewExpression(use)) && use.expression === accessTop) || (ts.isTaggedTemplateExpression(use) && use.tag === accessTop))) {
        if (!covered) fail("receiver_call", access, `method call ${receiver}.${key}() on a receiver is admitted only in a reviewed template`);
        return;
      }
      if (!policy.keys[receiver].has(key)) {
        const payload = policy.payload?.[receiver];
        if (!covered && payload !== "any" && !payload?.has(key)) fail("dispatch_form", access, `${receiver}.${key} read is not admitted`);
        return;
      }
      if (policy.consumed.has(access)) return;
      if (policy.onKeyRead && policy.onKeyRead(access, receiver, key)) return;
      const form = policy.recognise ? dispatchForm(ts, access) : null;
      if (form) { policy.onForm(form, access, receiver, key, covered); return; }
      if (!covered) fail("dispatch_form", access, `${receiver}.${key} read outside a recognised dispatch form`);
      return;
    }
    if (covered) return;
    if (ts.isBinaryExpression(parent) && parent.left === top && isAssignmentOperator(ts, parent.operatorToken.kind)) { fail("reassignment", parent, `receiver ${receiver} is reassigned`); return; }
    if (ts.isPrefixUnaryExpression(parent) && parent.operator === ts.SyntaxKind.ExclamationToken) return;
    if ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && (parent.arguments || []).includes(top)) {
      const callee = unwrap(ts, parent.expression);
      const root = calleeRoot(ts, callee);
      if (ts.isFunctionExpression(callee) || ts.isArrowFunction(callee)) fail("forwarding", parent, `receiver ${receiver} passed to an immediately invoked function`);
      else if (!root || ["Reflect", "Object", "Proxy", "JSON", "structuredClone"].includes(root)) fail("reflection", parent, `receiver ${receiver} passed to ${root || "a computed callee"}`);
      else if (!inAny(policy.gated, parent)) fail("forwarding", parent, `receiver ${receiver} forwarded outside a gated branch`);
      else {
        // A gated branch is not authorization by itself: the whole call must be
        // a reviewed forward, counted once per call.
        const entry = policy.forwards?.map.get(canonical(ts, parent));
        if (!entry) fail("forwarding", parent, `receiver ${receiver} forwarded to an unreviewed call ${excerpt(sf, parent).slice(0, 80)}`);
        else if (!forwarded.has(parent)) { forwarded.add(parent); entry.seen += 1; }
      }
      return;
    }
    if (ts.isVariableDeclaration(parent) && parent.initializer === top) {
      fail(ts.isIdentifier(parent.name) ? "alias" : "destructuring", parent, `receiver ${receiver} bound to another name`);
      return;
    }
    if (ts.isBinaryExpression(parent) && parent.right === top && isAssignmentOperator(ts, parent.operatorToken.kind)) {
      fail(ts.isIdentifier(unwrap(ts, parent.left)) || ts.isPropertyAccessExpression(unwrap(ts, parent.left)) ? "alias" : "destructuring", parent, `receiver ${receiver} assigned elsewhere`);
      return;
    }
    if (ts.isSpreadElement(parent) || ts.isSpreadAssignment(parent)) { fail("alias", parent, `receiver ${receiver} spread outside a reviewed use`); return; }
    fail("unsupported_reference", parent, `receiver ${receiver} used as ${ts.SyntaxKind[parent.kind]}`);
  };
  visit(body);
  return forwarded;
}

/**
 * Executable admission of one dispatch function `fn`, receivers aside:
 * globals come from a closed list, no property names a prototype or
 * constructor link, a computed access with a non-literal key occurs only in
 * a reviewed statement (`computed`) or an exact template, and parameters are
 * not reassigned. Reviewed templates and forwards (`pinned`) must mean what
 * was reviewed: no non-arrow function between them and `fn` (which would
 * rebind `this`), and every identifier they use resolves outside `fn`, to a
 * parameter, or to a declaration inside a reviewed template.
 */
function auditExecutable(ts, sf, fn, policy, report) {
  const fail = (code, node, detail) => report(`${code}: ${detail} (line ${lineOf(sf, node)}): ${excerpt(sf, enclosingStatement(ts, node))}`);
  const inAny = (nodes, node) => [...nodes].some(region => contains(region, node));
  const computed = new Set();
  if (policy.computed) {
    const visit = node => {
      const entry = ts.isStatement(node) ? policy.computed.map.get(canonical(ts, node)) : null;
      if (entry) { entry.seen += 1; computed.add(node); }
      ts.forEachChild(node, visit);
    };
    visit(fn.body);
  }
  const params = new Set(fn.parameters.map(p => p.name).filter(name => ts.isIdentifier(name)).map(name => symbolOf(ts, sf, name)));
  const receivers = new Set([...(policy.receivers || [])].map(declaration => symbolOf(ts, sf, declaration)));
  const visit = node => {
    if (ts.isIdentifier(node) && isReference(ts, node)) {
      // Built-ins such as `globalThis` and `undefined` resolve to symbols
      // without a declaration: they are globals too.
      const declared = symbolOf(ts, sf, node);
      const symbol = declared?.declarations?.length ? declared : null;
      if (!symbol && !GLOBALS.has(node.text) && !["eval", "arguments", "Function"].includes(node.text)) {
        fail(EVALUATION_GLOBALS.has(node.text) ? "dynamic_evaluation" : "global_reference", node, `global ${node.text} is not admitted in the dispatch set`);
      }
      if (!symbol && node.text === "Object") {
        const top = outer(ts, node);
        if (!ts.isPropertyAccessExpression(top.parent) || top.parent.expression !== top || !OBJECT_MEMBERS.has(top.parent.name.text)) fail("dynamic_evaluation", node, "Object is admitted only through its reviewed members");
      }
      if (symbol && params.has(symbol) && !receivers.has(symbol) && isWriteTarget(ts, node)) fail("reassignment", node, `parameter ${node.text} is reassigned`);
    }
    if (ts.isPropertyAccessExpression(node) && PROTOTYPE_LINKS.has(node.name.text)) fail("dynamic_evaluation", node, `.${node.name.text} access`);
    if (ts.isElementAccessExpression(node)) {
      const key = literalKey(ts, node.argumentExpression);
      if (key !== null && PROTOTYPE_LINKS.has(key)) fail("dynamic_evaluation", node, `[${JSON.stringify(key)}] access`);
      else if (key === null && !inAny(policy.covered, node) && !inAny(computed, node)) fail("computed_access", node, "computed access with a non-literal key outside a reviewed statement");
    }
    if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) fail("dynamic_evaluation", node, "import.meta");
    ts.forEachChild(node, visit);
  };
  visit(fn.body);
  if (policy.computed) policy.finishTemplates(policy.computed, report);
  for (const node of policy.pinned || []) {
    for (let up = node.parent; up && up !== fn; up = up.parent) {
      if (ts.isFunctionLike(up) && !ts.isArrowFunction(up)) { fail("binding", node, "reviewed template inside a nested function"); break; }
    }
    const check = id => {
      if (ts.isIdentifier(id) && isReference(ts, id)) {
        const symbol = symbolOf(ts, sf, id);
        const declarations = symbol?.declarations || [];
        if (declarations.length > 1) fail("binding", id, `${id.text} has ${declarations.length} declarations`);
        const [declaration] = declarations;
        if (declaration && contains(fn, declaration) && !contains(node, declaration) && !params.has(symbol) && !receivers.has(symbol)
          && !inAny(policy.covered, declaration)) {
          fail("binding", id, `${id.text} in a reviewed template resolves to an unreviewed local declaration (line ${lineOf(sf, declaration)})`);
        }
      }
      ts.forEachChild(id, check);
    };
    check(node);
  }
}

/**
 * Binding identity of a module-level identifier `id`: `import:<specifier>`
 * for an unrenamed named import, `namespace:<specifier>` for an unrenamed
 * element, without a default, of a top-level `const { ... } = ns` where `ns`
 * is a namespace import, and `local` for a top-level function or `const`
 * declaration that is never written. Anything else (a renamed import, a second
 * declaration, a default value, a reassigned function) is null. A redeclared
 * top-level name counts by spelling: the binder gives the second declaration
 * a detached symbol, so its references would still resolve to the first.
 */
function bindingIdentity(ts, sf, id) {
  const symbol = symbolOf(ts, sf, id);
  const declarations = symbol?.declarations || [];
  if (declarations.length !== 1 || (topLevelNames(ts, sf).get(id.text) || 0) > 1) return null;
  const [d] = declarations;
  const topLevel = statement => statement?.parent === sf;
  if (ts.isImportSpecifier(d)) {
    const statement = d.parent.parent.parent;
    return !d.propertyName && topLevel(statement) ? `import:${statement.moduleSpecifier.text}` : null;
  }
  if (ts.isBindingElement(d)) {
    const declaration = d.parent.parent;
    if (d.propertyName || d.dotDotDotToken || d.initializer || !ts.isObjectBindingPattern(d.parent) || !ts.isVariableDeclaration(declaration)
      || !(declaration.parent.flags & ts.NodeFlags.Const) || !topLevel(declaration.parent.parent)) return null;
    const init = unwrap(ts, declaration.initializer);
    const [ns] = (init && ts.isIdentifier(init) && symbolOf(ts, sf, init)?.declarations) || [];
    return ns && ts.isNamespaceImport(ns) && topLevel(ns.parent.parent) ? `namespace:${ns.parent.parent.moduleSpecifier.text}` : null;
  }
  const local = (ts.isFunctionDeclaration(d) && topLevel(d))
    || (ts.isVariableDeclaration(d) && ts.isIdentifier(d.name) && (d.parent.flags & ts.NodeFlags.Const) && topLevel(d.parent.parent));
  if (!local) return null;
  return (moduleSummary(ts, sf).refs.get(symbol) || []).some(ref => isWriteTarget(ts, ref)) ? null : "local";
}

/** How often each name is declared at module level (imports included). */
const topLevelCache = new WeakMap();
function topLevelNames(ts, sf) {
  if (topLevelCache.has(sf)) return topLevelCache.get(sf);
  const counts = new Map();
  const add = name => { if (name && ts.isIdentifier(name)) counts.set(name.text, (counts.get(name.text) || 0) + 1); };
  const pattern = name => {
    if (ts.isIdentifier(name)) add(name);
    else for (const element of name.elements) if (!ts.isOmittedExpression(element)) pattern(element.name);
  };
  for (const statement of sf.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      add(clause?.name);
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) add(bindings.name);
      if (bindings && ts.isNamedImports(bindings)) for (const element of bindings.elements) add(element.name);
    }
    if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) pattern(declaration.name);
    if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) add(statement.name);
  }
  topLevelCache.set(sf, counts);
  return counts;
}

/**
 * A reviewed forward calls what was reviewed: every identifier in a forward
 * call that resolves outside `fn` must have the binding identity reviewed for
 * its name (`spec`: { identity: [names] }). Renaming the reviewed import and
 * declaring a same-named wrapper, or a second declaration, keeps the call's
 * spelling but changes its identity. Declarations inside `fn` are audited by
 * `auditExecutable`. A reviewed name that no forward uses is stale.
 */
function auditForwardTargets(ts, sf, fn, calls, spec, report) {
  const fail = (node, detail) => report(`forward_target: ${detail} (line ${lineOf(sf, node)}): ${excerpt(sf, enclosingStatement(ts, node))}`);
  const expected = new Map(Object.entries(spec || {}).flatMap(([identity, names]) => names.map(name => [name, identity])));
  const used = new Set();
  const visit = node => {
    if (ts.isIdentifier(node) && isReference(ts, node)) {
      const declarations = symbolOf(ts, sf, node)?.declarations || [];
      if (declarations.length && !(declarations.length === 1 && contains(fn, declarations[0]))) {
        const identity = bindingIdentity(ts, sf, node);
        const reviewed = expected.get(node.text);
        used.add(node.text);
        if (!reviewed) fail(node, `${node.text} in a reviewed forward has no reviewed binding (resolves to ${identity || "an unadmitted binding"})`);
        else if (identity !== reviewed) fail(node, `${node.text} in a reviewed forward resolves to ${identity || "an unadmitted binding"}, reviewed ${reviewed}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  for (const call of calls) visit(call);
  for (const name of expected.keys()) if (!used.has(name)) report(`forward_target: stale reviewed binding ${name} (${expected.get(name)}) is not used by a reviewed forward`);
}
function calleeRoot(ts, callee) {
  let n = unwrap(ts, callee);
  while (ts.isPropertyAccessExpression(n)) n = unwrap(ts, n.expression);
  if (ts.isIdentifier(n)) return n.text;
  if (n.kind === ts.SyntaxKind.ThisKeyword) return "this";
  return null;
}
function enclosingStatement(ts, node) {
  let n = node;
  while (n.parent && !ts.isStatement(n) && !ts.isSourceFile(n.parent)) n = n.parent;
  if (ts.isIfStatement(n) && contains(n.expression, node)) return n.expression;
  return n;
}
const statementsOf = (ts, node) => (ts.isBlock(node) ? [...node.statements] : [node]);
/** `const name = <string, template without substitutions, regex or number>;` runs nothing. */
function isInertLiteral(ts, statement) {
  if (!ts.isVariableStatement(statement) || !(statement.declarationList.flags & ts.NodeFlags.Const) || statement.modifiers?.length) return false;
  return statement.declarationList.declarations.every(declaration => {
    const init = declaration.initializer && unwrap(ts, declaration.initializer);
    return ts.isIdentifier(declaration.name) && init && (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)
      || ts.isRegularExpressionLiteral(init) || ts.isNumericLiteral(init));
  });
}
const isTerminal = (ts, statement) => ts.isReturnStatement(statement) || ts.isThrowStatement(statement);

// --- Worker ----------------------------------------------------------------------

function extractWorker(ts, sf, reviewed, out) {
  const { routes, internal, errors, templates, finishTemplates } = out;
  const report = message => errors.push(`worker.js ${message}`);
  const defaults = [];
  for (const statement of sf.statements) {
    if (ts.isExportAssignment(statement)) defaults.push(statement);
    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)
      && statement.exportClause.elements.some(element => element.name.text === "default")) report(`export: export_form: default re-export is not admitted: ${excerpt(sf, statement)}`);
    if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
      if (statement.modifiers?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword)) defaults.push(statement);
    }
  }
  if (defaults.length !== 1) throw new SurfaceError(`entry_missing: expected exactly one default export, found ${defaults.length}`);
  const [exported] = defaults;
  if (!ts.isExportAssignment(exported) || exported.isExportEquals || !ts.isObjectLiteralExpression(unwrap(ts, exported.expression))) {
    throw new SurfaceError(`export_form: default export is not an object literal: ${excerpt(sf, exported)}`);
  }
  const members = new Map();
  for (const member of unwrap(ts, exported.expression).properties) {
    if (!ts.isMethodDeclaration(member) || !ts.isIdentifier(member.name) || member.asteriskToken) {
      report(`default export: export_form: member form not admitted: ${excerpt(sf, member)}`);
      continue;
    }
    if (members.has(member.name.text)) report(`default export: entry_duplicate: ${member.name.text}`);
    members.set(member.name.text, member);
  }
  // The exported object has no name; `this` in its methods is its only
  // reference inside the module, and would let a method replace an entry.
  const self = node => {
    if (node.kind === ts.SyntaxKind.ThisKeyword) report(`default export: entry_replaced: this is not admitted in the default export (line ${lineOf(sf, node)}): ${excerpt(sf, enclosingStatement(ts, node))}`);
    if (!ts.isFunctionLike(node) || ts.isArrowFunction(node)) ts.forEachChild(node, self);
  };
  for (const member of members.values()) ts.forEachChild(member, self);
  for (const name of members.keys()) if (name !== "fetch") internal.add(`worker:${name}`);
  const fetch = members.get("fetch");
  if (!fetch) { report("default export: entry_missing: no fetch entry"); return; }
  const params = fetch.parameters.map(p => (ts.isIdentifier(p.name) && !p.initializer && !p.dotDotDotToken ? p.name.text : null));
  if (params.join(",") !== "request,env,ctx") throw new SurfaceError(`fetch: entry_form: expected fetch(request, env, ctx), got ${excerpt(sf, fetch).slice(0, 60)}`);

  const fetchReport = message => errors.push(`worker.js fetch: ${message}`);
  const body = fetch.body.statements;
  const covered = new Set();
  const gated = new Set();
  const consumed = new Set();
  const preamble = canonicalStatements(ts, reviewed.workerPreamble)[0];
  const misplaced = body.find((statement, index) => (index === 0 ? canonical(ts, statement) !== preamble : index > 1 || !ts.isTryStatement(statement)));
  if (body.length !== 2 || misplaced) {
    fetchReport(`statement: fetch must be "${reviewed.workerPreamble}" then one try statement; dispatch-level statement not admitted: ${excerpt(sf, misplaced || fetch)}`);
  }
  if (body[0] && canonical(ts, body[0]) === preamble) covered.add(body[0]);
  const tryStatement = body.find(statement => ts.isTryStatement(statement));
  if (!tryStatement) throw new SurfaceError("fetch: entry_form: no dispatch try statement");
  if (tryStatement.finallyBlock) fetchReport("statement: finally block is not admitted");
  if (!tryStatement.catchClause) fetchReport("statement: catch clause missing");
  else if (canonical(ts, tryStatement.catchClause) !== canonicalCatch(ts, reviewed.workerCatch)) {
    fetchReport(`statement: catch clause is not the reviewed error response: ${excerpt(sf, tryStatement.catchClause)}`);
  } else covered.add(tryStatement.catchClause);
  const fallthrough = canonicalStatements(ts, reviewed.workerFallthrough)[0];
  let finished = false;
  for (const statement of tryStatement.tryBlock.statements) {
    if (finished) { fetchReport(`statement: statement after the final fallthrough: ${excerpt(sf, statement)}`); continue; }
    if (ts.isReturnStatement(statement)) {
      if (canonical(ts, statement) !== fallthrough) fetchReport(`statement: final fallthrough is not the reviewed not-found response: ${excerpt(sf, statement)}`);
      covered.add(statement);
      finished = true;
      continue;
    }
    if (!ts.isIfStatement(statement)) { fetchReport(`statement: route dispatch must be a top-level if-branch; not admitted: ${excerpt(sf, statement)}`); continue; }
    const condition = statement.expression;
    const text = sourceOf(sf, condition);
    if (statement.elseStatement) fetchReport(`else_dispatch: else-branch dispatch is not admitted: ${text}`);
    const leaves = routeLeaves(ts, condition);
    if (!leaves) { fetchReport(`route_condition: condition form not admitted: ${text}`); continue; }
    if (!leaves.some(leaf => leaf.kind === "pathname")) { fetchReport(`route_condition: top-level branch does not test url.pathname: ${text}`); continue; }
    for (const leaf of leaves) consumed.add(leaf.access);
    const then = statement.thenStatement;
    if (ts.isIfStatement(then) || ts.isIterationStatement(then, false) || ts.isSwitchStatement(then) || ts.isTryStatement(then)
      || ts.isWithStatement(then) || ts.isLabeledStatement(then)) fetchReport(`statement: nested dispatch statement in branch is not admitted: ${text}`);
    const key = canonical(ts, condition);
    if (routes.has(key)) fetchReport(`entry_duplicate: duplicate route condition: ${text}`);
    routes.set(key, { condition: text, text: sf.text.slice(statement.getStart(sf), statement.end) });
    gated.add(then);
  }
  if (!finished) fetchReport("statement: no final not-found fallthrough");

  // Reviewed statements inside route branches: the nested `url.pathname`
  // uses and the console API branch's dependency closures.
  const nested = templates("worker.js fetch nested_pathname", reviewed.workerNestedPathname);
  const branch = templates("worker.js fetch branch", reviewed.workerBranch);
  const pin = node => {
    const key = ts.isStatement(node) ? canonical(ts, node) : null;
    const entry = key && (nested.map.get(key) || branch.map.get(key));
    if (entry) { entry.seen += 1; covered.add(node); return; }
    ts.forEachChild(node, pin);
  };
  for (const region of gated) pin(region);
  finishTemplates(nested, message => fetchReport(message.replace(/^worker\.js fetch nested_pathname: template_multiplicity: reviewed (\d+)x, found (\d+)x: /, "nested_pathname: reviewed nested url.pathname use occurs $2x, reviewed $1x: ")));
  finishTemplates(branch, fetchReport);
  const forwards = templates("worker.js fetch forwards", reviewed.workerForwards.map(([text, count]) => [text, count, "expression"]));
  const forwarded = scanReceivers(ts, sf, fetch.body, {
    keys: { request: new Set(["url"]), url: new Set(["pathname"]) },
    payload: { request: new Set(["method"]), url: new Set(["search"]) },
    declarations: new Set([fetch.parameters[0].name, body[0]?.declarationList?.declarations?.[0]?.name].filter(Boolean)),
    gated, covered, consumed, forwards, recognise: false,
  }, message => fetchReport(message.replace(/^dispatch_form: url\.pathname read outside a recognised dispatch form/, "nested_pathname: unreviewed url.pathname use")));
  finishTemplates(forwards, fetchReport);
  auditForwardTargets(ts, sf, fetch, forwarded, reviewed.workerForwardTargets, fetchReport);
  auditExecutable(ts, sf, fetch, {
    covered, receivers: [fetch.parameters[0].name, body[0]?.declarationList?.declarations?.[0]?.name].filter(Boolean),
    computed: templates("worker.js fetch computed", reviewed.workerComputed), finishTemplates,
    pinned: [...covered, ...forwarded],
  }, fetchReport);
  // `pathname` is only ever read from the url receiver.
  const visit = node => {
    if (ts.isPropertyAccessExpression(node) && node.name.text === "pathname" && !(ts.isIdentifier(unwrap(ts, node.expression)) && unwrap(ts, node.expression).text === "url")) {
      fetchReport(`dispatch_form: pathname read other than as url.pathname (line ${lineOf(sf, node)}): ${excerpt(sf, enclosingStatement(ts, node))}`);
    }
    if (ts.isElementAccessExpression(node) && isStringLiteral(ts, node.argumentExpression) && literalValue(ts, node.argumentExpression) === "pathname") {
      fetchReport(`computed_access: computed pathname access (line ${lineOf(sf, node)}): ${excerpt(sf, enclosingStatement(ts, node))}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(fetch.body);
}

/**
 * Leaves of a route condition, or null when any part is not an admitted form.
 * Admitted: `url.pathname === X`, `url.pathname.startsWith(X)`,
 * `[...strings].includes(url.pathname)`, `/re/.test(url.pathname)`,
 * `request.method === "M"`, `[...strings].includes(request.method)`, joined
 * by `&&` and `||`. X is a string literal or an identifier.
 */
function routeLeaves(ts, input) {
  const n = unwrap(ts, input);
  if (ts.isBinaryExpression(n) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken].includes(n.operatorToken.kind)) {
    const left = routeLeaves(ts, n.left);
    const right = routeLeaves(ts, n.right);
    return left && right ? [...left, ...right] : null;
  }
  const read = (node, receiver, key) => {
    const access = unwrap(ts, node);
    return ts.isPropertyAccessExpression(access) && !access.questionDotToken && access.name.text === key
      && ts.isIdentifier(unwrap(ts, access.expression)) && unwrap(ts, access.expression).text === receiver ? access : null;
  };
  const value = node => isStringLiteral(ts, node) || ts.isIdentifier(unwrap(ts, node));
  if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken) {
    const path = read(n.left, "url", "pathname");
    if (path && value(n.right)) return [{ kind: "pathname", access: path }];
    const method = read(n.left, "request", "method");
    if (method && isStringLiteral(ts, n.right)) return [{ kind: "method", access: method }];
    return null;
  }
  if (ts.isCallExpression(n) && n.arguments.length === 1 && !n.questionDotToken) {
    const callee = unwrap(ts, n.expression);
    if (!ts.isPropertyAccessExpression(callee) || callee.questionDotToken) return null;
    const object = unwrap(ts, callee.expression);
    const name = callee.name.text;
    if (name === "startsWith" && value(n.arguments[0])) {
      const path = read(object, "url", "pathname");
      return path ? [{ kind: "pathname", access: path }] : null;
    }
    if (name === "includes" && ts.isArrayLiteralExpression(object) && object.elements.length && object.elements.every(e => isStringLiteral(ts, e))) {
      const path = read(n.arguments[0], "url", "pathname");
      if (path) return [{ kind: "pathname", access: path }];
      const method = read(n.arguments[0], "request", "method");
      return method ? [{ kind: "method", access: method }] : null;
    }
    if (name === "test" && ts.isRegularExpressionLiteral(object)) {
      const path = read(n.arguments[0], "url", "pathname");
      return path ? [{ kind: "pathname", access: path }] : null;
    }
  }
  return null;
}

// --- RuntimeInstances and delegates -------------------------------------------------

/** Canonical form of a class member written as source text. */
function canonicalMember(ts, text) {
  const sf = parseStrict(ts, "member.js", `class Member {\n${text}\n}`);
  return canonical(ts, sf.statements[0].members[0]);
}

/**
 * The one reviewed position of the instance as a value, shared by
 * `classMethods` and the module graph: `this` as the first argument of the
 * property definition in the RuntimeInstances `sql` setter (`REVIEWED.sqlSetter`,
 * compared as the whole member). The setter is the only `set sql` of the
 * module-level RuntimeInstances class of the Durable Object file and is not
 * static, `Object` is the unshadowed built-in, the defined key is the literal
 * `sql`, and its data value is the setter's own parameter. Another key,
 * descriptor, member, class, file or position is not admitted.
 */
function isReviewedSqlSetterThis(ts, sf, node) {
  if (sf.fileName !== DURABLE || node.kind !== ts.SyntaxKind.ThisKeyword) return false;
  const argument = outer(ts, node);
  const call = argument.parent;
  if (!call || !ts.isCallExpression(call) || call.arguments[0] !== argument) return false;
  const statement = outer(ts, call).parent;
  const block = statement?.parent;
  const accessor = block?.parent;
  if (!statement || !ts.isExpressionStatement(statement) || !block || !ts.isBlock(block) || !accessor || !ts.isSetAccessorDeclaration(accessor) || accessor.body !== block) return false;
  const cls = accessor.parent;
  if (!ts.isClassDeclaration(cls) || cls.name?.text !== "RuntimeInstances" || cls.parent !== sf || accessor.modifiers?.length) return false;
  if (cls.members.filter(member => ts.isSetAccessorDeclaration(member) && member.name && ts.isIdentifier(member.name) && member.name.text === "sql").length !== 1) return false;
  if (canonical(ts, accessor) !== canonicalMember(ts, REVIEWED.sqlSetter)) return false;
  const global = unwrap(ts, unwrap(ts, call.expression).expression);
  if (!ts.isIdentifier(global) || (symbolOf(ts, sf, global)?.declarations || []).length) return false;
  const value = unwrap(ts, call.arguments[2]).properties.find(property => ts.isShorthandPropertyAssignment(property));
  return !!value && symbolOf(ts, sf, value.name) === symbolOf(ts, sf, accessor.parameters[0].name);
}

function classMethods(ts, sf, className, label, audit = {}) {
  const classes = sf.statements.filter(s => ts.isClassDeclaration(s) && s.name?.text === className);
  if (classes.length !== 1) throw new SurfaceError(`${label}: entry_missing: expected one class ${className}, found ${classes.length}`);
  const [cls] = classes;
  if (!cls.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) throw new SurfaceError(`${label}: export_form: class ${className} is not a named export`);
  if (cls.heritageClauses?.length) throw new SurfaceError(`${label}: export_form: class ${className} extends another class`);
  const methods = new Map();
  const problems = [];
  for (const member of cls.members) {
    const name = member.name && (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name) || ts.isPrivateIdentifier(member.name)) ? member.name.text : null;
    if (member.name && ts.isComputedPropertyName(member.name)) { problems.push(`${label}: export_form: computed class member: ${excerpt(sf, member)}`); continue; }
    // A static member or block runs with the class as `this`.
    if (ts.isClassStaticBlockDeclaration(member) || member.modifiers?.some(m => m.kind === ts.SyntaxKind.StaticKeyword)) {
      problems.push(`${label}: entry_replaced: static member of ${className} is not admitted: ${excerpt(sf, member)}`);
      continue;
    }
    if (!name) continue;
    if (!methods.has(name)) methods.set(name, []);
    methods.get(name).push(member);
  }
  // Entry replacement through the instance: `this` is admitted only as the
  // object of a dotted property access that neither writes an entry nor
  // names a prototype link; instance fields holding another entry object are
  // used only through their reviewed method calls.
  //
  // Instance as a value (review FIX12): the instance reaches a value position
  // only through `this` itself, or through a call on it whose callee returns
  // its receiver. The first is the positional rule here and, for every reached
  // module, in `auditModules`. For the second, a call or tag `this.name` must
  // name a method declared in the class body, whose body this rule audits, and
  // no declared method is written: an own property holding a function the
  // source does not show (`[].reverse`, `{}.valueOf`, a nested function
  // returning `this`) is never invoked with the instance as its receiver. The
  // rules apply at every depth of the class body, nested non-arrow functions
  // included, since an installed function runs with the instance as `this`.
  // A reviewed injected callable (`audit.injected`: name -> default) is
  // invoked too: its constructor parameter defaults to that built-in, it is
  // stored once by `this.name = name;` in the constructor, and the module graph
  // admits no construction that passes it.
  const entries = new Set(["constructor", ...(audit.entries || [])]);
  const fields = audit.fields || {};
  const declared = new Set([...methods].filter(([, found]) => found.every(member => ts.isMethodDeclaration(member) && member.body)).map(([name]) => name));
  const fail = (node, detail) => problems.push(`${label}: entry_replaced: ${detail} (line ${lineOf(sf, node)}): ${excerpt(sf, enclosingStatement(ts, node))}`);
  const injected = new Set();
  const [constructor] = cls.members.filter(member => ts.isConstructorDeclaration(member));
  for (const [name, fallback] of Object.entries(audit.injected || {})) {
    const parameter = constructor?.parameters.find(p => ts.isIdentifier(p.name) && p.name.text === name);
    const stores = [];
    const collect = node => {
      if (ts.isPropertyAccessExpression(node) && node.name.text === name && unwrap(ts, node.expression).kind === ts.SyntaxKind.ThisKeyword && isWriteTarget(ts, node)) stores.push(node);
      ts.forEachChild(node, collect);
    };
    collect(cls);
    const statement = stores.length === 1 ? enclosingStatement(ts, stores[0]) : null;
    if (parameter?.initializer && canonical(ts, parameter.initializer) === canonicalExpression(ts, fallback) && statement?.parent?.parent === constructor
      && canonical(ts, statement) === canonicalStatements(ts, `this.${name} = ${name};`)[0]) injected.add(name);
    else problems.push(`${label}: entry_replaced: injected callable this.${name} of ${className} is not the reviewed constructor parameter defaulting to ${fallback}, stored once`);
  }
  const visit = node => {
    if (node.kind === ts.SyntaxKind.ThisKeyword) {
      const top = outer(ts, node);
      const access = top.parent;
      if (ts.isElementAccessExpression(access) && access.expression === top) fail(node, `computed access on this in ${className}`);
      else if (!ts.isPropertyAccessExpression(access) || access.expression !== top) {
        if (!isReviewedSqlSetterThis(ts, sf, node)) fail(node, `this used as a value in ${className}`);
      }
      else {
        const name = access.name.text;
        const use = outer(ts, access).parent;
        const invoked = use && ((ts.isCallExpression(use) && use.expression === outer(ts, access)) || (ts.isTaggedTemplateExpression(use) && use.tag === outer(ts, access)));
        if (PROTOTYPE_LINKS.has(name)) fail(node, `this.${name} in ${className}`);
        else if (entries.has(name) && isWriteTarget(ts, access)) fail(node, `write to entry this.${name} in ${className}`);
        else if (declared.has(name) && isWriteTarget(ts, access)) fail(node, `write to declared method this.${name} in ${className}`);
        else if (invoked && !declared.has(name) && !injected.has(name)) fail(node, `this.${name} is invoked but is not a method declared in ${className}`);
        else if (Object.hasOwn(fields, name) && !isWriteTarget(ts, access)) {
          const use = outer(ts, access).parent;
          const call = use && ts.isPropertyAccessExpression(use) && use.expression === outer(ts, access) ? outer(ts, use).parent : null;
          if (!call || !ts.isCallExpression(call) || unwrap(ts, call.expression) !== use || !fields[name].includes(use.name.text)) fail(node, `this.${name} used other than through ${fields[name].map(m => `.${m}()`).join(", ")}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(cls, visit);
  const method = (name, params) => {
    const found = methods.get(name) || [];
    if (found.length !== 1) throw new SurfaceError(`${label}: ${found.length ? "entry_duplicate" : "entry_missing"}: ${className}.${name} (${found.length}x)`);
    const [member] = found;
    if (!ts.isMethodDeclaration(member) || member.asteriskToken || !member.body) throw new SurfaceError(`${label}: entry_form: ${className}.${name} is not a plain method`);
    const names = member.parameters.map(p => (ts.isIdentifier(p.name) && !p.initializer && !p.dotDotDotToken ? p.name.text : null));
    if (names.join(",") !== params.join(",")) throw new SurfaceError(`${label}: entry_form: expected ${className}.${name}(${params.join(", ")})`);
    return member;
  };
  return { method, members: methods, problems };
}

function topFunction(ts, sf, name, params, label) {
  const found = sf.statements.filter(s => ts.isFunctionDeclaration(s) && s.name?.text === name);
  if (found.length !== 1) throw new SurfaceError(`${label}: ${found.length ? "entry_duplicate" : "entry_missing"}: function ${name} (${found.length}x)`);
  const [fn] = found;
  // Every reference to the binding is a call (`auditModules` checks the
  // other modules): an assignment in any form or an alias replaces it.
  const binding = symbolOf(ts, sf, fn.name);
  const others = [];
  const visit = node => {
    if (ts.isIdentifier(node) && node !== fn.name && !isNamePosition(ts, node)) {
      if (isDeclarationName(ts, node) ? node.text === name : symbolOf(ts, sf, node) === binding) {
        const top = outer(ts, node);
        if (isDeclarationName(ts, node) || !ts.isCallExpression(top.parent) || top.parent.expression !== top) others.push(node);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (others.length) throw new SurfaceError(`${label}: entry_replaced: ${name} is reassigned, redeclared or aliased: ${excerpt(sf, enclosingStatement(ts, others[0]))}`);
  const names = fn.parameters.map(p => (ts.isIdentifier(p.name) && !p.dotDotDotToken ? p.name.text : null));
  if (names.join(",") !== params.join(",")) throw new SurfaceError(`${label}: entry_form: expected ${name}(${params.join(", ")})`);
  return fn;
}

/** Path of a relative import from `from`. */
const resolvePath = (from, specifier) => normalize(join(dirname(from), specifier)).replace(/\\/g, "/");

/** Imported binding `name` in `sf`: { module, imported } or null. Throws if ambiguous. */
function importOf(ts, sf, name) {
  const found = [];
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) if (element.name.text === name) found.push({ module: statement.moduleSpecifier.text, imported: (element.propertyName || element.name).text });
    }
    if (statement.importClause?.name?.text === name || (bindings && ts.isNamespaceImport(bindings) && bindings.name.text === name)) found.push({ module: statement.moduleSpecifier.text, imported: null });
  }
  if (found.length > 1) throw new SurfaceError(`${sf.fileName}: entry_duplicate: ${name} imported ${found.length}x`);
  return found[0] || null;
}

/** Resolve exported `name` of `path` to its declaration { path, sf, declaration }. */
function resolveExport(ts, file, path, name, depth = 0) {
  if (depth > 8) throw new SurfaceError(`family_unresolved: export chain for ${name} too deep`);
  const sf = file(path);
  const found = [];
  let star = false;
  for (const statement of sf.statements) {
    if (ts.isVariableStatement(statement) && statement.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
      for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name) && declaration.name.text === name) found.push(() => ({ path, sf, declaration }));
    }
    if ((ts.isClassDeclaration(statement) || ts.isFunctionDeclaration(statement)) && statement.name?.text === name
      && statement.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) && !statement.modifiers.some(m => m.kind === ts.SyntaxKind.DefaultKeyword)) found.push(() => ({ path, sf, declaration: statement }));
    if (ts.isExportDeclaration(statement)) {
      if (!statement.exportClause) { star = true; continue; }
      if (!ts.isNamedExports(statement.exportClause)) continue;
      for (const element of statement.exportClause.elements) {
        if (element.name.text !== name) continue;
        const local = (element.propertyName || element.name).text;
        if (statement.moduleSpecifier) found.push(() => resolveExport(ts, file, resolvePath(path, statement.moduleSpecifier.text), local, depth + 1));
        else found.push(() => resolveLocal(ts, file, path, local, depth + 1));
      }
    }
  }
  if (found.length !== 1) throw new SurfaceError(`family_unresolved: ${name} has ${found.length} exports in ${path}${star && !found.length ? " (export * is not followed)" : ""}`);
  return found[0]();
}
function resolveLocal(ts, file, path, name, depth) {
  const sf = file(path);
  const imported = importOf(ts, sf, name);
  const locals = [];
  for (const statement of sf.statements) {
    if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name) && declaration.name.text === name) locals.push(declaration);
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name?.text === name) locals.push(statement);
  }
  if (locals.length + (imported ? 1 : 0) !== 1) throw new SurfaceError(`family_unresolved: ${name} has ${locals.length + (imported ? 1 : 0)} bindings in ${path}`);
  if (imported) {
    if (!imported.imported) throw new SurfaceError(`family_unresolved: ${name} is a default or namespace import in ${path}`);
    return resolveExport(ts, file, resolvePath(path, imported.module), imported.imported, depth + 1);
  }
  return { path, sf, declaration: locals[0] };
}

/**
 * Literal members of family `name` as imported by `fromPath`. Every use of the
 * family binding is checked by `auditModules` across the bundle.
 */
function familyMembers(ts, file, fromPath, name, families) {
  const imported = importOf(ts, file(fromPath), name);
  if (!imported?.imported) throw new SurfaceError(`family_unknown: unknown action family ${name} (not a named import)`);
  const { path, declaration } = resolveExport(ts, file, resolvePath(fromPath, imported.module), imported.imported);
  if (!ts.isVariableDeclaration(declaration) || !(declaration.parent.flags & ts.NodeFlags.Const)) throw new SurfaceError(`family_dynamic: ${name} is not a const declaration in ${path}`);
  const init = unwrap(ts, declaration.initializer);
  if (!init || !ts.isNewExpression(init) || !ts.isIdentifier(init.expression) || init.expression.text !== "Set" || init.arguments?.length !== 1
    || !ts.isArrayLiteralExpression(unwrap(ts, init.arguments[0])) || !unwrap(ts, init.arguments[0]).elements.every(element => isStringLiteral(ts, element))) {
    throw new SurfaceError(`family_dynamic: ${name} in ${path} is not new Set([...string literals])`);
  }
  const members = unwrap(ts, init.arguments[0]).elements.map(element => literalValue(ts, element));
  if (new Set(members).size !== members.length) throw new SurfaceError(`family_dynamic: ${name} lists a member twice`);
  families.push({ path, name: declaration.name.text, label: name });
  return members;
}

function extractDurable(ts, file, reviewed, ctx) {
  const { internal, errors, templates, finishTemplates } = ctx;
  const sf = file(DURABLE);
  const label = "durable_object.js";
  const { method, members, problems } = classMethods(ts, sf, "RuntimeInstances", label, { entries: ["fetch", "alarm", "ux1ResearchCommand"], fields: { directory: ["command"] } });
  errors.push(...problems);
  for (const handler of ["webSocketMessage", "webSocketClose", "webSocketError"]) {
    if (members.has(handler)) errors.push(`${label}: entry_unsupported: RuntimeInstances.${handler} is not a classified entry`);
  }
  // The runtime binds the class the Worker module exports under this name.
  const bound = resolveExport(ts, file, WORKER, "RuntimeInstances");
  if (bound.path !== DURABLE || !ts.isClassDeclaration(bound.declaration)) errors.push(`${label}: entry_replaced: worker.js does not export the RuntimeInstances class of ${DURABLE}`);
  if (members.has("alarm")) {
    const alarm = method("alarm", []);
    if (JSON.stringify(alarm.body.statements.map(s => canonical(ts, s))) !== JSON.stringify(reviewed.doAlarm.flatMap(text => canonicalStatements(ts, text)))) {
      errors.push(`${label}: statement: RuntimeInstances.alarm is not the reviewed alarm body: ${excerpt(sf, alarm)}`);
    }
    internal.add("action:lifecycle:alarm");
  }
  const fetch = method("fetch", ["request"]);
  const report = message => errors.push(`RuntimeInstances.fetch: ${message}`);
  const add = (id, family) => {
    if (internal.has(id)) report(`family_overlap: action dispatched by two families: ${id} (${family})`);
    internal.add(id);
  };
  const comparisons = [];
  const methods = [];
  const gated = new Set();
  const covered = new Set();
  const consumed = new Set();
  const delegates = [];

  // The reviewed preamble, then one try/catch statement.
  const statements = fetch.body.statements;
  const dispatch = statements.at(-1);
  if (!dispatch || !ts.isTryStatement(dispatch) || dispatch.finallyBlock || !dispatch.catchClause) {
    throw new SurfaceError(`${label}: entry_form: RuntimeInstances.fetch must end in one try/catch statement`);
  }
  const preamble = statements.slice(0, -1);
  const expectedPreamble = reviewed.doPreamble.map(text => canonicalStatements(ts, text)[0]);
  if (preamble.length !== expectedPreamble.length || preamble.some((statement, index) => canonical(ts, statement) !== expectedPreamble[index])) {
    report(`statement: preamble is not the reviewed inventory dispatch then storage initialization: ${excerpt(sf, preamble.find((statement, index) => canonical(ts, statement) !== expectedPreamble[index]) || fetch)}`);
  } else {
    for (const statement of preamble) covered.add(statement);
    auditForwardTargets(ts, sf, fetch, preamble.slice(0, -1), reviewed.doPreambleTargets, message => report(message.replace(/^forward_target: /, "forward_target: inventory preamble: ")));
    const found = guardSurface(report, () => inventorySections(ts, file, reviewed));
    if (found) {
      add("action:account_identity_inventory", "inventory path");
      ctx.sections.set("action:account_identity_inventory", found);
    }
    // The fixed management read path: one observation, no sections.
    add("action:account_management_read", "management read path");
  }
  const body = [dispatch];
  const level = templates("RuntimeInstances.fetch", reviewed.doFetch);
  const tryBody = body[0].tryBlock.statements;
  if (canonical(ts, body[0].catchClause) !== canonicalCatch(ts, reviewed.doCatch)) report(`statement: catch clause is not the reviewed error response: ${excerpt(sf, body[0].catchClause)}`);
  else covered.add(body[0].catchClause);
  let finished = false;
  for (const [index, statement] of tryBody.entries()) {
    if (finished) { report(`statement: statement after the final fallthrough: ${excerpt(sf, statement)}`); continue; }
    const key = canonical(ts, statement);
    const template = level.map.get(key);
    if (template) { template.seen += 1; covered.add(statement); continue; }
    if (isInertLiteral(ts, statement)) continue;
    if (ts.isReturnStatement(statement)) {
      finished = true;
      const callback = transactionCallback(ts, statement, "json");
      if (!callback) { report(`statement: final fallthrough is not json(this.storage.transactionSync(() => { ... })): ${excerpt(sf, statement)}`); continue; }
      const nested = templates("RuntimeInstances transaction", reviewed.doTransaction);
      auditLevel(ts, sf, callback.body.statements, nested, { covered, gated, report: message => errors.push(`RuntimeInstances transaction: ${message}`), allowElse: true, keys: ["command"] });
      finishTemplates(nested, message => errors.push(message));
      continue;
    }
    if (!ts.isIfStatement(statement)) { report(`statement: dispatch-level statement not admitted: ${excerpt(sf, statement)}`); continue; }
    if (statement.elseStatement) report(`else_dispatch: else-branch dispatch is not admitted: ${excerpt(sf, statement.expression)}`);
    const gate = gateOf(ts, statement.expression, ["command"]);
    const path = pathGate(ts, statement.expression);
    const methodBranch = methodGate(ts, statement.expression);
    if (path) {
      consumed.add(path.access);
      if (path.target !== "DIRECTORY_PATH") { report(`prefix_unknown: unknown path delegate ${path.target}`); continue; }
      const expected = reviewed.doDirectoryBranch.map(text => canonicalStatements(ts, text)[0]);
      const actual = statementsOf(ts, statement.thenStatement).map(s => canonical(ts, s));
      if (JSON.stringify(actual) !== JSON.stringify(expected)) report(`delegate: DIRECTORY_PATH branch is not the reviewed directory delegate: ${excerpt(sf, statement)}`);
      covered.add(statement.thenStatement);
      delegates.push("directory");
      continue;
    }
    if (methodBranch) {
      consumed.add(methodBranch.access);
      methods.push(methodBranch.value);
      gated.add(statement.thenStatement);
      continue;
    }
    if (!gate) { report(`statement: dispatch-level statement not admitted: ${excerpt(sf, statement)}`); continue; }
    // A single comparison is recorded by the receiver scan below, as for
    // comparisons anywhere in the body; lists, families and prefixes here.
    if (gate.kind !== "eq") for (const access of gate.accesses) consumed.add(access);
    if (gate.kind === "prefix") {
      const expected = reviewed.doPrefixBranch[gate.prefix];
      if (!expected) { report(`prefix_unknown: unknown action prefix ${gate.prefix} in RuntimeInstances.fetch`); continue; }
      const actual = statementsOf(ts, statement.thenStatement).map(s => canonical(ts, s));
      if (JSON.stringify(actual) !== JSON.stringify(canonicalStatements(ts, expected))) { report(`delegate: ${gate.prefix} branch is not the reviewed delegate: ${excerpt(sf, statement)}`); continue; }
      covered.add(statement.thenStatement);
      delegates.push(gate.prefix);
      continue;
    }
    if (gate.kind === "neq") { report(`statement: inequality dispatch at RuntimeInstances.fetch level is not admitted: ${excerpt(sf, statement.expression)}`); continue; }
    if (gate.kind === "family") {
      const members = (() => { try { return familyMembers(ts, file, DURABLE, gate.family, ctx.families); } catch (error) { if (error instanceof SurfaceError) { report(error.message); return null; } throw error; } })();
      for (const action of members || []) add(`action:${action}`, gate.family);
    } else if (gate.kind === "list") {
      for (const action of gate.values) add(`action:${action}`, "literal list");
    }
    gated.add(statement.thenStatement);
  }
  if (!finished) report("statement: no final transaction fallthrough");
  finishTemplates(level, message => errors.push(message));

  const receivers = declarationsOf(ts, fetch, tryBody, ["request", "command"]);
  const forwards = templates("RuntimeInstances.fetch forwards", reviewed.doForwards.map(([text, count]) => [text, count, "expression"]));
  const forwarded = scanReceivers(ts, sf, fetch.body, {
    keys: { request: new Set(["method", "url"]), command: new Set(["action"]) },
    payload: { request: new Set(), command: "any" },
    declarations: new Set(receivers),
    gated, covered, consumed, forwards, recognise: true,
    onForm: (form, access, receiver, key, isCovered) => {
      if (receiver === "request") {
        if (key === "method" && form.kind === "eq") methods.push(form.values[0]);
        else if (!(key === "method" && form.kind === "neq" && isCovered)) report(`dispatch_form: request.${key} form not admitted (line ${lineOf(sf, access)}): ${excerpt(sf, enclosingStatement(ts, access))}`);
        return;
      }
      if (form.kind === "eq" || form.kind === "neq") comparisons.push(form.values[0]);
      else if (form.kind === "list") for (const value of form.values) comparisons.push(value);
      else if (form.kind !== "prefix" && form.kind !== "prefix-partner") report(`dispatch_form: nested ${form.kind} dispatch is not admitted (line ${lineOf(sf, access)}): ${excerpt(sf, enclosingStatement(ts, access))}`);
      else report(`dispatch_form: nested prefix dispatch is not admitted (line ${lineOf(sf, access)}): ${excerpt(sf, enclosingStatement(ts, access))}`);
    },
  }, report);
  finishTemplates(forwards, report);
  auditForwardTargets(ts, sf, fetch, forwarded, reviewed.doForwardTargets, report);
  auditExecutable(ts, sf, fetch, {
    covered, receivers, computed: templates("RuntimeInstances.fetch computed", reviewed.doComputed), finishTemplates,
    pinned: [...covered, ...forwarded],
  }, report);
  for (const value of methods) internal.add(`action:instance_state:${value}`);

  for (const prefix of delegates) {
    const actions = prefix === "rotation_" ? rotationActions(ts, file, reviewed, ctx) : prefix === "ux1_" ? ux1Actions(ts, sf, method, reviewed, ctx) : null;
    if (prefix === "directory") { for (const action of directoryActions(ts, file, reviewed, ctx)) internal.add(`action:directory:${action}`); continue; }
    if (!actions.length) errors.push(`${prefix} delegate: empty_extraction: no action extracted`);
    for (const action of new Set(actions)) {
      if (!action.startsWith(prefix)) errors.push(`${prefix} delegate: prefix_mismatch: prefix family ${prefix} dispatches ${action}`);
      add(`action:${action}`, prefix);
    }
  }
  // Comparisons on actions already dispatched by a family are not new actions.
  for (const action of comparisons) if (!internal.has(`action:${action}`)) internal.add(`action:instance_state:${action}`);
}

/** `fn()`, or null with its SurfaceError reported. */
function guardSurface(report, fn) {
  try { return fn(); } catch (error) { if (!(error instanceof SurfaceError)) throw error; report(error.message); return null; }
}

/**
 * Section set of the inventory delegate `inventoryResponse(request, cap)` in
 * the inventory HTTP module, its one location (no other file is searched):
 * the reviewed response helper, then one try statement with the
 * reviewed catch clause, whose block holds the reviewed statements, one gate
 * per section and the reviewed rejection of an unknown section last. A gate
 * is exactly `if (command.section === "<name>") return respond({ ...base,
 * ...await <page>(cap) });` (or `(cap, command)`), where `<page>` is a
 * module-level function of that same module. Returns the section names in order.
 */
const INVENTORY_HTTP = `${CONSOLE}/application/account_identity_inventory/http.js`;
function inventorySections(ts, file, reviewed) {
  const sf = file(INVENTORY_HTTP);
  const label = "inventoryResponse";
  const fail = detail => { throw new SurfaceError(`${label}: ${detail}`); };
  const fn = topFunction(ts, sf, "inventoryResponse", ["request", "cap"], label);
  const [respond, attempt, ...rest] = fn.body.statements;
  if (rest.length || !respond || canonical(ts, respond) !== canonicalStatements(ts, reviewed.inventoryRespond)[0]) fail("statement: body is not the reviewed response helper then one try statement");
  if (!attempt || !ts.isTryStatement(attempt) || attempt.finallyBlock || !attempt.catchClause) fail("statement: body is not the reviewed response helper then one try statement");
  if (canonical(ts, attempt.catchClause) !== canonicalCatch(ts, reviewed.inventoryCatch)) fail(`statement: catch clause is not the reviewed error response: ${excerpt(sf, attempt.catchClause)}`);
  const expected = new Map();
  for (const [text, count] of reviewed.inventory) {
    for (const key of canonicalStatements(ts, text)) expected.set(key, { text, count: (expected.get(key)?.count || 0) + count, seen: 0 });
  }
  const fallthrough = canonicalStatements(ts, reviewed.inventoryFallthrough)[0];
  const block = attempt.tryBlock.statements;
  const sections = [];
  for (const [index, statement] of block.entries()) {
    const key = canonical(ts, statement);
    if (index === block.length - 1) {
      if (key !== fallthrough) fail(`statement: final statement is not the reviewed unknown-section rejection: ${excerpt(sf, statement)}`);
      continue;
    }
    const entry = expected.get(key);
    if (entry) { entry.seen += 1; continue; }
    const section = sectionGate(ts, sf, statement);
    if (section === null) fail(`inventory_section: statement is neither reviewed nor a section gate: ${excerpt(sf, statement)}`);
    if (sections.includes(section)) fail(`inventory_section: section ${section} is dispatched twice`);
    sections.push(section);
  }
  for (const entry of expected.values()) {
    if (entry.seen !== entry.count) fail(`template_multiplicity: reviewed ${entry.count}x, found ${entry.seen}x: ${collapse(entry.text)}`);
  }
  if (!sections.length) fail("empty_extraction: no inventory section");
  return sections;
}
function sectionGate(ts, sf, statement) {
  if (!ts.isIfStatement(statement) || statement.elseStatement) return null;
  const test = unwrap(ts, statement.expression);
  if (!ts.isBinaryExpression(test) || test.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken || !isStringLiteral(ts, test.right)) return null;
  const read = unwrap(ts, test.left);
  if (!ts.isPropertyAccessExpression(read) || read.questionDotToken || read.name.text !== "section") return null;
  const receiver = unwrap(ts, read.expression);
  if (!ts.isIdentifier(receiver) || receiver.text !== "command") return null;
  const page = statementsOf(ts, statement.thenStatement).length === 1 ? pageCall(ts, statementsOf(ts, statement.thenStatement)[0]) : null;
  if (!page) return null;
  const [declaration] = symbolOf(ts, sf, page.expression)?.declarations || [];
  if (bindingIdentity(ts, sf, page.expression) !== "local" || !ts.isFunctionDeclaration(declaration)) return null;
  const args = page.arguments.length === 1 ? "cap" : "cap, command";
  if (canonical(ts, statementsOf(ts, statement.thenStatement)[0]) !== canonicalStatements(ts, `return respond({ ...base, ...await ${page.expression.text}(${args}) });`)[0]) return null;
  return literalValue(ts, test.right);
}
/** The page call `<name>(...)` inside `return respond({ ...base, ...await <name>(...) });`, or null. */
function pageCall(ts, statement) {
  const call = ts.isReturnStatement(statement) && statement.expression ? unwrap(ts, statement.expression) : null;
  const object = call && ts.isCallExpression(call) && call.arguments.length === 1 ? unwrap(ts, call.arguments[0]) : null;
  const spread = object && ts.isObjectLiteralExpression(object) && object.properties.length === 2 ? object.properties[1] : null;
  const awaited = spread && ts.isSpreadAssignment(spread) ? unwrap(ts, spread.expression) : null;
  const page = awaited && ts.isAwaitExpression(awaited) ? unwrap(ts, awaited.expression) : null;
  return page && ts.isCallExpression(page) && ts.isIdentifier(page.expression) && [1, 2].includes(page.arguments.length) ? page : null;
}

/** The receivers' own declarations: parameters, and `let` bindings directly in `level`. */
function declarationsOf(ts, fn, level, names) {
  const found = fn.parameters.map(p => p.name).filter(name => ts.isIdentifier(name) && names.includes(name.text));
  for (const statement of level) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && names.includes(declaration.name.text)) found.push(declaration.name);
    }
  }
  return found;
}

/** `return <wrap>(this.storage.transactionSync(() => { ... }))` or without wrap. */
function transactionCallback(ts, statement, wrap) {
  if (!ts.isReturnStatement(statement) || !statement.expression) return null;
  let call = unwrap(ts, statement.expression);
  if (wrap) {
    if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression) || call.expression.text !== wrap || call.arguments.length !== 1) return null;
    call = unwrap(ts, call.arguments[0]);
  }
  if (!ts.isCallExpression(call) || call.arguments.length !== 1) return null;
  const callee = unwrap(ts, call.expression);
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== "transactionSync") return null;
  const store = unwrap(ts, callee.expression);
  if (!ts.isPropertyAccessExpression(store) || store.name.text !== "storage" || unwrap(ts, store.expression).kind !== ts.SyntaxKind.ThisKeyword) return null;
  const callback = unwrap(ts, call.arguments[0]);
  if (!ts.isArrowFunction(callback) || callback.parameters.length || !ts.isBlock(callback.body) || callback.modifiers?.length) return null;
  return callback;
}

/** Gate of a dispatch-level condition on `receivers`' action, or null. */
function gateOf(ts, condition, receivers) {
  const n = unwrap(ts, condition);
  const accessOf = node => {
    const access = unwrap(ts, node);
    return ts.isPropertyAccessExpression(access) && access.name.text === "action" && ts.isIdentifier(unwrap(ts, access.expression))
      && receivers.includes(unwrap(ts, access.expression).text) ? access : null;
  };
  if (isEquality(ts, n)) {
    const [access, other] = accessOf(n.left) ? [accessOf(n.left), n.right] : [accessOf(n.right), n.left];
    if (access && isStringLiteral(ts, other)) return { kind: n.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ? "eq" : "neq", values: [literalValue(ts, other)], accesses: [access] };
    return null;
  }
  if (ts.isCallExpression(n) && n.arguments.length === 1) {
    const access = accessOf(n.arguments[0]);
    const form = access ? dispatchForm(ts, access) : null;
    if (form && (form.kind === "list" || form.kind === "family") && form.node === n) return { ...form, accesses: [access] };
    return null;
  }
  if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    const compare = unwrap(ts, n.left);
    if (!isEquality(ts, compare)) return null;
    const typeOf = [compare.left, compare.right].map(side => unwrap(ts, side)).find(side => ts.isTypeOfExpression(side));
    const access = typeOf && accessOf(typeOf.expression);
    const form = access ? dispatchForm(ts, access) : null;
    if (form?.kind === "prefix" && form.node === n) return { kind: "prefix", prefix: form.prefix, accesses: [access, unwrap(ts, form.partner)] };
  }
  return null;
}
/** `new URL(request.url).pathname === IDENT` */
function pathGate(ts, condition) {
  const n = unwrap(ts, condition);
  if (!ts.isBinaryExpression(n) || n.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken || !ts.isIdentifier(unwrap(ts, n.right))) return null;
  const path = unwrap(ts, n.left);
  if (!ts.isPropertyAccessExpression(path) || path.name.text !== "pathname" || path.questionDotToken) return null;
  const made = unwrap(ts, path.expression);
  if (!ts.isNewExpression(made) || !ts.isIdentifier(made.expression) || made.expression.text !== "URL" || made.arguments?.length !== 1) return null;
  const access = unwrap(ts, made.arguments[0]);
  if (!ts.isPropertyAccessExpression(access) || access.name.text !== "url" || !ts.isIdentifier(unwrap(ts, access.expression)) || unwrap(ts, access.expression).text !== "request") return null;
  return { access, target: unwrap(ts, n.right).text };
}
/** `request.method === "M"` */
function methodGate(ts, condition) {
  const n = unwrap(ts, condition);
  if (!ts.isBinaryExpression(n) || n.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken || !isStringLiteral(ts, n.right)) return null;
  const access = unwrap(ts, n.left);
  if (!ts.isPropertyAccessExpression(access) || access.name.text !== "method" || !ts.isIdentifier(unwrap(ts, access.expression)) || unwrap(ts, access.expression).text !== "request") return null;
  return { access, value: literalValue(ts, n.right) };
}

/**
 * Audit one dispatch level: every statement is a recognised action branch
 * (gated), an exact reviewed template, or an error. With `allowElse`, the else
 * part of a branch is audited as a nested level (it is not gated).
 */
function auditLevel(ts, sf, statements, set, options) {
  let finished = false;
  for (const statement of statements) {
    if (finished) { options.report(`statement: statement after the final fallthrough: ${excerpt(sf, statement)}`); continue; }
    const template = set.map.get(canonical(ts, statement));
    if (template) {
      template.seen += 1;
      options.covered.add(statement);
      if (isTerminal(ts, statement)) finished = true;
      continue;
    }
    if (isInertLiteral(ts, statement)) continue;
    if (ts.isIfStatement(statement)) {
      const gate = gateOf(ts, statement.expression, options.keys);
      if (gate && gate.kind !== "prefix" && gate.kind !== "family") {
        if (gate.kind === "neq") auditLevel(ts, sf, statementsOf(ts, statement.thenStatement), set, options);
        else options.gated.add(statement.thenStatement);
        if (statement.elseStatement) {
          if (options.allowElse) auditLevel(ts, sf, statementsOf(ts, statement.elseStatement), set, options);
          else options.report(`else_dispatch: else-branch dispatch is not admitted: ${excerpt(sf, statement.expression)}`);
        }
        continue;
      }
    }
    options.report(`statement: dispatch-level statement not admitted: ${excerpt(sf, statement)}`);
  }
}

function delegateScan(ts, sf, fn, receiver, set, ctx, label, levelStatements, extra = {}) {
  const { errors, finishTemplates } = ctx;
  const report = message => errors.push(`${label}: ${message}`);
  const gated = new Set();
  const covered = new Set();
  const actions = [];
  auditLevel(ts, sf, levelStatements, set, { covered, gated, report, allowElse: false, keys: [receiver] });
  finishTemplates(set, message => errors.push(message));
  if (extra.uses) {
    // Reviewed whole-receiver uses inside branch bodies, matched exactly.
    const uses = ctx.templates(`${label} uses`, extra.uses);
    const visit = node => {
      const entry = ts.isStatement(node) ? uses.map.get(canonical(ts, node)) : null;
      if (entry) { entry.seen += 1; covered.add(node); }
      ts.forEachChild(node, visit);
    };
    visit(fn.body);
    finishTemplates(uses, message => errors.push(message));
  }
  const declarations = fn.parameters.filter(p => ts.isIdentifier(p.name) && p.name.text === receiver).map(p => p.name);
  const forwards = ctx.templates(`${label} forwards`, (extra.forwards || []).map(([text, count]) => [text, count, "expression"]));
  const forwarded = scanReceivers(ts, sf, fn.body, {
    keys: { [receiver]: new Set(["action"]) },
    payload: { [receiver]: "any" },
    declarations: new Set(declarations),
    gated, covered, consumed: new Set(), forwards, recognise: true,
    onForm: (form, access) => {
      if (form.kind === "eq" || form.kind === "neq" || (form.kind === "list" && extra.lists)) actions.push(...form.values);
      else report(`dispatch_form: ${form.kind} dispatch is not admitted (line ${lineOf(sf, access)}): ${excerpt(sf, enclosingStatement(ts, access))}`);
    },
  }, report);
  finishTemplates(forwards, message => errors.push(message));
  auditForwardTargets(ts, sf, fn, forwarded, extra.targets, report);
  auditExecutable(ts, sf, fn, {
    covered, receivers: declarations, computed: ctx.templates(`${label} computed`, extra.computed || []), finishTemplates,
    pinned: [...covered, ...forwarded],
  }, report);
  return actions;
}

function rotationActions(ts, file, reviewed, ctx) {
  const durable = file(DURABLE);
  const imported = importOf(ts, durable, "durableRotationCommand");
  if (!imported || resolvePath(DURABLE, imported.module) !== ROTATION || imported.imported !== "durableRotationCommand") {
    ctx.errors.push("rotation_ delegate: delegate: durableRotationCommand is not imported from secretRotation.js");
    return [];
  }
  const sf = file(ROTATION);
  const outerFn = topFunction(ts, sf, "durableRotationCommand", ["storage", "sql", "env", "command"], "secretRotation.js");
  const inner = topFunction(ts, sf, "rotationCommand", ["sql", "c", "factors"], "secretRotation.js");
  for (const fn of [outerFn, inner]) if (!fn.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) ctx.errors.push(`secretRotation.js: export_form: ${fn.name.text} is not exported`);
  return [
    ...delegateScan(ts, sf, outerFn, "command", ctx.templates("durableRotationCommand", reviewed.durableRotation), ctx, "durableRotationCommand", outerFn.body.statements),
    ...delegateScan(ts, sf, inner, "c", ctx.templates("rotationCommand", reviewed.rotation), ctx, "rotationCommand", inner.body.statements, { uses: reviewed.rotationUses, forwards: reviewed.rotationForwards, targets: reviewed.rotationForwardTargets, computed: reviewed.rotationComputed }),
  ];
}

function ux1Actions(ts, sf, method, reviewed, ctx) {
  const fn = method("ux1ResearchCommand", ["command"]);
  const statements = fn.body.statements;
  const callback = statements.length === 1 ? transactionCallback(ts, statements[0], null) : null;
  if (!callback) { ctx.errors.push("ux1ResearchCommand: statement: body must be return this.storage.transactionSync(() => { ... })"); return []; }
  return delegateScan(ts, sf, fn, "command", ctx.templates("ux1ResearchCommand", reviewed.ux1), ctx, "ux1ResearchCommand", callback.body.statements, { lists: true, forwards: reviewed.ux1Forwards, targets: reviewed.ux1ForwardTargets });
}

function directoryActions(ts, file, reviewed, ctx) {
  const durable = file(DURABLE);
  const imported = importOf(ts, durable, "KvDirectory");
  const path = importOf(ts, durable, "DIRECTORY_PATH");
  if (!imported || resolvePath(DURABLE, imported.module) !== DIRECTORY || !path || resolvePath(DURABLE, path.module) !== DIRECTORY) {
    ctx.errors.push("directory delegate: delegate: KvDirectory and DIRECTORY_PATH are not imported from kv_directory.js");
    return [];
  }
  // The DO's directory is the one KvDirectory constructed in its constructor.
  const assignments = [];
  const visit = node => {
    if (ts.isBinaryExpression(node) && isAssignmentOperator(ts, node.operatorToken.kind) && ts.isPropertyAccessExpression(unwrap(ts, node.left))
      && unwrap(ts, node.left).name.text === "directory" && unwrap(ts, unwrap(ts, node.left).expression).kind === ts.SyntaxKind.ThisKeyword) assignments.push(node);
    ts.forEachChild(node, visit);
  };
  visit(durable);
  const constructed = assignments.length === 1 && ts.isNewExpression(unwrap(ts, assignments[0].right)) && ts.isIdentifier(unwrap(ts, assignments[0].right).expression)
    && unwrap(ts, assignments[0].right).expression.text === "KvDirectory" && ts.isConstructorDeclaration(assignments[0].parent.parent.parent);
  if (!constructed) { ctx.errors.push("directory delegate: delegate: this.directory is not exactly one new KvDirectory(...) in the constructor"); return []; }
  const sf = file(DIRECTORY);
  const { method, problems } = classMethods(ts, sf, "KvDirectory", "kv_directory.js", { entries: ["command", "run"], injected: { now: "Date.now" } });
  ctx.errors.push(...problems);
  const command = method("command", ["command"]);
  const run = method("run", ["command"]);
  return [
    ...delegateScan(ts, sf, command, "command", ctx.templates("KvDirectory.command", reviewed.directoryCommand), ctx, "KvDirectory.command", command.body.statements),
    ...delegateScan(ts, sf, run, "command", ctx.templates("KvDirectory.run", reviewed.directoryRun), ctx, "KvDirectory.run", run.body.statements),
  ];
}

// --- Module graph ------------------------------------------------------------------

/**
 * Bindings of the dispatch set across every module the Worker bundle reaches
 * (static imports, re-exports and literal dynamic imports).
 * Action families, entry classes and entry functions are followed by import
 * identity (named, default and namespace imports, namespace destructuring,
 * re-exports and chains of `export *`), not by spelling, and every reference must be an
 * admitted use: a family only as `F.has(x)`; `rotationCommand` and
 * `durableRotationCommand` only as calls; `KvDirectory` only as `new`, bound to
 * a const used only through method calls or (in the Durable Object) to
 * `this.directory`; `RuntimeInstances` and the Worker default export not at
 * all. Renamed bindings are not admitted, nor is a namespace that holds a
 * dispatch binding re-exported (`export * as ns`, or `export { ns }` of a
 * namespace import) or dynamically imported. No reached module may reach a
 * built-in prototype through which a family could change membership without
 * a reference (`Set.prototype`, `.constructor.prototype`, prototype getters).
 */
function auditModules(ts, file, modules, families, errors) {
  // The re-export fixed point visits a statement more than once; report once.
  const reported = new Set();
  const report = message => { if (!reported.has(message)) { reported.add(message); errors.push(`module graph: ${message}`); } };
  const tracked = new Map();
  const item = (path, name) => tracked.get(`${path}#${name}`);
  const track = (path, name, entry) => { if (item(path, name)) return false; tracked.set(`${path}#${name}`, entry); return true; };
  for (const family of families) track(family.path, family.name, { kind: "family", label: family.label, path: family.path, name: family.name });
  track(DURABLE, "RuntimeInstances", { kind: "none", label: "RuntimeInstances", path: DURABLE, name: "RuntimeInstances" });
  // At most three arguments: the fourth, `now`, keeps its reviewed default.
  track(DIRECTORY, "KvDirectory", { kind: "instance", label: "KvDirectory", path: DIRECTORY, name: "KvDirectory", arguments: 3 });
  for (const name of ["rotationCommand", "durableRotationCommand"]) track(ROTATION, name, { kind: "call", label: name, path: ROTATION, name });
  track(WORKER, "default", { kind: "none", label: "the Worker default export", path: WORKER, name: "default" });

  const reached = [];
  const queue = [WORKER];
  const seen = new Set(queue);
  while (queue.length) {
    const path = queue.shift();
    const summary = moduleSummary(ts, file(path));
    reached.push([path, summary]);
    for (const { specifier, node } of summary.requests) {
      if (specifier === null) { report(`dynamic_evaluation: ${path} imports a computed specifier (line ${lineOf(summary.sf, node)}): ${excerpt(summary.sf, enclosingStatement(ts, node))}`); continue; }
      if (!specifier.startsWith(".")) continue;
      const target = resolvePath(path, specifier);
      if (!modules.has(target)) { report(`module_unresolved: ${path} imports ${specifier}, which is not a console module`); continue; }
      if (!seen.has(target)) { seen.add(target); queue.push(target); }
    }
  }

  const where = (sf, path, node) => `in ${path} (line ${lineOf(sf, node)}): ${excerpt(sf, enclosingStatement(ts, node))}`;
  const flag = (entry, sf, path, node, detail) => report(`${entry.kind === "family" ? "family_mutation" : "entry_replaced"}: ${entry.label} ${detail} ${where(sf, path, node)}`);
  const renamed = (entry, sf, path, node) => report(entry.kind === "family"
    ? `family_mutation: ${entry.label} is renamed in ${path} (line ${lineOf(sf, node)}); renamed family bindings are not admitted`
    : `entry_replaced: ${entry.label} is renamed ${where(sf, path, node)}`);
  const DESCRIBE = {
    family: "used other than .has()", call: "used other than as a call", none: "is referenced",
    instance: "used other than as new KvDirectory(...) with at most three arguments, bound to a method-only const or this.directory",
  };
  const allowed = (entry, sf, path, ref) => {
    const kind = useKind(ts, sf, ref);
    if (entry.kind === "family") return kind === "method:has";
    if (entry.kind === "call") return kind === "call";
    if (entry.kind === "instance") {
      const created = outer(ts, ref).parent;
      if ((created.arguments?.length || 0) > entry.arguments || created.arguments?.some(argument => ts.isSpreadElement(argument))) return false;
      return kind === "new:bound" || (kind === "new:this.directory" && path === DURABLE);
    }
    return false;
  };

  // Re-exports to a fixed point: the same binding under the same name.
  for (let changed = true; changed;) {
    changed = false;
    for (const [path, summary] of reached) {
      for (const exported of summary.exports) {
        let source;
        if (exported.module !== null) {
          if (!exported.module.startsWith(".")) continue;
          const from = resolvePath(path, exported.module);
          if (exported.local === "*") {
            // Whatever `from` exports, including what it re-exports through its
            // own `export *`: the fixed point closes chains of star barrels.
            for (const [key, entry] of [...tracked]) {
              const name = key.slice(from.length + 1);
              if (key.startsWith(`${from}#`) && name !== "default") changed = track(path, name, entry) || changed;
            }
            continue;
          }
          if (exported.local === "**") {
            const inner = [...tracked.keys()].filter(key => key.startsWith(`${from}#`));
            if (inner.length) report(`entry_replaced: export * as ${exported.name} re-exports dispatch bindings of ${from} as a namespace ${where(summary.sf, path, exported.node)}`);
            continue;
          }
          source = [from, exported.local];
        } else {
          const imported = summary.imports.find(entry => entry.local.text === exported.local);
          if (imported && !imported.module.startsWith(".")) continue;
          if (imported?.imported === "*") {
            // `import * as ns; export { ns }` is `export * as ns`: the namespace
            // would carry dispatch bindings under an untracked name.
            const from = resolvePath(path, imported.module);
            const inner = [...tracked].filter(([key]) => key.startsWith(`${from}#`)).map(([, entry]) => entry);
            if (inner.length) report(`${inner.some(entry => entry.kind === "family") ? "family_mutation" : "entry_replaced"}: namespace ${imported.local.text} of ${from}, which exports ${[...new Set(inner.map(entry => entry.label))].join(", ")}, is re-exported as ${exported.name} ${where(summary.sf, path, exported.node)}`);
            continue;
          }
          source = imported ? [resolvePath(path, imported.module), imported.imported] : [path, exported.local];
        }
        const entry = item(...source);
        if (!entry) continue;
        if (exported.name !== source[1]) { renamed(entry, summary.sf, path, exported.node); continue; }
        changed = track(path, exported.name, entry) || changed;
      }
    }
  }

  // A dynamic import yields the module namespace as an untracked value, which
  // a destructuring or alias would rename: it is not admitted for a module that
  // exports a dispatch binding.
  for (const [path, summary] of reached) {
    for (const { specifier, node, dynamic } of summary.requests) {
      if (!dynamic || specifier === null || !specifier.startsWith(".")) continue;
      const from = resolvePath(path, specifier);
      const inner = [...tracked].filter(([key]) => key.startsWith(`${from}#`)).map(([, entry]) => entry);
      if (inner.length) report(`${inner.some(entry => entry.kind === "family") ? "family_mutation" : "entry_replaced"}: dynamic import of ${from}, which exports ${[...new Set(inner.map(entry => entry.label))].join(", ")}, is not admitted ${where(summary.sf, path, node)}`);
    }
  }

  for (const [path, summary] of reached) {
    const { sf } = summary;
    const check = (entry, symbol) => {
      for (const ref of summary.refs.get(symbol) || []) if (!allowed(entry, sf, path, ref)) flag(entry, sf, path, ref, DESCRIBE[entry.kind]);
    };
    for (const entry of new Set(tracked.values())) {
      if (entry.path !== path || entry.name === "default") continue;
      const declared = localDeclarationName(ts, sf, entry.name);
      if (declared) check(entry, symbolOf(ts, sf, declared));
    }
    for (const imported of summary.imports) {
      if (!imported.module.startsWith(".")) continue;
      const from = resolvePath(path, imported.module);
      const symbol = symbolOf(ts, sf, imported.local);
      if (imported.imported !== "*") {
        const entry = item(from, imported.imported);
        if (!entry) continue;
        if (imported.local.text !== imported.imported && imported.imported !== "default") renamed(entry, sf, path, imported.node);
        else check(entry, symbol);
        continue;
      }
      const inner = [...tracked].filter(([key]) => key.startsWith(`${from}#`)).map(([, entry]) => entry);
      if (!inner.length) continue;
      // A namespace import: each member read is a reference to that export.
      for (const ref of summary.refs.get(symbol) || []) {
        const top = outer(ts, ref);
        const parent = top.parent;
        if (ts.isPropertyAccessExpression(parent) && parent.expression === top) {
          const entry = item(from, parent.name.text);
          if (entry && !allowed(entry, sf, path, parent)) flag(entry, sf, path, parent, DESCRIBE[entry.kind]);
          continue;
        }
        if (ts.isVariableDeclaration(parent) && parent.initializer === top && ts.isObjectBindingPattern(parent.name)) {
          for (const element of parent.name.elements) {
            const name = element.propertyName || element.name;
            const key = ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : null;
            if (element.dotDotDotToken || key === null || !ts.isIdentifier(element.name)) {
              report(`entry_replaced: namespace ${imported.local.text} of ${from} is destructured with a rest or computed element ${where(sf, path, element)}`);
              continue;
            }
            const entry = item(from, key);
            if (!entry) continue;
            if (element.name.text !== key) renamed(entry, sf, path, element);
            else check(entry, symbolOf(ts, sf, element.name));
          }
          continue;
        }
        report(`${inner.some(entry => entry.kind === "family") ? "family_mutation" : "entry_replaced"}: namespace ${imported.local.text} of ${from}, which exports ${inner.map(entry => entry.label).join(", ")}, is used other than through its members ${where(sf, path, ref)}`);
      }
    }
    for (const { node, detail } of summary.reach) report(`family_mutation: prototype reach (${detail}) ${where(sf, path, node)}`);
    for (const { node, detail } of summary.values) report(`instance_value: ${detail} ${where(sf, path, node)}`);
  }
}

/**
 * Where `this` or `super` may stand in a reached module (review FIX12): as the
 * object of a dotted property access other than `.valueOf`, `super(...)` in a
 * constructor, or the initializer of an object destructuring whose keys are
 * literal names other than `valueOf`, without a rest element. Anywhere else,
 * a return value, an argument, an assignment source, a collection element,
 * `yield`, `await`, a template, a comparison or a computed access, the
 * instance is a value whose members a key built at run time can select, so it
 * is not admitted at any depth, in a nested function or at module level.
 * Returns a description of the position, or null when it is admitted.
 */
function instanceValuePosition(ts, node) {
  const self = node.kind === ts.SyntaxKind.ThisKeyword ? "this" : "super";
  const top = outer(ts, node);
  const parent = top.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.expression === top) return parent.name.text === "valueOf" ? `${self}.valueOf returns the instance as a value` : null;
  if (ts.isElementAccessExpression(parent) && parent.expression === top) return `computed access on ${self}`;
  if (self === "super" && ts.isCallExpression(parent) && parent.expression === top) return null;
  if (self === "this" && ts.isVariableDeclaration(parent) && parent.initializer === top && ts.isObjectBindingPattern(parent.name)
    && parent.name.elements.every(element => {
      const key = element.propertyName || element.name;
      return !element.dotDotDotToken && (ts.isIdentifier(key) || ts.isStringLiteral(key)) && key.text !== "valueOf";
    })) return null;
  return `${self} is used as a value (${ts.SyntaxKind[parent.kind]})`;
}

/** How a reference to a tracked binding is used. */
function useKind(ts, sf, ref) {
  const top = outer(ts, ref);
  const parent = top.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.expression === top) {
    const call = outer(ts, parent).parent;
    return call && ts.isCallExpression(call) && call.expression === outer(ts, parent) ? `method:${parent.name.text}` : "member";
  }
  if (ts.isCallExpression(parent) && parent.expression === top) return "call";
  if (ts.isNewExpression(parent) && parent.expression === top) {
    const created = outer(ts, parent);
    const holder = created.parent;
    if (ts.isVariableDeclaration(holder) && holder.initializer === created && ts.isIdentifier(holder.name) && (holder.parent.flags & ts.NodeFlags.Const)) {
      const symbol = symbolOf(ts, sf, holder.name);
      const uses = [];
      const visit = node => {
        if (ts.isIdentifier(node) && node !== holder.name && isReference(ts, node) && symbolOf(ts, sf, node) === symbol) uses.push(node);
        ts.forEachChild(node, visit);
      };
      visit(sf);
      return uses.every(use => useKind(ts, sf, use).startsWith("method:")) ? "new:bound" : "new:escaped";
    }
    if (ts.isBinaryExpression(holder) && holder.right === created && holder.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const left = unwrap(ts, holder.left);
      if (ts.isPropertyAccessExpression(left) && left.name.text === "directory" && unwrap(ts, left.expression).kind === ts.SyntaxKind.ThisKeyword) return "new:this.directory";
    }
    return "new:other";
  }
  return "other";
}

function localDeclarationName(ts, sf, name) {
  for (const statement of sf.statements) {
    if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name) && declaration.name.text === name) return declaration.name;
    if ((ts.isClassDeclaration(statement) || ts.isFunctionDeclaration(statement)) && statement.name?.text === name) return statement.name;
  }
  return null;
}

// Per parsed file: its module requests, imports, exports, references by
// symbol, and prototype reach (files are cached, so is this).
const summaries = new WeakMap();
const PROTOTYPE_REACH = new Set(["getPrototypeOf", "setPrototypeOf", "__proto__"]);
function moduleSummary(ts, sf) {
  if (summaries.has(sf)) return summaries.get(sf);
  const summary = { sf, requests: [], imports: [], exports: [], refs: new Map(), reach: [], values: [] };
  for (const statement of sf.statements) {
    if (ts.isImportDeclaration(statement)) {
      const module = statement.moduleSpecifier.text;
      summary.requests.push({ specifier: module, node: statement });
      const clause = statement.importClause;
      if (clause?.name) summary.imports.push({ module, imported: "default", local: clause.name, node: statement });
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) summary.imports.push({ module, imported: "*", local: bindings.name, node: statement });
      if (bindings && ts.isNamedImports(bindings)) for (const element of bindings.elements) summary.imports.push({ module, imported: (element.propertyName || element.name).text, local: element.name, node: element });
    }
    if (ts.isExportDeclaration(statement)) {
      const module = statement.moduleSpecifier ? statement.moduleSpecifier.text : null;
      if (module !== null) summary.requests.push({ specifier: module, node: statement });
      if (!statement.exportClause) summary.exports.push({ name: null, module, local: "*", node: statement });
      else if (ts.isNamespaceExport(statement.exportClause)) summary.exports.push({ name: statement.exportClause.name.text, module, local: "**", node: statement });
      else for (const element of statement.exportClause.elements) summary.exports.push({ name: element.name.text, module, local: (element.propertyName || element.name).text, node: element });
    }
  }
  const visit = node => {
    if (node.kind === ts.SyntaxKind.ThisKeyword || node.kind === ts.SyntaxKind.SuperKeyword) {
      const detail = instanceValuePosition(ts, node);
      if (detail && !isReviewedSqlSetterThis(ts, sf, node)) summary.values.push({ node, detail });
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [argument] = node.arguments;
      summary.requests.push({ specifier: argument && isStringLiteral(ts, argument) ? literalValue(ts, argument) : null, node, dynamic: true });
    }
    if (ts.isIdentifier(node) && isReference(ts, node)) {
      const symbol = symbolOf(ts, sf, node);
      if (symbol) { if (!summary.refs.has(symbol)) summary.refs.set(symbol, []); summary.refs.get(symbol).push(node); }
      if (node.text === "Set" && !symbol?.declarations?.length) {
        const top = outer(ts, node);
        const parent = top.parent;
        if (!(ts.isNewExpression(parent) && parent.expression === top) && !(ts.isBinaryExpression(parent) && parent.right === top && parent.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword)) {
          summary.reach.push({ node, detail: "Set used other than as new Set() or instanceof Set" });
        }
      }
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const name = ts.isPropertyAccessExpression(node) ? node.name.text : literalKey(ts, node.argumentExpression);
      const object = unwrap(ts, node.expression);
      const objectName = ts.isPropertyAccessExpression(object) ? object.name.text : ts.isElementAccessExpression(object) ? literalKey(ts, object.argumentExpression) : null;
      if (PROTOTYPE_REACH.has(name)) summary.reach.push({ node, detail: name });
      if (name === "prototype" && objectName === "constructor") summary.reach.push({ node, detail: "constructor.prototype" });
      if (name === "prototype" && isWriteTarget(ts, node)) summary.reach.push({ node, detail: "prototype replaced" });
      if (objectName === "prototype" && isWriteTarget(ts, node)) summary.reach.push({ node, detail: "prototype member written" });
    }
    if (ts.isCallExpression(node) && node.arguments.length) {
      const callee = unwrap(ts, node.expression);
      const target = unwrap(ts, node.arguments[0]);
      const targetName = ts.isPropertyAccessExpression(target) ? target.name.text : ts.isElementAccessExpression(target) ? literalKey(ts, target.argumentExpression) : null;
      if (ts.isPropertyAccessExpression(callee) && ["defineProperty", "defineProperties", "assign", "set", "deleteProperty"].includes(callee.name.text) && targetName === "prototype") {
        summary.reach.push({ node, detail: `${callee.name.text} on a prototype` });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  summaries.set(sf, summary);
  return summary;
}
