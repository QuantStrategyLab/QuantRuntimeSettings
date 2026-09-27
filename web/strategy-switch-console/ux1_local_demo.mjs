// Local UX1 preview only. Binds 127.0.0.1 and an operator config.
// The production Worker has no anonymous session route and no invented service binding.
// Persistent mode keeps Durable Object state under the operator state root.
// The auth secret and session token stay out of that store and out of stdout.

import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { chmod, mkdir, mkdtemp, readFile, readlink, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { __test } from "./worker.js";
import { UX1_EVIDENCE_HASH_KEYS } from "./ux1_research_contract.js";

const require = createRequire(new URL("./package.json", import.meta.url));
const { Miniflare } = require("miniflare");
const FORBIDDEN_REQUEST_KEYS = new Set(["path", "url", "uri", "command", "interpreter", "adapter", "executable", "input_root"]);
const CHILD_ENV_KEYS = ["PATH", "HOME", "LANG", "LC_ALL", "LC_CTYPE", "TMPDIR", "TZ"];
const CONFIG_KEYS = new Set(["interpreter", "executable", "input_roots", "expected_hashes", "state_root", "port", "login"]);
const INPUT_ROOT_KEYS = ["raw", "r6", "materialized"];

export function parseUx1DemoArgs(argv) {
  const args = { port: 8787, login: "ux1-local-operator" };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === "--interpreter") args.interpreter = value;
    else if (key === "--adapter") args.adapter = value;
    else if (key === "--raw-root") args.rawRoot = value;
    else if (key === "--r6-root") args.r6Root = value;
    else if (key === "--materialized") args.materialized = value;
    else if (key === "--session-file") args.sessionFile = value;
    else if (key === "--port") args.port = Number(value);
    else if (key === "--login") args.login = value;
    else throw new Error(`unknown_demo_argument:${key}`);
    index += 1;
  }
  if (!args.interpreter || !args.adapter || !args.rawRoot || !args.r6Root || !args.materialized) throw new Error("fixed_demo_paths_required");
  for (const field of ["interpreter", "adapter", "rawRoot", "r6Root", "materialized", "sessionFile"]) {
    if (args[field] && !path.isAbsolute(args[field])) throw new Error("demo_path_must_be_absolute");
  }
  if (!Number.isInteger(args.port) || args.port < 1 || args.port > 65535) throw new Error("demo_port_invalid");
  if (!/^[a-z0-9-]{1,39}$/.test(args.login)) throw new Error("demo_login_invalid");
  args.executable = args.adapter;
  return args;
}

export function parseUx1OperatorArgs(argv) {
  if (!["start", "stop", "status"].includes(argv[0])) throw new Error("unknown_demo_command");
  let configPath = "";
  for (let index = 1; index < argv.length; index += 1) {
    if (argv[index] !== "--config") throw new Error(`unknown_demo_argument:${argv[index]}`);
    configPath = argv[index + 1] || "";
    index += 1;
  }
  if (!configPath || !path.isAbsolute(configPath)) throw new Error("demo_config_must_be_absolute");
  return { command: argv[0], configPath };
}

export function parseUx1OperatorConfig(value) {
  if (!value || Array.isArray(value) || typeof value !== "object") throw new Error("ux1_config_invalid");
  if (Object.keys(value).some((key) => !CONFIG_KEYS.has(key))) throw new Error("ux1_config_unknown_field");
  for (const field of ["interpreter", "executable", "state_root"]) {
    if (typeof value[field] !== "string" || !path.isAbsolute(value[field])) throw new Error("demo_path_must_be_absolute");
  }
  const roots = value.input_roots;
  if (!roots || Array.isArray(roots) || typeof roots !== "object") throw new Error("ux1_config_invalid");
  if (Object.keys(roots).length !== INPUT_ROOT_KEYS.length || INPUT_ROOT_KEYS.some((key) => typeof roots[key] !== "string" || !path.isAbsolute(roots[key]))) {
    throw new Error("demo_path_must_be_absolute");
  }
  const hashes = value.expected_hashes;
  if (!hashes || Array.isArray(hashes) || typeof hashes !== "object"
      || Object.keys(hashes).length !== UX1_EVIDENCE_HASH_KEYS.length
      || UX1_EVIDENCE_HASH_KEYS.some((key) => typeof hashes[key] !== "string" || !/^[a-f0-9]{64}$/.test(hashes[key]))) {
    throw new Error("ux1_expected_hashes_required");
  }
  const port = value.port === undefined ? 8787 : value.port;
  const login = value.login === undefined ? "ux1-local-operator" : value.login;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("demo_port_invalid");
  if (!/^[a-z0-9-]{1,39}$/.test(login)) throw new Error("demo_login_invalid");
  return {
    interpreter: value.interpreter,
    executable: value.executable,
    input_roots: { raw: roots.raw, r6: roots.r6, materialized: roots.materialized },
    expected_hashes: Object.fromEntries(UX1_EVIDENCE_HASH_KEYS.map((key) => [key, hashes[key]])),
    state_root: value.state_root,
    port,
    login,
  };
}

export function operatorDemoArgs(config, configPath) {
  return {
    interpreter: config.interpreter,
    adapter: config.executable,
    executable: config.executable,
    rawRoot: config.input_roots.raw,
    r6Root: config.input_roots.r6,
    materialized: config.input_roots.materialized,
    expectedHashes: config.expected_hashes,
    sessionFile: path.join(config.state_root, "session"),
    persistDir: path.join(config.state_root, "durable"),
    instanceFile: path.join(config.state_root, "instance.json"),
    port: config.port,
    login: config.login,
    configPath,
  };
}

export async function assertDemoFiles(args) {
  for (const file of [args.interpreter, args.executable || args.adapter]) {
    const info = await stat(file);
    if (!info.isFile()) throw new Error("demo_path_not_file");
  }
  for (const root of [args.rawRoot, args.r6Root]) {
    const info = await stat(root);
    if (!info.isDirectory()) throw new Error("demo_input_root_not_directory");
  }
  if (!(await stat(args.materialized)).isFile()) throw new Error("demo_materialized_not_file");
}

export function calculatorChildEnv(args) {
  const env = {};
  for (const key of CHILD_ENV_KEYS) {
    if (process.env[key]) env[key] = process.env[key];
  }
  env.UX1_RAW_ROOT = args.rawRoot;
  env.UX1_R6_ROOT = args.r6Root;
  env.UX1_MATERIALIZED = args.materialized;
  return env;
}

function forbiddenRequest(value) {
  if (!value || typeof value !== "object") return false;
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_REQUEST_KEYS.has(key) || forbiddenRequest(item)) return true;
  }
  return false;
}

function calculatorFailure() {
  return new Response(JSON.stringify({ error: "calculator_failed" }), {
    status: 502,
    headers: { "content-type": "application/json" },
  });
}

export function runFixedCalculator(args, body, limits = {}) {
  const timeoutMs = limits.timeoutMs ?? 30000;
  const maxBytes = limits.maxBytes ?? 65536;
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(args.interpreter, [args.executable || args.adapter], {
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        env: calculatorChildEnv(args),
      });
    } catch {
      resolve(calculatorFailure());
      return;
    }
    const chunks = [];
    let size = 0;
    let settled = false;
    let failed = false;
    args.activeChildren?.add(child);
    const finish = (response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(response);
    };
    const fail = () => {
      if (failed) return;
      failed = true;
      try { child.kill("SIGKILL"); } catch { /* already exited */ }
      try { child.stdin.destroy(); } catch { /* already closed */ }
    };
    const timer = setTimeout(fail, timeoutMs);
    child.stderr.resume();
    child.stdout.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        fail();
        return;
      }
      chunks.push(chunk);
    });
    child.stdin.on("error", () => {});
    child.on("error", fail);
    child.on("close", (code) => {
      args.activeChildren?.delete(child);
      if (failed || code !== 0) finish(calculatorFailure());
      else finish(new Response(Buffer.concat(chunks).toString("utf8"), {
        status: 200,
        headers: { "content-type": "application/json" },
      }));
    });
    child.stdin.end(body);
  });
}

export function ux1CalculatorFetch(args, limits = {}) {
  let inFlight = 0;
  const maxConcurrent = limits.maxConcurrent ?? 1;
  return async (request) => {
    if (request.method !== "POST" || new URL(request.url).pathname !== "/preview") return calculatorFailure();
    if (inFlight >= maxConcurrent) {
      return new Response(JSON.stringify({ error: "calculator_busy" }), {
        status: 429,
        headers: { "content-type": "application/json" },
      });
    }
    inFlight += 1;
    try {
      const body = await request.text();
      try {
        if (forbiddenRequest(JSON.parse(body))) return calculatorFailure();
      } catch {
        return calculatorFailure();
      }
      return await runFixedCalculator(args, body, limits);
    } finally {
      inFlight -= 1;
    }
  };
}

async function writePrivateFile(file, contents) {
  await writeFile(file, contents, { mode: 0o600 });
  await chmod(file, 0o600);
}

export async function startUx1Demo(args) {
  await assertDemoFiles(args);
  args.activeChildren = new Set();
  const persist = args.persistDir || await mkdtemp(path.join(tmpdir(), "ux1-local-demo-"));
  if (args.persistDir) await mkdir(args.persistDir, { recursive: true, mode: 0o700 });
  const sessionSecret = randomBytes(32).toString("hex");
  const runtimeEpoch = randomBytes(16).toString("hex");
  const mf = new Miniflare({
    modules: true,
    modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
    scriptPath: fileURLToPath(new URL("./worker.js", import.meta.url)),
    compatibilityDate: "2026-06-08",
    host: "127.0.0.1",
    port: args.port,
    bindings: {
      SESSION_SECRET: sessionSecret,
      ALLOWED_GITHUB_LOGINS: args.login,
      RUNTIME_SETTINGS_DISPATCH_TOKEN: "local-demo-not-a-dispatch-grant",
      UX1_RUNTIME_EPOCH: runtimeEpoch,
      ...(args.expectedHashes ? { UX1_EXPECTED_EVIDENCE_HASHES: JSON.stringify(args.expectedHashes) } : {}),
    },
    durableObjects: { STRATEGY_SWITCH_RUNTIME_INSTANCES: { className: "RuntimeInstances", useSQLite: true } },
    durableObjectsPersist: persist,
    serviceBindings: { UX1_RESEARCH_CALCULATOR: ux1CalculatorFetch(args) },
    outboundService: () => new Response("offline UX1 demo", { status: 503 }),
  });
  const url = await mf.ready;
  if (url.hostname !== "127.0.0.1") {
    await mf.dispose();
    throw new Error("demo_host_not_loopback");
  }
  const token = await __test.makeSession(args.login, [], { SESSION_SECRET: sessionSecret });
  if (args.sessionFile) {
    await writeFile(args.sessionFile, token, { mode: 0o600, flag: args.persistDir ? "w" : "wx" });
    await chmod(args.sessionFile, 0o600);
  }
  if (args.instanceFile) {
    const listenerPid = await demoWorkerdListener(args.port);
    if (!listenerPid) {
      await mf.dispose();
      throw new Error("ux1_listener_identity_unavailable");
    }
    await writePrivateFile(args.instanceFile, JSON.stringify({
      pid: process.pid,
      listener_pid: listenerPid,
      port: args.port,
      config_path: args.configPath,
    }));
  }
  console.log(`UX1 demo ${url.origin}`);
  console.log(`local login ${args.login}`);
  return mf;
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function processCommand(pid) {
  return new Promise((resolve) => {
    execFile("ps", ["-ww", "-p", String(pid), "-o", "command="], { shell: false }, (error, stdout) => {
      resolve(error ? "" : String(stdout || "").trim());
    });
  });
}

function processExecutable(pid, platform = process.platform) {
  if (platform === "linux") {
    return readlink(`/proc/${pid}/exe`).catch(() => "");
  }
  return new Promise((resolve) => {
    execFile("ps", ["-p", String(pid), "-o", "comm="], { shell: false }, (error, stdout) => {
      resolve(error ? "" : String(stdout || "").trim());
    });
  });
}

function portListeners(port) {
  return new Promise((resolve) => {
    execFile("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { shell: false }, (error, stdout) => {
      resolve(error ? [] : String(stdout || "").split(/\s+/).filter(Boolean).map(Number).filter(Number.isSafeInteger));
    });
  });
}

async function demoWorkerdListener(port) {
  const listeners = await portListeners(port);
  if (listeners.length !== 1) return null;
  const executable = await processExecutable(listeners[0]);
  const bundled = path.join(path.dirname(fileURLToPath(import.meta.url)), "node_modules", "@cloudflare") + path.sep;
  return executable.startsWith(bundled) && /\/workerd[^/]*\/bin\/workerd$/.test(executable) ? listeners[0] : null;
}

export const ux1DemoTest = Object.freeze({ processExecutable });

async function recoverRecordedListener(args) {
  const instance = await readInstance(args.instanceFile);
  if (!instance || !instance.listener_pid) return;
  const listeners = await portListeners(args.port);
  if (!listeners.includes(instance.listener_pid)) return;
  if (processAlive(instance.pid)) throw new Error("ux1_previous_process_still_running");
  if (await demoWorkerdListener(args.port) !== instance.listener_pid) throw new Error("ux1_port_in_use_by_other_process");
  process.kill(instance.listener_pid, "SIGTERM");
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (!(await portListeners(args.port)).includes(instance.listener_pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (await demoWorkerdListener(args.port) !== instance.listener_pid) throw new Error("ux1_port_in_use_by_other_process");
  process.kill(instance.listener_pid, "SIGKILL");
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (!(await portListeners(args.port)).includes(instance.listener_pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("ux1_listener_did_not_stop");
}

function commandMatchesInstance(command, configPath) {
  return command.includes("ux1_local_demo.mjs") && command.includes(configPath);
}

async function readInstance(instanceFile) {
  try {
    const parsed = JSON.parse(await readFile(instanceFile, "utf8"));
    const pid = parsed?.pid;
    if (!Number.isInteger(pid) || pid <= 1) return null;
    if (parsed.config_path !== undefined && typeof parsed.config_path !== "string") return null;
    return { pid, port: parsed.port, config_path: parsed.config_path || "", listener_pid: parsed.listener_pid || null };
  } catch {
    return null;
  }
}

async function matchingInstance(args) {
  const instance = await readInstance(args.instanceFile);
  if (!instance) return null;
  if (!processAlive(instance.pid)) return null;
  const command = await processCommand(instance.pid);
  if (!commandMatchesInstance(command, args.configPath)) return null;
  return instance;
}

export async function ux1DemoStatus(args) {
  const instance = await matchingInstance(args);
  if (!instance) {
    const recorded = await readInstance(args.instanceFile);
    const orphan = recorded?.listener_pid && (await portListeners(args.port)).includes(recorded.listener_pid);
    return `status=${orphan ? "interrupted" : "stopped"}\nstate_root=${path.dirname(args.persistDir)}`;
  }
  return `status=running\nlisten=http://127.0.0.1:${instance.port}\nstate_root=${path.dirname(args.persistDir)}`;
}

export async function stopUx1Demo(args) {
  const instance = await readInstance(args.instanceFile);
  if (!instance || !processAlive(instance.pid)) {
    await recoverRecordedListener(args);
    await rm(args.instanceFile, { force: true });
    return "status=stopped";
  }
  const command = await processCommand(instance.pid);
  if (!commandMatchesInstance(command, args.configPath)) throw new Error("stop_target_mismatch");
  try {
    process.kill(instance.pid, "SIGTERM");
  } catch (error) {
    if (error.code !== "ESRCH") throw new Error("stop_target_mismatch");
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!processAlive(instance.pid)) {
      await recoverRecordedListener(args);
      await rm(args.instanceFile, { force: true });
      return "status=stopped";
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const still = await processCommand(instance.pid);
  if (!commandMatchesInstance(still, args.configPath)) throw new Error("stop_target_mismatch");
  try { process.kill(instance.pid, "SIGKILL"); } catch (error) {
    if (error.code !== "ESRCH") throw new Error("stop_target_mismatch");
  }
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (!processAlive(instance.pid)) {
      await recoverRecordedListener(args);
      await rm(args.instanceFile, { force: true });
      return "status=stopped";
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("ux1_stop_uncertain");
}

async function loadOperator(configPath) {
  const text = await readFile(configPath, "utf8");
  if (text.length > 65536) throw new Error("ux1_config_invalid");
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error("ux1_config_invalid"); }
  const config = parseUx1OperatorConfig(parsed);
  await mkdir(config.state_root, { recursive: true, mode: 0o700 });
  if (((await stat(config.state_root)).mode & 0o077) !== 0) throw new Error("ux1_state_root_not_private");
  return operatorDemoArgs(config, configPath);
}

async function shutdownDemo(mf, instanceFile, activeChildren) {
  for (const child of activeChildren || []) {
    try { child.kill("SIGKILL"); } catch { /* already exited */ }
  }
  while (activeChildren?.size) await new Promise((resolve) => setTimeout(resolve, 20));
  try { await mf.dispose(); } catch { /* already closed */ }
  if (instanceFile) await rm(instanceFile, { force: true });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const run = async () => {
    if (["start", "stop", "status"].includes(argv[0])) {
      const parsed = parseUx1OperatorArgs(argv);
      const args = await loadOperator(parsed.configPath);
      if (parsed.command === "status") {
        console.log(await ux1DemoStatus(args));
        return;
      }
      if (parsed.command === "stop") {
        console.log(await stopUx1Demo(args));
        return;
      }
      if (await matchingInstance(args)) throw new Error("already_running");
      await recoverRecordedListener(args);
      const mf = await startUx1Demo(args);
      let closing = false;
      const onStop = () => {
        if (closing) return;
        closing = true;
        shutdownDemo(mf, args.instanceFile, args.activeChildren).then(() => process.exit(0));
      };
      process.on("SIGTERM", onStop);
      process.on("SIGINT", onStop);
      return;
    }
    await startUx1Demo(parseUx1DemoArgs(argv));
  };
  run().catch((error) => {
    console.error(error.message || "ux1_demo_failed");
    process.exit(1);
  });
}
