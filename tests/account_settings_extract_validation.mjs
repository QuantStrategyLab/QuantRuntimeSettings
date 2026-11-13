import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  ACCOUNT_SETTINGS_DO_ACTIONS,
  ACCOUNT_SETTING_OVERRIDE_FIELDS,
  ACCOUNT_SETTINGS_PROFILE_APPLICATION_OIDC_PATH,
  ACCOUNT_SETTINGS_PROFILE_APPLICATION_OIDC_AUDIENCE,
  ACCOUNT_SETTINGS_PROFILE_APPLICATION_REQUEST_KEY,
} from "../web/strategy-switch-console/application/account_settings/constants.js";
import {
  accountSettingsIdentity,
  accountSettingsIdentityIsComplete,
  accountSettingsProfileName,
  accountSettingPositiveAmount,
  accountSettingRatio,
  applyAccountSettingOverrides,
  accountSettingsOperations,
  accountSettingsPayload,
  accountSettingsAuditChanges,
  profileDefinesOptionOverlay,
  optionOverlayDraftAllowed,
  accountSettingsProfileApplicationIsFixedHk,
  decodeProfileApplicationJwtPart,
} from "../web/strategy-switch-console/application/account_settings/helpers.js";
import {
  readGitHubProfileApplicationJwks,
  verifyGitHubProfileApplicationToken,
  readGitHubProfileApplicationRequestBody,
} from "../web/strategy-switch-console/application/account_settings/oidc.js";
import {
  loadAccountDraftProfiles,
  presentAccountSettings,
  accountSettingsResponse,
  saveCombinedAccountDraft,
  saveAccountSettings,
  riskProfileBindingsResponse,
  saveRiskProfileBindings,
  approveAccountSettingsProfileApplication,
  claimAccountSettingsProfileApplicationFromGitHub,
} from "../web/strategy-switch-console/application/account_settings/http.js";
import { HttpError } from "../web/strategy-switch-console/application/http_error.js";
import {
  loadWorkerSurface,
  stripComments,
  surfaceDefinesFunction,
  surfaceImportsModule,
} from "./helpers/worker_surface.mjs";

const accountSettingsModules = [
  "application/account_settings/constants.js",
  "application/account_settings/helpers.js",
  "application/account_settings/oidc.js",
  "application/account_settings/http.js",
];

const surface = await loadWorkerSurface({
  includeDurableObject: true,
  applicationModules: accountSettingsModules,
});
const { supportSource, durableSource, wiredSource } = surface;

const helpersSource = await readFile(
  new URL("../web/strategy-switch-console/application/account_settings/helpers.js", import.meta.url),
  "utf8",
);
const oidcSource = await readFile(
  new URL("../web/strategy-switch-console/application/account_settings/oidc.js", import.meta.url),
  "utf8",
);
const httpSource = await readFile(
  new URL("../web/strategy-switch-console/application/account_settings/http.js", import.meta.url),
  "utf8",
);

assert.equal(surfaceImportsModule(surface, "account_settings/constants.js"), true);
assert.equal(surfaceImportsModule(surface, "account_settings/helpers.js"), true);
assert.equal(surfaceImportsModule(surface, "account_settings/oidc.js"), true);
assert.equal(surfaceImportsModule(surface, "account_settings/http.js"), true);

for (const name of [
  "riskProfileBindingsResponse",
  "saveRiskProfileBindings",
  "accountSettingsResponse",
  "presentAccountSettings",
  "saveAccountSettings",
  "saveCombinedAccountDraft",
  "approveAccountSettingsProfileApplication",
  "claimAccountSettingsProfileApplicationFromGitHub",
  "accountDraftStrategyChoices",
  "assertAccountDraftPatch",
  "dcaDraftSupported",
  "loadAccountDraftProfiles",
]) {
  assert.equal(surfaceDefinesFunction(surface, name), true, name);
}

assert.match(supportSource, /riskProfileBindingsResponseImpl/);
assert.match(supportSource, /saveRiskProfileBindingsImpl/);
assert.match(supportSource, /accountSettingsResponseImpl/);
assert.match(supportSource, /saveAccountSettingsImpl/);
assert.match(supportSource, /approveAccountSettingsProfileApplicationImpl/);
assert.match(supportSource, /claimAccountSettingsProfileApplicationFromGitHubImpl/);
assert.match(supportSource, /accountSettingsRuntimeDeps/);
assert.match(wiredSource, /ACCOUNT_SETTINGS_DO_ACTIONS/);
assert.match(durableSource, /ACCOUNT_SETTINGS_DO_ACTIONS/);
assert.match(durableSource, /accountSettingsIdentity/);
assert.match(durableSource, /applyAccountSettingOverrides/);

assert.equal(ACCOUNT_SETTINGS_PROFILE_APPLICATION_OIDC_PATH, "/api/internal/account-settings/profile-application/claim");
assert.equal(ACCOUNT_SETTINGS_PROFILE_APPLICATION_OIDC_AUDIENCE, "qrs-profile-application");
assert.equal(ACCOUNT_SETTINGS_DO_ACTIONS.has("account_settings_save"), true);
assert.equal(ACCOUNT_SETTING_OVERRIDE_FIELDS.includes("strategy_profile"), true);
assert.equal(ACCOUNT_SETTINGS_PROFILE_APPLICATION_REQUEST_KEY.test("00000000-0000-4000-8000-000000000000"), true);

assert.equal(typeof accountSettingsIdentity, "function");
assert.equal(typeof accountSettingsIdentityIsComplete, "function");
assert.equal(typeof accountSettingsProfileName, "function");
assert.equal(typeof accountSettingPositiveAmount, "function");
assert.equal(typeof accountSettingRatio, "function");
assert.equal(typeof applyAccountSettingOverrides, "function");
assert.equal(typeof accountSettingsOperations, "function");
assert.equal(typeof accountSettingsPayload, "function");
assert.equal(typeof accountSettingsAuditChanges, "function");
assert.equal(typeof profileDefinesOptionOverlay, "function");
assert.equal(typeof optionOverlayDraftAllowed, "function");
assert.equal(typeof accountSettingsProfileApplicationIsFixedHk, "function");
assert.equal(typeof decodeProfileApplicationJwtPart, "function");
assert.equal(typeof readGitHubProfileApplicationJwks, "function");
assert.equal(typeof verifyGitHubProfileApplicationToken, "function");
assert.equal(typeof readGitHubProfileApplicationRequestBody, "function");
assert.equal(typeof loadAccountDraftProfiles, "function");
assert.equal(typeof presentAccountSettings, "function");
assert.equal(typeof accountSettingsResponse, "function");
assert.equal(typeof saveCombinedAccountDraft, "function");
assert.equal(typeof saveAccountSettings, "function");
assert.equal(typeof riskProfileBindingsResponse, "function");
assert.equal(typeof saveRiskProfileBindings, "function");
assert.equal(typeof approveAccountSettingsProfileApplication, "function");
assert.equal(typeof claimAccountSettingsProfileApplicationFromGitHub, "function");

const identity = accountSettingsIdentity({
  platform: "longbridge",
  key: "hk",
  config: {
    target_name: "hk",
    broker_environment: "live",
    account_selector: "acc",
    deployment_selector: "dep",
    account_scope: "scope",
    service_name: "svc",
  },
});
assert.equal(accountSettingsIdentityIsComplete(identity), true);
assert.equal(accountSettingsProfileName("soxl_core"), "soxl_core");
assert.equal(accountSettingsProfileName("Bad Profile"), "");
assert.equal(accountSettingPositiveAmount("12.5"), true);
assert.equal(accountSettingRatio("0.25"), "0.25");
assert.deepEqual(applyAccountSettingOverrides({}, { reserved_cash_floor: "10" }), { reserved_cash_floor: "10" });
assert.equal(accountSettingsOperations(true, true).save_option_draft, true);
assert.deepEqual(accountSettingsAuditChanges(
  { draft: { overrides: { reserved_cash_floor: "1" } }, risk: { preference: null } },
  { draft: { overrides: { reserved_cash_floor: "2" } }, risk: { preference: null } },
  { overrides: { reserved_cash_floor: "2" } },
), ["cash_draft"]);

assert.equal(
  accountSettingsProfileApplicationIsFixedHk({
    platform: "longbridge",
    key: "hk",
    identity,
  }),
  true,
);

assert.throws(
  () => decodeProfileApplicationJwtPart("!!!", 64),
  (error) => error instanceof HttpError && error.status === 401,
);

for (const source of [helpersSource, oidcSource, httpSource]) {
  const noComments = stripComments(source);
  assert.equal(
    /from\s+["'][^"']*runtime_support\.js["']/.test(noComments),
    false,
    "account_settings modules must not import runtime_support",
  );
  assert.equal(
    source.includes('from "./worker.js"')
      || source.includes("from '../worker.js'")
      || source.includes('from "../../worker.js"'),
    false,
    "account_settings modules must not import worker.js",
  );
}

assert.equal(
  /(?:export )?(?:async )?function (?:effectiveAccountSettings|accountSettingsProfileRuntimeReadback)\(/.test(
    stripComments(httpSource + helpersSource + oidcSource),
  ),
  false,
  "extract must leave GitHub current-strategy readback in runtime_support",
);
assert.match(httpSource, /effectiveAccountSettings/, "HTTP present/save inject effectiveAccountSettings via DI");
assert.match(httpSource, /accountSettingsProfileRuntimeReadback/, "profile-application injects runtime readback via DI");

console.log("account_settings_extract_validation: ok");
