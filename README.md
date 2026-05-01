# zeh_portuguese

Agent-friendly feed for Portuguese Parliamentary inquiry commission updates, built as a TypeScript Fastify app for a Virtuals ACP / Agent Commerce Protocol demo.

The app scrapes public Assembleia da Republica commission pages and exposes the result as JSON and RSS feeds that agents can consume after an ACP job is funded and completed.

## What This Provides

- `GET /` - simple HTML landing page with feed links and ACP demo visibility.
- `GET /health` - health check returning `{ "ok": true }`.
- `GET /preview.json` - public preview with the latest 3 items.
- `GET /feed.json` - full JSON feed, optionally token gated.
- `GET /rss.xml` - RSS feed, optionally token gated.
- `scripts/provider-handler.mjs` - event-driven ACP provider automation.
- `scripts/client-handler.mjs` - event-driven ACP client automation.

## Requirements

- Node.js 20 or newer.
- npm.
- `acp-cli` installed and configured.
- `ngrok` or another public tunnel if you want ACP agents to access a local server.
- Two ACP agents if you want to demo the full flow locally:
  - Provider agent: the seller/provider of the feed.
  - Client agent: the buyer/evaluator of the feed.

This repo intentionally does not commit local ACP config or secrets. Keep files such as `.env`, `config.json`, `provider-events.jsonl`, and `client-events.jsonl` local only.

## Install

```sh
npm install
```

## Run The App

```sh
npm run dev
```

By default the server listens on port `3000`. Override it with:

```sh
PORT=4000 npm run dev
```

Open:

```text
http://localhost:3000/
http://localhost:3000/preview.json
http://localhost:3000/feed.json
http://localhost:3000/rss.xml
```

## Environment Variables

Server:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP server port. |
| `FEED_TOKEN` | unset | Optional token gate for `/feed.json` and `/rss.xml`. |

If `FEED_TOKEN` is set, callers must use:

```text
/feed.json?token=<FEED_TOKEN>
/rss.xml?token=<FEED_TOKEN>
```

`/`, `/health`, and `/preview.json` are always public.

Provider handler:

| Variable | Default | Purpose |
| --- | --- | --- |
| `ACP_PROVIDER_EVENTS_FILE` | `provider-events.jsonl` | Provider event log consumed by `acp events drain`. |
| `CHAIN_ID` | `8453` | Base chain ID. |
| `BUDGET_AMOUNT` | `0.01` | Budget amount sent through ACP. |
| `PUBLIC_BASE_URL` | `https://0191-185-92-210-221.ngrok-free.app` | Public URL where this app is reachable. |
| `FEED_TOKEN` | unset | Included in delivered feed URLs when set. |

Client handler:

| Variable | Default | Purpose |
| --- | --- | --- |
| `ACP_CLIENT_EVENTS_FILE` | `client-events.jsonl` | Client event log consumed by `acp events drain`. |
| `CHAIN_ID` | `8453` | Base chain ID. |
| `BUDGET_AMOUNT` | `0.01` | Funding amount sent through ACP. |
| `AUTO_COMPLETE` | `true` | Automatically complete jobs when `complete` is available. |

## Feed Query Parameters

`/feed.json` supports:

| Parameter | Description |
| --- | --- |
| `limit` | Optional number of items to return. Defaults to `20`. |
| `commission` | Optional commission id/name filter. |
| `token` | Required only when `FEED_TOKEN` is set. |

`/rss.xml` supports the same access-token behavior and uses feed items as RSS entries.

## Tests

```sh
npm test
```

Optional TypeScript check:

```sh
npx tsc --noEmit
```

## ACP Demo Context

Known demo values:

| Field | Value |
| --- | --- |
| ACP chain ID | `8453` |
| Provider ACP agent | `0x79b51c3fbe75c1489409da64abd399fbb000c331` |
| Offering name | `ptInquiryFeed` |
| Example public base URL | `https://0191-185-92-210-221.ngrok-free.app` |

The installed `acp-cli` used for this demo does not support `acp serve`. This project uses the event-driven CLI workflow:

- `acp events listen` writes event logs.
- `acp events drain` reads and drains those logs.
- Local Node scripts react to available ACP tools such as `setBudget`, `fund`, `submit`, and `complete`.

## Running Provider And Client On One Machine

You can run both sides on one machine, but the ACP active agent matters.

Important:

- Start the provider listener and provider handler only while the active ACP agent is the provider/Portuguese agent.
- Start the client listener and client handler only while the active ACP agent is the client/buyer agent.
- Use separate terminal sessions.
- Switch the ACP active agent carefully before starting each listener/handler.
- Do not run provider commands while the client agent is active, or client commands while the provider agent is active.

The cleanest approach is:

1. Start the app server.
2. Start ngrok and copy the public URL.
3. Switch ACP to the provider agent.
4. Start provider event listening.
5. Start the provider handler.
6. Switch ACP to the client agent.
7. Start client event listening.
8. Start the client handler.
9. Create a job as the client.

### Terminal A: App Server

```sh
npm run dev
```

### Terminal B: Public Tunnel

```sh
ngrok http 3000
```

Set `PUBLIC_BASE_URL` in the provider handler to the HTTPS ngrok URL.

### Terminal C: Provider Event Listener

Before running this terminal, make sure the active ACP agent is the provider agent.

```sh
rm -f provider-events.jsonl
acp events listen --output provider-events.jsonl --json
```

### Terminal D: Provider Handler

Before running this terminal, make sure the active ACP agent is still the provider agent.

```sh
export ACP_PROVIDER_EVENTS_FILE="provider-events.jsonl"
export CHAIN_ID="8453"
export BUDGET_AMOUNT="0.01"
export PUBLIC_BASE_URL="https://0191-185-92-210-221.ngrok-free.app"
export FEED_TOKEN=""
npm run provider:handler
```

The provider handler will:

- Drain provider events.
- Run `acp provider set-budget` when `setBudget` is available.
- Parse the latest requirement message for the job.
- Build JSON and RSS deliverable URLs.
- Run `acp provider submit` when `submit` is available.
- Save completed actions in `.provider-handler-processed.json`.

### Terminal E: Client Event Listener

Before running this terminal, switch the active ACP agent to the client/buyer agent.

```sh
rm -f client-events.jsonl
acp events listen --output client-events.jsonl --json
```

### Terminal F: Client Handler

Before running this terminal, make sure the active ACP agent is still the client/buyer agent.

```sh
export ACP_CLIENT_EVENTS_FILE="client-events.jsonl"
export CHAIN_ID="8453"
export BUDGET_AMOUNT="0.01"
export AUTO_COMPLETE="true"
npm run client:handler
```

The client handler will:

- Drain client events.
- Run `acp client fund` when `fund` is available.
- Run `acp client complete` when `complete` is available and `AUTO_COMPLETE=true`.
- Save completed actions in `.client-handler-processed.json`.

### Terminal G: Create Job As Client

Make sure the active ACP agent is the client/buyer agent.

```sh
acp client create-job \
  --provider 0x79b51c3fbe75c1489409da64abd399fbb000c331 \
  --offering-name "ptInquiryFeed" \
  --requirements "{format:'json'}"
```

Supported requirement fields:

```js
{format:'json'}
{format:'rss'}
{format:'json', limit:10}
{format:'json', limit:10, commission:'CPIINEM'}
```

The provider deliverable has this shape:

```json
{
  "product": "PT Inquiry Feed",
  "format": "json",
  "url": "https://example.ngrok-free.app/feed.json?limit=20",
  "json": "https://example.ngrok-free.app/feed.json?limit=20",
  "rss": "https://example.ngrok-free.app/rss.xml?limit=20",
  "source": "Parlamento.pt",
  "note": "Agent-friendly feed for Portuguese Comissão de Inquérito updates.",
  "generatedAt": "2026-05-01T00:00:00.000Z"
}
```

If `FEED_TOKEN` is set in the provider handler environment, the delivered `json` and `rss` URLs include `token=<FEED_TOKEN>`.

## Security Notes

- Do not commit `.env`, `config.json`, ACP event logs, or handler state files.
- ACP event logs can contain deliverables and token-bearing URLs.
- `.gitignore` excludes `.env*`, `config.json`, `*-events.jsonl`, `.*-handler-processed.json`, `.DS_Store`, and `node_modules/`.
- Public wallet/agent addresses, chain IDs, job IDs, and explorer links are expected to be public for this demo.

## Useful Scripts

```sh
npm run dev
npm run start
npm run test
npm run provider:handler
npm run client:handler
```
