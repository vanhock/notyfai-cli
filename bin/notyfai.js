#!/usr/bin/env node
/**
 * Notyfai CLI — `notyfai setup` writes Cursor hook files and sends a test notification.
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const sub = argv[2];
  const rest = argv.slice(3);
  const opts = {
    key: null,
    dir: null,
    apiUrl: null,
    yes: false,
    force: false,
    help: false,
  };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "-y" || a === "--yes") opts.yes = true;
    else if (a === "--force") opts.force = true;
    else if (a.startsWith("--key=")) opts.key = a.slice(6);
    else if (a === "--key") opts.key = rest[++i] ?? "";
    else if (a.startsWith("--dir=")) opts.dir = a.slice(6);
    else if (a === "--dir") opts.dir = rest[++i] ?? "";
    else if (a.startsWith("--api-url=")) opts.apiUrl = a.slice(10);
    else if (a === "--api-url") opts.apiUrl = rest[++i] ?? "";
    else if (a === "-h" || a === "--help") opts.help = true;
  }
  return { sub, opts };
}

function printHelp() {
  console.log(`Usage:
  notyfai setup [options]

Options:
  --key <token>     CLI setup key (prefer NOTYFAI_SETUP_KEY env to avoid shell history)
  --dir <path>      Project root (default: current directory)
  --api-url <url>   API base, e.g. https://xxx.supabase.co/functions/v1 (or NOTYFAI_API_URL)
  -y, --yes         Skip confirmation prompt
  --force           Overwrite existing .cursor/hooks.json
  -h, --help        Show this help

Environment:
  NOTYFAI_SETUP_KEY   Same as --key
  NOTYFAI_API_URL     Same as --api-url
`);
}

function displayPath(abs, homedir) {
  if (homedir && (abs === homedir || abs.startsWith(homedir + path.sep))) {
    return "~" + abs.slice(homedir.length);
  }
  return abs;
}

function confirm(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (ans) => {
      rl.close();
      const a = (ans ?? "").trim().toLowerCase();
      resolve(a === "" || a === "y" || a === "yes");
    });
  });
}

function hookRequestUrlAndToken(hookUrl) {
  let requestUrl = hookUrl;
  let token = "";
  try {
    const u = new URL(hookUrl);
    const t = u.searchParams.get("token");
    if (t) {
      token = t;
      u.searchParams.delete("token");
      requestUrl = u.toString().replace(/\?$/, "");
    }
  } catch {
    // keep raw URL
  }
  return { requestUrl, token };
}

function truncateHookPreview(hookUrl) {
  try {
    const u = new URL(hookUrl);
    const pathAndQuery = u.pathname + (u.search ? "?…" : "");
    return `${u.origin}${pathAndQuery}`;
  } catch {
    return hookUrl.slice(0, 48) + (hookUrl.length > 48 ? "…" : "");
  }
}

async function fetchHookSetup(apiBase, setupKey) {
  const base = apiBase.replace(/\/$/, "");
  const url = `${base}/api/cli/hook-setup`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${setupKey}`,
      Accept: "application/json",
    },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = {};
  }
  if (!res.ok) {
    const err = body.error || text || res.statusText;
    throw new Error(typeof err === "string" ? err : `HTTP ${res.status}`);
  }
  return body;
}

async function sendTestHook(hookUrl) {
  const { requestUrl, token } = hookRequestUrlAndToken(hookUrl);
  const headers = {
    "Content-Type": "application/json",
  };
  if (token) headers["x-notyfai-token"] = token;
  const payload = JSON.stringify({
    hook_event_name: "stop",
    conversation_id: "notyfai-cli-test",
    generation_id: "notyfai-cli-test",
    status: "complete",
  });
  const res = await fetch(requestUrl, {
    method: "POST",
    headers,
    body: payload,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(t || `Test hook failed: HTTP ${res.status}`);
  }
}

function readSendScript() {
  const tpl = path.join(__dirname, "..", "templates", "notyfai-send-cursor.sh");
  return fs.readFileSync(tpl, "utf8");
}

async function runSetup() {
  const { sub, opts } = parseArgs(process.argv);
  if (!sub || opts.help) {
    printHelp();
    process.exit(0);
  }
  if (sub !== "setup") {
    console.error(`Unknown command: ${sub}`);
    printHelp();
    process.exit(1);
  }

  const homedir = process.env.HOME || process.env.USERPROFILE || "";
  const setupKey = (process.env.NOTYFAI_SETUP_KEY || opts.key || "").trim();
  const apiBase = (process.env.NOTYFAI_API_URL || opts.apiUrl || "").trim().replace(/\/$/, "");
  const projectRoot = path.resolve(opts.dir || process.cwd());

  if (!setupKey) {
    console.error("Missing setup key: set NOTYFAI_SETUP_KEY or pass --key");
    process.exit(1);
  }
  if (!apiBase) {
    console.error("Missing API URL: set NOTYFAI_API_URL or pass --api-url");
    process.exit(1);
  }

  let data;
  try {
    data = await fetchHookSetup(apiBase, setupKey);
  } catch (e) {
    console.error((e && e.message) || String(e));
    process.exit(1);
  }

  const ide = (data.ide || "cursor").toLowerCase();
  if (ide !== "cursor") {
    console.error(`This CLI setup targets Cursor only for now (instance IDE: ${ide}). Use the app for other IDEs.`);
    process.exit(1);
  }

  const hooksPath = path.join(projectRoot, ".cursor", "hooks.json");
  if (fs.existsSync(hooksPath) && !opts.force) {
    console.error(`Refusing to overwrite ${hooksPath} (use --force).`);
    process.exit(1);
  }

  console.log("");
  console.log("  ✓ Detected: Cursor IDE");
  console.log(`  ✓ Project: ${displayPath(projectRoot, homedir)}`);
  console.log("");
  console.log("  This will create .cursor/hooks.json with:");
  const hookUrlPreview = truncateHookPreview(data.hook_url || "");
  console.log("  ┌──────────────────────────────────────────┐");
  console.log("  │ Hook: stop                               │");
  console.log("  │ Action: POST to your Notyfai hook URL    │");
  console.log("  │ Sends: { status, message }               │");
  console.log("  │ No source code leaves your machine.      │");
  console.log("  └──────────────────────────────────────────┘");
  console.log(`  ${hookUrlPreview}`);
  console.log("");

  if (!opts.yes) {
    const ok = await confirm("  Proceed? [Y/n] ");
    if (!ok) {
      console.log("Cancelled.");
      process.exit(0);
    }
  }

  const hooksDir = path.join(projectRoot, ".cursor", "hooks");
  fs.mkdirSync(hooksDir, { recursive: true });
  const sendScriptPath = path.join(hooksDir, "notyfai-send.sh");
  fs.writeFileSync(sendScriptPath, readSendScript(), "utf8");
  if (process.platform !== "win32") {
    fs.chmodSync(sendScriptPath, 0o755);
  }

  fs.writeFileSync(path.join(projectRoot, ".cursor", "notyfai-url"), data.hook_url + "\n", "utf8");
  fs.writeFileSync(hooksPath, JSON.stringify(data.hooks_json, null, 2) + "\n", "utf8");

  console.log("");
  console.log("  ✓ Created .cursor/hooks.json");
  console.log("  ✓ Sending test notification...");
  try {
    await sendTestHook(data.hook_url);
    console.log("  📱 Check your phone — you should see it now.");
  } catch (e) {
    console.error("  ⚠ Test notification failed:", (e && e.message) || e);
    console.log("  Hooks are installed; fix network or instance filters and try again from Cursor.");
  }
  console.log("");
  console.log("  To remove: delete .cursor/hooks.json");
  console.log("  Docs: notyfai.com/docs");
  console.log("");
}

runSetup().catch((e) => {
  console.error(e);
  process.exit(1);
});
