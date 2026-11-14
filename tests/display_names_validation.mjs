import assert from "node:assert/strict";
import { displayName } from "../web/strategy-switch-console/display_names.js";
import { DISPLAY_NAMES } from "../web/strategy-switch-console/display_names_data.js";
const identity = Object.freeze({ account: "crypto_combo", platform: "binance", profile: "crypto_live_pool_rotation" });
assert.equal(displayName("accounts", identity.account, "en", "", identity.platform), "live");
assert.equal(displayName("accounts", "paper", "en", "", "binance"), "paper");
assert.equal(displayName("accounts", "crypto_combo", "en", "", "other"), "crypto_combo");
assert.equal(displayName("strategies", identity.profile, "en"), "Crypto Pool Rotation");
assert.equal(displayName("strategies", "custom", "en", "Custom"), "Custom");
assert.equal(displayName("strategies", identity.profile, "en", "", "", { strategies: { [identity.profile]: { en: "Crypto-Rotation-202609" } } }), "Crypto-Rotation-202609");
// Strategy families are not account names: SOXL/TQQQ have no account display mapping.
assert.deepEqual(Object.keys(DISPLAY_NAMES.account_aliases).sort(), ["hk", "live", "paper", "sg"]);
for (const key of ["soxl", "tqqq"]) {
  assert.equal(displayName("account_aliases", key, "en", "fallback"), "fallback");
  assert.equal(displayName("account_aliases", key, "zh", "fallback"), "fallback");
}
assert.equal(displayName("account_aliases", "paper", "zh"), "模拟", "other account aliases are unchanged");
assert.equal(identity.account, "crypto_combo");
assert.equal(identity.profile, "crypto_live_pool_rotation");
console.log("Configurable display names keep machine identifiers intact");
