#!/usr/bin/env node
/**
 * Notyfai CLI — `notyfai setup` installs hook files for your IDE (from API + templates).
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Shell templates ship inside the `notyfai` package (`templates/` next to `bin/`). */
function templatesDir() {
  return path.join(__dirname, "..", "templates");
}

function readTemplate(filename) {
  return fs.readFileSync(path.join(templatesDir(), filename), "utf8");
}

const VALID_AGENTS = new Set(["cursor", "claude", "codex", "windsurf", "copilot", "gemini"]);

function parseArgs(argv) {
  const sub = argv[2];
  const rest = argv.slice(3);
  const opts = {
    key: null,
    dir: null,
    apiUrl: null,
    agent: null,
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
    else if (a.startsWith("--agent=")) opts.agent = a.slice(8);
    else if (a === "--agent") opts.agent = rest[++i] ?? "";
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
  --api-url <url>   API base, e.g. https://xxx.supabase.co/functions/v1/api (or NOTYFAI_API_URL)
  --agent <name>    AI agent / IDE hooks to install: cursor, claude, codex, windsurf, copilot, gemini
                    (default: your project's agent from the API; NOTYFAI_AGENT is an alias)
  -y, --yes         Skip confirmation prompts (also replaces an existing hook config without asking)
  --force           Replace existing hook config without asking (non-interactive; use with no TTY)
  -h, --help        Show this help

Environment:
  NOTYFAI_SETUP_KEY   Same as --key
  NOTYFAI_API_URL     Same as --api-url
  NOTYFAI_AGENT       Same as --agent when --agent is omitted
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

/** Explicit y/yes only (empty line = no). Use for overwriting existing config. */
function confirmReplace(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (ans) => {
      rl.close();
      const a = (ans ?? "").trim().toLowerCase();
      resolve(a === "y" || a === "yes");
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

async function fetchHookSetup(apiBase, setupKey, agent) {
  const base = apiBase.replace(/\/$/, "");
  const q =
    agent && VALID_AGENTS.has(agent) ? `?agent=${encodeURIComponent(agent)}` : "";
  const url = `${base}/api/cli/hook-setup${q}`;
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

function chmodExec(filePath) {
  if (process.platform !== "win32") {
    fs.chmodSync(filePath, 0o755);
  }
}

function guardPathForIde(ide, projectRoot) {
  const rel = {
    cursor: [".cursor", "hooks.json"],
    claude: [".claude", "settings.local.json"],
    codex: [".codex", "config.toml"],
    windsurf: [".windsurf", "hooks.json"],
    copilot: [".github", "hooks", "notyfai.json"],
    gemini: [".gemini", "settings.json"],
  }[ide] || [".cursor", "hooks.json"];
  return path.join(projectRoot, ...rel);
}

function ideLabel(ide) {
  const map = {
    cursor: "Cursor",
    claude: "Claude Code",
    codex: "OpenAI Codex",
    windsurf: "Windsurf",
    copilot: "GitHub Copilot CLI",
    gemini: "Gemini CLI",
  };
  return map[ide] || ide;
}

function stripNotifyLines(toml) {
  return toml
    .split("\n")
    .filter((line) => !/^\s*notify\s*=/.test(line))
    .join("\n")
    .replace(/\n+$/, "");
}

function installHooks(data, projectRoot) {
  const ide = String(data.ide || "cursor").toLowerCase();
  const hookUrl = data.hook_url;
  if (!hookUrl) throw new Error("API response missing hook_url");
  const hooksJson = data.hooks_json;
  if (!hooksJson) throw new Error("API response missing hooks_json");

  if (ide === "cursor") {
    const hooksDir = path.join(projectRoot, ".cursor", "hooks");
    fs.mkdirSync(hooksDir, { recursive: true });
    const sendPath = path.join(hooksDir, "notyfai-send.sh");
    fs.writeFileSync(sendPath, readTemplate("notyfai-send-cursor.sh"), "utf8");
    chmodExec(sendPath);
    fs.writeFileSync(path.join(projectRoot, ".cursor", "notyfai-url"), hookUrl + "\n", "utf8");
    fs.writeFileSync(
      path.join(projectRoot, ".cursor", "hooks.json"),
      JSON.stringify(hooksJson, null, 2) + "\n",
      "utf8"
    );
    return [path.join(projectRoot, ".cursor", "hooks.json")];
  }

  if (ide === "claude") {
    const hooksDir = path.join(projectRoot, ".claude", "hooks");
    fs.mkdirSync(hooksDir, { recursive: true });
    const sendPath = path.join(hooksDir, "notyfai-send.sh");
    fs.writeFileSync(sendPath, readTemplate("notyfai-send-claude.sh"), "utf8");
    chmodExec(sendPath);
    fs.writeFileSync(path.join(projectRoot, ".claude", "notyfai-url"), hookUrl + "\n", "utf8");
    fs.writeFileSync(
      path.join(projectRoot, ".claude", "settings.local.json"),
      JSON.stringify(hooksJson, null, 2) + "\n",
      "utf8"
    );
    return [path.join(projectRoot, ".claude", "settings.local.json")];
  }

  if (ide === "codex") {
    const codexDir = path.join(projectRoot, ".codex");
    const hooksDir = path.join(codexDir, "hooks");
    fs.mkdirSync(hooksDir, { recursive: true });
    const notifyPath = path.join(hooksDir, "notyfai-notify.sh");
    fs.writeFileSync(notifyPath, readTemplate("notyfai-notify-codex.sh"), "utf8");
    chmodExec(notifyPath);
    fs.writeFileSync(path.join(codexDir, "notyfai-url"), hookUrl + "\n", "utf8");
    const configPath = path.join(codexDir, "config.toml");
    let body = "";
    if (fs.existsSync(configPath)) {
      body = stripNotifyLines(fs.readFileSync(configPath, "utf8"));
    }
    const line = 'notify = [".codex/hooks/notyfai-notify.sh"]';
    const out = body ? `${body}\n${line}\n` : `${line}\n`;
    fs.writeFileSync(configPath, out, "utf8");
    return [configPath];
  }

  if (ide === "windsurf") {
    const hooksDir = path.join(projectRoot, ".windsurf", "hooks");
    fs.mkdirSync(hooksDir, { recursive: true });
    const sendPath = path.join(hooksDir, "notyfai-send.sh");
    fs.writeFileSync(sendPath, readTemplate("notyfai-send-windsurf.sh"), "utf8");
    chmodExec(sendPath);
    fs.writeFileSync(path.join(projectRoot, ".windsurf", "notyfai-url"), hookUrl + "\n", "utf8");
    fs.writeFileSync(
      path.join(projectRoot, ".windsurf", "hooks.json"),
      JSON.stringify(hooksJson, null, 2) + "\n",
      "utf8"
    );
    return [path.join(projectRoot, ".windsurf", "hooks.json")];
  }

  if (ide === "copilot") {
    const hooksDir = path.join(projectRoot, ".github", "hooks");
    const scriptsDir = path.join(hooksDir, "scripts");
    fs.mkdirSync(scriptsDir, { recursive: true });
    const sendPath = path.join(scriptsDir, "notyfai-send.sh");
    fs.writeFileSync(sendPath, readTemplate("notyfai-send-copilot.sh"), "utf8");
    chmodExec(sendPath);
    const wrapPath = path.join(scriptsDir, "notyfai-wrap.sh");
    fs.writeFileSync(wrapPath, readTemplate("notyfai-wrap-copilot.sh"), "utf8");
    chmodExec(wrapPath);
    fs.writeFileSync(path.join(hooksDir, "notyfai-url"), hookUrl + "\n", "utf8");
    fs.writeFileSync(
      path.join(hooksDir, "notyfai.json"),
      JSON.stringify(hooksJson, null, 2) + "\n",
      "utf8"
    );
    return [path.join(hooksDir, "notyfai.json")];
  }

  if (ide === "gemini") {
    const geminiDir = path.join(projectRoot, ".gemini");
    const hooksDir = path.join(geminiDir, "hooks");
    fs.mkdirSync(hooksDir, { recursive: true });
    const hookPath = path.join(hooksDir, "notyfai-hook.sh");
    fs.writeFileSync(hookPath, readTemplate("notyfai-hook-gemini.sh"), "utf8");
    chmodExec(hookPath);
    fs.writeFileSync(path.join(geminiDir, "notyfai-url"), hookUrl + "\n", "utf8");
    const settingsPath = path.join(geminiDir, "settings.json");
    const incomingHooks =
      hooksJson.hooks && typeof hooksJson.hooks === "object" ? hooksJson.hooks : {};
    let merged;
    if (fs.existsSync(settingsPath)) {
      try {
        const existing = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
        const prevHooks = existing.hooks && typeof existing.hooks === "object" ? existing.hooks : {};
        merged = {
          ...existing,
          hooks: { ...prevHooks, ...incomingHooks },
        };
      } catch {
        merged = { ...hooksJson };
      }
    } else {
      merged = { ...hooksJson };
    }
    fs.writeFileSync(settingsPath, JSON.stringify(merged, null, 2) + "\n", "utf8");
    return [settingsPath];
  }

  throw new Error(`Unsupported IDE in API response: ${ide}`);
}

async function runSetup() {
  const { sub, opts } = parseArgs(process.argv);
  if (opts.help || sub === "-h" || sub === "--help") {
    printHelp();
    process.exit(0);
  }
  if (!sub) {
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
  const agentRaw = ((opts.agent || process.env.NOTYFAI_AGENT || "") + "").trim().toLowerCase();
  const agentForApi = agentRaw === "" ? null : agentRaw;

  if (!setupKey) {
    console.error("Missing setup key: set NOTYFAI_SETUP_KEY or pass --key");
    process.exit(1);
  }
  if (!apiBase) {
    console.error("Missing API URL: set NOTYFAI_API_URL or pass --api-url");
    process.exit(1);
  }
  if (agentForApi && !VALID_AGENTS.has(agentForApi)) {
    console.error(
      `Invalid --agent "${opts.agent || process.env.NOTYFAI_AGENT}": use cursor, claude, codex, windsurf, copilot, or gemini`,
    );
    process.exit(1);
  }

  let data;
  try {
    data = await fetchHookSetup(apiBase, setupKey, agentForApi);
  } catch (e) {
    console.error((e && e.message) || String(e));
    process.exit(1);
  }

  const ide = String(data.ide || "cursor").toLowerCase();
  const guardPath = guardPathForIde(ide, projectRoot);
  const existingHooksConfig = fs.existsSync(guardPath);
  let replaceExistingHooks = opts.force || opts.yes;

  if (existingHooksConfig && !replaceExistingHooks) {
    if (!process.stdin.isTTY) {
      console.error(
        `Existing hook config ${displayPath(guardPath, homedir)} — use -y or --force in non-interactive mode.`,
      );
      process.exit(1);
    }
    console.log("");
    console.log(`  ⚠ Existing ${ideLabel(ide)} hook config:`);
    console.log(`    ${displayPath(guardPath, homedir)}`);
    const ok = await confirmReplace("  Replace it with Notyfai hooks? [y/N] ");
    if (!ok) {
      console.log("Cancelled.");
      process.exit(0);
    }
    replaceExistingHooks = true;
  }

  console.log("");
  console.log(`  ✓ Detected: ${ideLabel(ide)}`);
  console.log(`  ✓ Project: ${displayPath(projectRoot, homedir)}`);
  if (existingHooksConfig && replaceExistingHooks) {
    console.log(`  ✓ Replacing existing hook config`);
  }
  console.log("");
  console.log("  This installs local hook scripts that POST events to your Notyfai hook URL.");
  const hookUrlPreview = truncateHookPreview(data.hook_url || "");
  console.log(`  ${hookUrlPreview}`);
  console.log("");

  if (!opts.yes) {
    const ok = await confirm("  Proceed? [Y/n] ");
    if (!ok) {
      console.log("Cancelled.");
      process.exit(0);
    }
  }

  try {
    installHooks(data, projectRoot);
  } catch (e) {
    console.error((e && e.message) || String(e));
    process.exit(1);
  }

  console.log("");
  console.log("  ✓ Hook files written");
  console.log("  ✓ Sending test notification...");
  try {
    await sendTestHook(data.hook_url);
    console.log("  📱 Check your phone — you should see it now.");
  } catch (e) {
    console.error("  ⚠ Test notification failed:", (e && e.message) || e);
    console.log("  Hooks are installed; fix network or instance filters and try again from your IDE.");
  }
  console.log("");
  console.log("  Restart your IDE if it does not pick up hooks immediately.");
  console.log("");
}

runSetup().catch((e) => {
  console.error(e);
  process.exit(1);
});
