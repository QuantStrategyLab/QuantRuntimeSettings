const QRS_WRITERS = new Set(['.github/workflows/deploy-strategy-switch-console.yml',
  '.github/workflows/sync-schwab-account-facts-binding.yml','.github/workflows/configure-ibkr-primary-daily-once.yml']);
const IBKR_WRITERS = new Set(['.github/workflows/execution-report-heartbeat.yml',
  '.github/workflows/publish-account-facts-archive.yml','.github/workflows/publish-ibkr-primary-day-once.yml',
  '.github/workflows/sync-cloud-run-env.yml','.github/workflows/sync-cloud-run-env-protected.yml',
  '.github/workflows/deploy-pilot-no-traffic.yml','.github/workflows/deploy-pilot-no-traffic-protected.yml']);

export function hasRelevantWriter(runs, repo, ownRun) {
  const paths=repo==='qrs'?QRS_WRITERS:repo==='ibkr'?IBKR_WRITERS:null;
  if (!paths || !Array.isArray(runs) || runs.some(run=>typeof run?.path!=='string' || !run.id)) throw Error('invalid_runs');
  return runs.some(run=>String(run.id)!==ownRun && paths.has(run.path.split('@')[0]));
}

export function writtenSecretsHaveFreshMetadata(secrets, startedAt) {
  const start=Date.parse(startedAt);
  if (!Number.isFinite(start) || !Array.isArray(secrets)) return false;
  return ['IBKR_RUNTIME_DAILY_SYNC_TOKEN','IBKR_RUNTIME_DAILY_TARGET_KEY'].every(name=>{
    const matches=secrets.filter(item=>item?.name===name);
    return matches.length===1 && Number.isFinite(Date.parse(matches[0].updated_at)) && Date.parse(matches[0].updated_at)>=start;
  });
}

// Before the fixed module is read, bound by the existing 10 MiB module limit.
// Afterwards, bound the response to the exact observed base64 length plus 512 KiB.
export function versionResponseLimit(moduleBase64Length) {
  const length=moduleBase64Length ?? Math.ceil(10485760/3)*4;
  if (!Number.isSafeInteger(length) || length<1 || length>Math.ceil(10485760/3)*4) throw Error('invalid_module_length');
  return length + 524288;
}
