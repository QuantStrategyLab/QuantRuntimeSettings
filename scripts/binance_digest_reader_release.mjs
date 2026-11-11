import {createHash} from "node:crypto";
import {pathToFileURL} from "node:url";
import {active, candidateConfig, createFixedApi, metadata, moduleBytes, resources, versions} from "./console_946_backend_release.mjs";

const bindingName = "BINANCE_DIGEST_READ_TOKEN";
const message = "Add the dedicated Binance daily snapshot read credential";
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const uuid = value => typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const requireMatch = value => { if (!value) throw new Error("verification_failed"); };

export async function configureReader(api, {token, expectedVersion, expectedHash}) {
  let stage = "inputs", uploadAttempted = false, activationAttempted = false;
  try {
    requireMatch(typeof token === "string" && /^[A-Za-z0-9_-]{32,256}$/.test(token)
      && uuid(expectedVersion) && /^[0-9a-f]{64}$/.test(expectedHash ?? ""));
    stage = "baseline";
    const prior = active(await api.deployments());
    requireMatch(prior.version === expectedVersion);
    const baseline = resources(await api.scriptVersion(prior.version), prior.version);
    requireMatch(!baseline.bindings.some(binding => binding.name === bindingName));
    const bytes = moduleBytes(await api.betaVersion(prior.version), prior.version, false);
    requireMatch(sha256(bytes) === expectedHash);
    const previousLatest = versions(await api.versions())[0];
    const requirePriorActive = async () => {
      const current = active(await api.deployments());
      requireMatch(current.deployment === prior.deployment && current.version === prior.version);
    };
    const verifyVersion = async (version, deployed) => {
      const settings = resources(await api.scriptVersion(version), version);
      requireMatch(settings.bindings.some(binding => binding.name === bindingName && binding.type === "secret_text"));
      candidateConfig({...settings, bindings: settings.bindings.filter(binding => binding.name !== bindingName)}, baseline, deployed);
      requireMatch(moduleBytes(await api.betaVersion(version), version).equals(bytes));
    };
    const body = metadata(baseline, prior.version, bytes);
    body.annotations = {"workers/message": message};
    body.bindings.push({name: bindingName, type: "secret_text", text: token});
    await requirePriorActive();
    stage = "upload";
    uploadAttempted = true;
    const upload = await api.upload(body);
    requireMatch(uuid(upload?.id) && ![prior.version, previousLatest].includes(upload.id));
    stage = "verify_candidate";
    await verifyVersion(upload.id, false);
    const history = versions(await api.versions());
    requireMatch(history[0] === upload.id && history[1] === previousLatest);
    await requirePriorActive();
    stage = "activate";
    activationAttempted = true;
    const deployment = await api.activate({strategy: "percentage",
      versions: [{version_id: upload.id, percentage: 100}], annotations: {"workers/message": message}});
    requireMatch(uuid(deployment?.id));
    stage = "readback";
    await verifyVersion(upload.id, true);
    const current = active(await api.deployments());
    requireMatch(current.deployment === deployment.id && current.version === upload.id);
    return {ok: true, only_reader_binding_added: true, code_unchanged: true};
  } catch {
    return {ok: false, stage, upload_attempted: uploadAttempted, activation_attempted: activationAttempted};
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  let result;
  try {
    result = await configureReader(createFixedApi(), {
      token: process.env.BINANCE_DIGEST_READ_TOKEN,
      expectedVersion: process.env.EXPECTED_WORKER_VERSION,
      expectedHash: process.env.EXPECTED_WORKER_MODULE_SHA256,
    });
  } catch {
    result = {ok: false, stage: "configuration", upload_attempted: false, activation_attempted: false};
  }
  console.log(JSON.stringify(result));
  if (!result.ok) process.exitCode = 1;
}
