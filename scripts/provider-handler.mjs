import { existsSync, readFileSync, writeFileSync } from "fs";
import { spawnSync } from "child_process";

const EVENTS_FILE = process.env.ACP_PROVIDER_EVENTS_FILE || "provider-events.jsonl";
const CHAIN_ID = process.env.CHAIN_ID || "8453";
const BUDGET_AMOUNT = process.env.BUDGET_AMOUNT || "0.01";
const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL || "https://0191-185-92-210-221.ngrok-free.app";
const FEED_TOKEN = process.env.FEED_TOKEN || "";
const PROCESSED_FILE = ".provider-handler-processed.json";
const POLL_MS = 4000;

const processed = new Set(loadProcessed(PROCESSED_FILE));
const latestRequirementsByJob = new Map();
let handling = false;

console.log("[provider] handler started");
console.log(`[provider] event file: ${EVENTS_FILE}`);
console.log(`[provider] chain id: ${CHAIN_ID}`);
console.log(`[provider] budget amount: ${BUDGET_AMOUNT}`);
console.log(`[provider] public base url: ${PUBLIC_BASE_URL}`);
console.log(`[provider] feed token configured: ${FEED_TOKEN ? "yes" : "no"}`);

handleEvents();
setInterval(handleEvents, POLL_MS);

function handleEvents() {
  if (handling) {
    return;
  }

  handling = true;

  try {
    const drain = runCommand("acp", [
      "events",
      "drain",
      "--file",
      EVENTS_FILE,
      "--json",
    ]);

    if (!drain.ok) {
      return;
    }

    const events = parseJsonLines(drain.stdout);

    for (const event of events) {
      const jobId = String(event.jobId || event.entry?.onChainJobId || "");

      if (!jobId) {
        continue;
      }

      if (isRequirementMessage(event.entry)) {
        latestRequirementsByJob.set(jobId, parseRequirements(event.entry.content));
      }

      const availableTools = Array.isArray(event.availableTools)
        ? event.availableTools
        : [];

      if (availableTools.includes("setBudget")) {
        setBudget(jobId);
      }

      if (availableTools.includes("submit")) {
        submit(jobId);
      }
    }
  } catch (error) {
    console.error("[provider] handler error:", error);
  } finally {
    handling = false;
  }
}

function setBudget(jobId) {
  const actionKey = `${jobId}:setBudget`;

  if (processed.has(actionKey)) {
    return;
  }

  const result = runCommand("acp", [
    "provider",
    "set-budget",
    "--job-id",
    jobId,
    "--amount",
    BUDGET_AMOUNT,
    "--chain-id",
    CHAIN_ID,
  ]);

  if (result.ok) {
    markProcessed(actionKey);
  }
}

function submit(jobId) {
  const actionKey = `${jobId}:submit`;

  if (processed.has(actionKey)) {
    return;
  }

  const requirements = latestRequirementsByJob.get(jobId) || {};
  const deliverable = buildDeliverable(requirements);
  const result = runCommand("acp", [
    "provider",
    "submit",
    "--job-id",
    jobId,
    "--deliverable",
    JSON.stringify(deliverable),
    "--chain-id",
    CHAIN_ID,
  ]);

  if (result.ok) {
    markProcessed(actionKey);
  }
}

function buildDeliverable(requirements) {
  const format = requirements.format === "rss" ? "rss" : "json";
  const limit = normalizeLimit(requirements.limit);
  const commission =
    typeof requirements.commission === "string" && requirements.commission.trim()
      ? requirements.commission.trim()
      : undefined;
  const json = buildFeedUrl("/feed.json", { limit, commission });
  const rss = buildFeedUrl("/rss.xml", { limit, commission });

  return {
    product: "PT Inquiry Feed",
    format,
    url: format === "rss" ? rss : json,
    json,
    rss,
    source: "Parlamento.pt",
    note: "Agent-friendly feed for Portuguese Comissão de Inquérito updates.",
    generatedAt: new Date().toISOString(),
  };
}

function buildFeedUrl(pathname, params) {
  const url = new URL(pathname, PUBLIC_BASE_URL);
  url.searchParams.set("limit", String(params.limit));

  if (params.commission) {
    url.searchParams.set("commission", params.commission);
  }

  if (FEED_TOKEN) {
    url.searchParams.set("token", FEED_TOKEN);
  }

  return url.toString();
}

function parseRequirements(content) {
  if (typeof content !== "string") {
    return {};
  }

  try {
    const parsed = JSON.parse(content);

    if (typeof parsed === "string") {
      return parseLooseObject(parsed);
    }

    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return parseLooseObject(content);
  }
}

function parseLooseObject(value) {
  try {
    const normalized = value
      .trim()
      .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
      .replace(/'/g, '"');
    const parsed = JSON.parse(normalized);
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeLimit(value) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 1) {
    return 20;
  }

  return Math.floor(parsed);
}

function isRequirementMessage(entry) {
  return (
    entry &&
    entry.kind === "message" &&
    entry.contentType === "requirement" &&
    typeof entry.content === "string"
  );
}

function runCommand(command, args) {
  console.log(`[provider] running: ${formatCommand(command, args)}`);

  const result = spawnSync(command, args, {
    encoding: "utf8",
  });

  if (result.stdout) {
    console.log(`[provider] stdout:\n${result.stdout.trimEnd()}`);
  }

  if (result.stderr) {
    console.error(`[provider] stderr:\n${result.stderr.trimEnd()}`);
  }

  if (result.error) {
    console.error("[provider] command error:", result.error);
  }

  if (result.status !== 0) {
    console.error(`[provider] command exited with status ${result.status}`);
  }

  return {
    ok: result.status === 0,
    stdout: result.stdout || "",
  };
}

function parseJsonLines(text) {
  return text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line);
        return Array.isArray(parsed.events) ? parsed.events : [parsed];
      } catch {
        console.error("[provider] failed to parse event line:", line);
        return [];
      }
    });
}

function loadProcessed(path) {
  if (!existsSync(path)) {
    return [];
  }

  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function markProcessed(actionKey) {
  processed.add(actionKey);
  writeFileSync(PROCESSED_FILE, `${JSON.stringify([...processed], null, 2)}\n`);
}

function formatCommand(command, args) {
  return [command, ...args.map(shellQuote)].join(" ");
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_./:=@+-]+$/u.test(value)) {
    return value;
  }

  return `'${value.replace(/'/g, "'\\''")}'`;
}
