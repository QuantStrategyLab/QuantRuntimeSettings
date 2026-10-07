// The Worker outbound hook does not cover Miniflare's Node-side metadata fetch.
// Match Validate's existing contract and enforce it for direct test invocation too.
import { createRequire } from "node:module";
const require = createRequire(new URL("../web/strategy-switch-console/package.json", import.meta.url));
const runtimeRequire = createRequire(require.resolve(process.env.QRT_MINIFLARE_MODULE || "miniflare"));
const { MockAgent, getGlobalDispatcher, setGlobalDispatcher } = runtimeRequire("undici");
const previousDispatcher = getGlobalDispatcher();
const previousCfFlag = process.env.CLOUDFLARE_CF_FETCH_ENABLED;
process.env.CLOUDFLARE_CF_FETCH_ENABLED = "false";
const counters = { host_external_attempts: 0, host_loopback_requests: 0 };
const isLoopback = host => /^(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]+)?$/.test(host);
class LocalOnlyAgent extends MockAgent {
  dispatch(options, handler) {
    const origin = new URL(String(options.origin));
    if (!isLoopback(origin.host)) counters.host_external_attempts += 1;
    else counters.host_loopback_requests += 1;
    return super.dispatch(options, handler);
  }
}
const dispatcher = new LocalOnlyAgent();
dispatcher.disableNetConnect();
// Miniflare communicates with its own local workerd process. No external host is allowed.
dispatcher.enableNetConnect(isLoopback);
setGlobalDispatcher(dispatcher);
export const offlineNetwork = {
  counters,
  async close() {
    setGlobalDispatcher(previousDispatcher);
    if (previousCfFlag === undefined) delete process.env.CLOUDFLARE_CF_FETCH_ENABLED;
    else process.env.CLOUDFLARE_CF_FETCH_ENABLED = previousCfFlag;
    await dispatcher.close();
  },
};
