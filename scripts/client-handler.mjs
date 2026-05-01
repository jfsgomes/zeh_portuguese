import { existsSync, readFileSync, writeFileSync } from "fs";
import { spawnSync } from "child_process";

const EVENTS_FILE = process.env.ACP_CLIENT_EVENTS_FILE || "client-events.jsonl";
const CHAIN_ID = process.env.CHAIN_ID || "8453";
const BUDGET_AMOUNT = process.env.BUDGET_AMOUNT || "0.01";
const AUTO_COMPLETE = process.env.AUTO_COMPLETE || "true";
const COMPLETE_REASON = "Feed URLs received and verified.";
const PROCESSED_FILE = ".client-handler-processed.json";
const POLL_MS = 4000;

const processed = new Set(loadProcessed(PROCESSED_FILE));
let handling = false;

console.log("[client] handler started");
console.log(`[client] event file: ${EVENTS_FILE}`);
console.log(`[client] chain id: ${CHAIN_ID}`);
console.log(`[client] budget amount: ${BUDGET_AMOUNT}`);
console.log(`[client] auto complete: ${AUTO_COMPLETE}`);

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

      const availableTools = Array.isArray(event.availableTools)
        ? event.availableTools
        : [];

      if (availableTools.includes("fund")) {
        fund(jobId);
      }

      if (availableTools.includes("complete") && AUTO_COMPLETE === "true") {
        complete(jobId);
      }
    }
  } catch (error) {
    console.error("[client] handler error:", error);
  } finally {
    handling = false;
  }
}

function fund(jobId) {
  const actionKey = `${jobId}:fund`;

  if (processed.has(actionKey)) {
    return;
  }

  const result = runCommand("acp", [
    "client",
    "fund",
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

function complete(jobId) {
  const actionKey = `${jobId}:complete`;

  if (processed.has(actionKey)) {
    return;
  }

  const result = runCommand("acp", [
    "client",
    "complete",
    "--job-id",
    jobId,
    "--reason",
    COMPLETE_REASON,
    "--chain-id",
    CHAIN_ID,
  ]);

  if (result.ok) {
    markProcessed(actionKey);
  }
}

function runCommand(command, args) {
  console.log(`[client] running: ${formatCommand(command, args)}`);

  const result = spawnSync(command, args, {
    encoding: "utf8",
  });

  if (result.stdout) {
    console.log(`[client] stdout:\n${result.stdout.trimEnd()}`);
  }

  if (result.stderr) {
    console.error(`[client] stderr:\n${result.stderr.trimEnd()}`);
  }

  if (result.error) {
    console.error("[client] command error:", result.error);
  }

  if (result.status !== 0) {
    console.error(`[client] command exited with status ${result.status}`);
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
        console.error("[client] failed to parse event line:", line);
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
