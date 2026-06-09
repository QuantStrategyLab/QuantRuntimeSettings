import assert from "node:assert/strict";

import { __test } from "../web/strategy-switch-console/worker.js";

const strategyProfiles = __test.normalizeStrategyProfilesPayload(
  [
    {
      profile: "tqqq_growth_income",
      label: "TQQQ Growth Income",
      domain: "us_equity",
      runtime_enabled: true,
    },
    {
      profile: "hk_low_vol_dividend_quality_snapshot",
      label: "HK Low-Vol Dividend Quality Snapshot",
      domain: "hk_equity",
      runtime_enabled: true,
    },
  ],
  "test_strategy_profiles",
);

const accountOptions = __test.normalizeAccountOptionsPayload(
  {
    longbridge: [
      {
        key: "hk",
        label: "hk",
        target_name: "hk",
        account_selector: "HK",
        default_strategy_profile: "hk_low_vol_dividend_quality_snapshot",
      },
      {
        key: "sg",
        label: "sg",
        target_name: "sg",
        account_selector: "SG",
        default_strategy_profile: "tqqq_growth_income",
      },
    ],
    ibkr: [
      {
        key: "u15998061",
        label: "u15998061",
        target_name: "u15998061",
        account_selector: "U15998061",
        deployment_selector: "live-u1599-tqqq",
        account_scope: "live-u1599-tqqq",
        service_name: "interactive-brokers-live-u1599-tqqq-service",
      },
    ],
    schwab: [
      {
        key: "default",
        label: "default",
        target_name: "default",
        supported_domains: ["us_equity"],
      },
    ],
    firstrade: [
      {
        key: "default",
        label: "default",
        target_name: "default",
        supported_domains: ["us_equity"],
      },
    ],
  },
  "test_account_options",
);

assert.deepEqual(accountOptions.longbridge[0].supported_domains, ["hk_equity"]);
assert.deepEqual(accountOptions.longbridge[1].supported_domains, ["us_equity"]);
assert.deepEqual(accountOptions.ibkr[0].supported_domains, ["us_equity"]);

const longbridgeHk = __test.assertConfiguredAccount(
  {
    platform: "longbridge",
    target_name: "hk",
    account_selector: "HK",
    strategy_profile: "hk_low_vol_dividend_quality_snapshot",
  },
  accountOptions,
);
__test.assertStrategyAllowedForAccount(
  {
    platform: "longbridge",
    strategy_profile: "hk_low_vol_dividend_quality_snapshot",
  },
  longbridgeHk,
  strategyProfiles,
);

const ibkrAccount = __test.assertConfiguredAccount(
  {
    platform: "ibkr",
    target_name: "u15998061",
    account_selector: "U15998061",
    deployment_selector: "live-u1599-tqqq",
    account_scope: "live-u1599-tqqq",
    service_name: "interactive-brokers-live-u1599-tqqq-service",
    strategy_profile: "tqqq_growth_income",
  },
  accountOptions,
);
__test.assertStrategyAllowedForAccount(
  {
    platform: "ibkr",
    strategy_profile: "tqqq_growth_income",
  },
  ibkrAccount,
  strategyProfiles,
);
assert.throws(
  () => __test.assertStrategyAllowedForAccount(
    {
      platform: "ibkr",
      strategy_profile: "hk_low_vol_dividend_quality_snapshot",
    },
    ibkrAccount,
    strategyProfiles,
  ),
  /not supported/,
);
