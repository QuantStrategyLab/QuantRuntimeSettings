// Local UX1 preview only. Binds 127.0.0.1 and a fixed interpreter/adapter.
// The production Worker has no anonymous session route.

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { __test } from "./worker.js";

const require = createRequire(new URL("./package.json", import.meta.url));
const { Miniflare } = require("miniflare");
const FORBIDDEN_REQUEST_KEYS = new Set(["path", "url", "uri", "command", "interpreter", "adapter", "input_root"]);

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
  return args;
}

export async function assertDemoFiles(args) {
  for (const file of [args.interpreter, args.adapter]) {
    const info = await stat(file);
    if (!info.isFile()) throw new Error("demo_path_not_file");
  }
  for (const root of [args.rawRoot, args.r6Root]) {
    const info = await stat(root);
    if (!info.isDirectory()) throw new Error("demo_input_root_not_directory");
  }
  if (!(await stat(args.materialized)).isFile()) throw new Error("demo_materialized_not_file");
}

function forbiddenRequest(value) {
  if (!value || typeof value !== "object") return false;
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_REQUEST_KEYS.has(key) || forbiddenRequest(item)) return true;
  }
  return false;
}

function runFixedAdapter(args, body) {
  return new Promise((resolve) => {
    const child = spawn(args.interpreter, [args.adapter], {
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        UX1_RAW_ROOT: args.rawRoot,
        UX1_R6_ROOT: args.r6Root,
        UX1_MATERIALIZED: args.materialized,
      },
    });
    const chunks = [];
    let size = 0;
    let settled = false;
    const finish = (status, text) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(new Response(text, { status, headers: { "content-type": "application/json" } }));
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(502, JSON.stringify({ error: "calculator_failed" }));
    }, 30000);
    child.stdout.on("data", (chunk) => {
      size += chunk.length;
      if (size > 65536) {
        child.kill();
        finish(502, JSON.stringify({ error: "calculator_failed" }));
        return;
      }
      chunks.push(chunk);
    });
    child.on("error", () => finish(502, JSON.stringify({ error: "calculator_failed" })));
    child.on("close", (code) => {
      if (code !== 0) finish(502, JSON.stringify({ error: "calculator_failed" }));
      else finish(200, Buffer.concat(chunks).toString("utf8"));
    });
    child.stdin.end(body);
  });
}

export function ux1CalculatorFetch(args) {
  return async (request) => {
    if (request.method !== "POST" || new URL(request.url).pathname !== "/preview") {
      return new Response(JSON.stringify({ error: "calculator_failed" }), { status: 400 });
    }
    const body = await request.text();
    try {
      if (forbiddenRequest(JSON.parse(body))) {
        return new Response(JSON.stringify({ error: "calculator_failed" }), { status: 400 });
      }
    } catch {
      return new Response(JSON.stringify({ error: "calculator_failed" }), { status: 400 });
    }
    return runFixedAdapter(args, body);
  };
}

export async function startUx1Demo(args) {
  await assertDemoFiles(args);
  const persist = await mkdtemp(path.join(tmpdir(), "ux1-local-demo-"));
  const sessionSecret = randomBytes(32).toString("hex");
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
  const cookie = await __test.makeSession(args.login, [], { SESSION_SECRET: sessionSecret });
  if (args.sessionFile) await writeFile(args.sessionFile, cookie, { mode: 0o600, flag: "wx" });
  console.log(`UX1 demo ${url.origin}`);
  console.log(`local login ${args.login}`);
  return mf;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startUx1Demo(parseUx1DemoArgs(process.argv.slice(2))).catch((error) => {
    console.error(error.message || "ux1_demo_failed");
    process.exit(1);
  });
}
