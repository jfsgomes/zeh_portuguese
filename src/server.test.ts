import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "./server.js";
import type { InquiryFeedItem } from "./scraper.js";

const sampleItems: InquiryFeedItem[] = [
  makeItem("1", "CPINIR", "Latest CPINIR hearing", "2026-04-29"),
  makeItem("2", "CPINIR", "Second CPINIR hearing", "2026-04-28"),
  makeItem("3", "CPIINEM", "Latest CPIINEM hearing", "2026-04-23", [
    "Carla Rocha",
  ]),
  makeItem("4", "CPIINEM", "Older CPIINEM document", undefined),
];

test("GET /health returns ok", async () => {
  const server = createServer({
    getInquiryFeed: async () => sampleItems,
    logger: false,
  });

  const response = await server.inject("/health");

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { ok: true });

  await server.close();
});

test("GET / returns the agent-facing HTML landing page", async () => {
  const server = createServer({
    getInquiryFeed: async () => sampleItems,
    logger: false,
  });

  const response = await server.inject("/");

  assert.equal(response.statusCode, 200);
  assert.match(response.headers["content-type"] as string, /text\/html/u);
  assert.match(response.body, /Portuguese Parliamentary Inquiry Feed/u);
  assert.match(response.body, /\/preview\.json/u);
  assert.match(response.body, /\/feed\.json/u);
  assert.match(response.body, /\/rss\.xml/u);
  assert.match(response.body, /Assembleia da República/u);
  assert.match(response.body, /Virtuals ACP/u);

  await server.close();
});

test("GET /feed.json returns metadata, filters by commission, and applies limit", async () => {
  const server = createServer({
    getInquiryFeed: async () => sampleItems,
    logger: false,
  });

  const response = await server.inject("/feed.json?limit=1&commission=CPIINEM");
  const body = response.json();

  assert.equal(response.statusCode, 200);
  assert.equal(body.title, "Portuguese Parliamentary Inquiry Feed");
  assert.equal(body.source, "Assembleia da República");
  assert.equal(body.count, 1);
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].commissionId, "CPIINEM");
  assert.match(body.updatedAt, /^\d{4}-\d{2}-\d{2}T/u);

  await server.close();
});

test("GET /feed.json caps oversized limits", async () => {
  const manyItems = Array.from({ length: 150 }, (_, index) =>
    makeItem(String(index), "CPINIR", `Item ${index}`, "2026-04-29"),
  );
  const server = createServer({
    getInquiryFeed: async () => manyItems,
    logger: false,
  });

  const response = await server.inject("/feed.json?limit=999");
  const body = response.json();

  assert.equal(response.statusCode, 200);
  assert.equal(body.count, 100);
  assert.equal(body.items.length, 100);

  await server.close();
});

test("GET /feed.json is public when FEED_TOKEN is not configured", async () => {
  const server = createServer({
    getInquiryFeed: async () => sampleItems,
    logger: false,
  });

  const response = await server.inject("/feed.json?limit=1");
  const body = response.json();

  assert.equal(response.statusCode, 200);
  assert.equal(body.count, 1);

  await server.close();
});

test("GET /feed.json requires token when FEED_TOKEN is configured", async () => {
  let calls = 0;
  const server = createServer({
    feedToken: "paid-token",
    getInquiryFeed: async () => {
      calls += 1;
      return sampleItems;
    },
    logger: false,
  });

  const missingTokenResponse = await server.inject("/feed.json");
  const badTokenResponse = await server.inject("/feed.json?token=wrong");
  const goodTokenResponse = await server.inject("/feed.json?token=paid-token");

  assert.equal(missingTokenResponse.statusCode, 402);
  assert.deepEqual(missingTokenResponse.json(), {
    error: "payment_required",
    message: "Use Virtuals ACP to purchase access to this feed.",
  });
  assert.equal(badTokenResponse.statusCode, 402);
  assert.equal(goodTokenResponse.statusCode, 200);
  assert.equal(goodTokenResponse.json().count, sampleItems.length);
  assert.equal(calls, 1);

  await server.close();
});

test("GET /preview.json returns the latest three items", async () => {
  const server = createServer({
    getInquiryFeed: async () => sampleItems,
    logger: false,
  });

  const response = await server.inject("/preview.json");
  const body = response.json();

  assert.equal(response.statusCode, 200);
  assert.equal(body.count, 3);
  assert.deepEqual(
    body.items.map((item: InquiryFeedItem) => item.id),
    ["1", "2", "3"],
  );

  await server.close();
});

test("GET /preview.json remains public when FEED_TOKEN is configured", async () => {
  const server = createServer({
    feedToken: "paid-token",
    getInquiryFeed: async () => sampleItems,
    logger: false,
  });

  const response = await server.inject("/preview.json");

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().count, 3);

  await server.close();
});

test("feed responses use fresh cache within the cache TTL", async () => {
  let calls = 0;
  const server = createServer({
    getInquiryFeed: async () => {
      calls += 1;
      return sampleItems;
    },
    logger: false,
  });

  await server.inject("/feed.json");
  await server.inject("/preview.json");

  assert.equal(calls, 1);

  await server.close();
});

test("GET /feed.json returns stale cache when refresh fails after cache expiry", async () => {
  let calls = 0;
  const server = createServer({
    cacheTtlMs: 0,
    getInquiryFeed: async () => {
      calls += 1;

      if (calls === 1) {
        return sampleItems;
      }

      throw new Error("scraper failed");
    },
    logger: false,
  });

  await server.inject("/feed.json");
  const response = await server.inject("/feed.json");
  const body = response.json();

  assert.equal(response.statusCode, 200);
  assert.equal(body.stale, true);
  assert.equal(body.count, sampleItems.length);

  await server.close();
});

test("GET /rss.xml returns RSS with canonical self-link and item metadata", async () => {
  const server = createServer({
    getInquiryFeed: async () => sampleItems,
    logger: false,
    publicBaseUrl: "https://feeds.example.test",
  });

  const response = await server.inject({
    headers: {
      host: "attacker.example",
      "x-forwarded-proto": "https",
    },
    method: "GET",
    url: "/rss.xml",
  });

  assert.equal(response.statusCode, 200);
  assert.match(response.headers["content-type"] as string, /application\/rss\+xml/u);
  assert.match(
    response.body,
    /<title><!\[CDATA\[Comissões de Inquérito - Assembleia da República\]\]><\/title>/u,
  );
  assert.match(
    response.body,
    /<atom:link href="https:\/\/feeds\.example\.test\/rss\.xml" rel="self" type="application\/rss\+xml"\/>/u,
  );
  assert.doesNotMatch(response.body, /attacker\.example/u);
  assert.match(response.body, /<guid isPermaLink="false">1<\/guid>/u);
  assert.match(response.body, /Commission: Comissao CPINIR/u);
  assert.match(response.body, /Category: audicao/u);
  assert.match(response.body, /Entities: Carla Rocha/u);

  await server.close();
});

test("GET /rss.xml requires token when FEED_TOKEN is configured", async () => {
  const server = createServer({
    feedToken: "paid-token",
    getInquiryFeed: async () => sampleItems,
    logger: false,
    publicBaseUrl: "https://feeds.example.test",
  });

  const missingTokenResponse = await server.inject("/rss.xml");
  const goodTokenResponse = await server.inject("/rss.xml?token=paid-token");

  assert.equal(missingTokenResponse.statusCode, 402);
  assert.deepEqual(missingTokenResponse.json(), {
    error: "payment_required",
    message: "Use Virtuals ACP to purchase access to this feed.",
  });
  assert.equal(goodTokenResponse.statusCode, 200);
  assert.match(goodTokenResponse.body, /<rss/u);

  await server.close();
});

function makeItem(
  id: string,
  commissionId: string,
  title: string,
  date?: string,
  entities?: string[],
): InquiryFeedItem {
  return {
    id,
    commissionId,
    commissionName: `Comissao ${commissionId}`,
    category: id === "4" ? "documento" : "audicao",
    title,
    ...(date ? { date } : {}),
    ...(entities ? { entities } : {}),
    sourceUrl: `https://www.parlamento.pt/${commissionId}`,
    detailUrl: `https://www.parlamento.pt/detail/${id}`,
    scrapedAt: "2026-05-01T10:00:00.000Z",
  };
}
