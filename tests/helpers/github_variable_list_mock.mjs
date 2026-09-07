import assert from 'node:assert/strict';

// Preserve existing per-variable resolver fixtures while exercising the list transport.
// These callbacks are synthetic response factories, not network fetches.
export function githubVariableListMock(variableResponse) {
  const names = [
    'CLOUD_RUN_SERVICE_TARGETS_JSON', 'RUNTIME_TARGET_JSON', 'STRATEGY_PROFILE',
    'RUNTIME_TARGET_ENABLED', 'INCOME_LAYER_ENABLED', 'INCOME_LAYER_START_USD',
    'INCOME_LAYER_MAX_RATIO', 'OPTION_OVERLAY_ENABLED', 'DCA_MODE',
    'DCA_BASE_INVESTMENT_USD', 'IBIT_ZSCORE_EXIT_ENABLED', 'CASH_ONLY_EXECUTION',
    ...['LONGBRIDGE', 'IBKR', 'SCHWAB', 'FIRSTRADE', 'BINANCE', 'QMT'].flatMap(p =>
      [`${p}_MIN_RESERVED_CASH_USD`, `${p}_RESERVED_CASH_RATIO`, `${p}_CASH_ONLY_EXECUTION`]),
  ];
  return async url => {
    const request = new URL(url);
    assert.ok(request.pathname.endsWith('/variables'), 'expected scoped variable list');
    const variables = (await Promise.all(names.map(async name => {
      const response = await variableResponse(`${request.origin}${request.pathname}/${name}`);
      if (!response.ok) return null;
      const payload = await response.json();
      return { name, value: payload.value };
    }))).filter(Boolean);
    return Response.json({ total_count: variables.length, variables });
  };
}
