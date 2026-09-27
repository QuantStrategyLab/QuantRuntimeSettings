import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { V2_PAGE_HTML } from "../web/strategy-switch-console/v2_asset_map.js";
import { createAccountSettingsController } from "../web/strategy-switch-console/frontend/src/accountSettingsState.ts";
import { confirmationAccepted, currentResearchPreview } from "../web/strategy-switch-console/frontend/src/operations.ts";

assert.match(V2_PAGE_HTML, /<div id="root"><\/div>/, "React console is the served application shell");
assert.match(V2_PAGE_HTML, /\/v2\/assets\/index-[\w-]+\.js/, "the shell loads the versioned application bundle");
assert.doesNotMatch(V2_PAGE_HTML, /id="ux1-preview-button"|data-ux1-default-view/, "the shell does not embed legacy UX1 markup");
assert.equal(V2_PAGE_HTML.includes("fonts.googleapis.com"), false);

const frontend = await readFile(new URL("../web/strategy-switch-console/frontend/src/App.tsx", import.meta.url), "utf8");
assert.equal(frontend.includes('id="ux1-preview-button"'), false);
assert.equal(frontend.includes(".innerHTML"), false);
const logout = frontend.slice(frontend.indexOf("const logout"), frontend.indexOf("const currentForm"));
assert.match(logout, /\/api\/logout/);
assert.equal(logout.includes("/api/switch"), false);

const tempting = { preview_stale: false, preview: { status: "computed", stale: false }, job: { status: "succeeded" } };
assert.equal(currentResearchPreview(tempting), true);
assert.equal(currentResearchPreview({ ...tempting, preview: { status: "computed", stale: true } }), false);
assert.equal(currentResearchPreview({ ...tempting, job: { status: "queued" } }), false);
assert.equal(currentResearchPreview({ ...tempting, job: { status: "unknown" } }), false);
assert.equal(confirmationAccepted(false, "same", "same"), false);

const payload = { platform: "longbridge", key: "hk", risk: { preference: "CAPITAL_PRESERVATION", revision: 1 }, identity: { account: "hk" }, draft: { status: "current", revision: 1, overrides: {} } };
const controller = createAccountSettingsController();
const first = controller.select({ platform: "longbridge", key: "hk" });
assert.equal(controller.applyRead(first, payload), true);
assert.equal(controller.edit({ preference: "GROWTH_COMPOUNDING" }), true);
const second = controller.start("read");
assert.equal(controller.applyRead(first, payload), false);
assert.equal(controller.view().preference, "GROWTH_COMPOUNDING");
assert.equal(controller.isCurrent(second), true);

console.log("ux1 async ui validation: PASS");
