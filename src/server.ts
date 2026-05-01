import Fastify from "fastify";
import RSS from "rss";
import { getInquiryFeed, type InquiryFeedItem } from "./scraper.js";

const CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_FEED_LIMIT = 20;
const MAX_FEED_LIMIT = 100;

type FeedQuery = {
  limit?: string | number;
  commission?: string;
};

type FeedResponse = {
  title: "Portuguese Parliamentary Inquiry Feed";
  source: "Assembleia da República";
  updatedAt: string;
  count: number;
  items: InquiryFeedItem[];
  stale?: true;
};

type FeedCache = {
  items: InquiryFeedItem[];
  fetchedAt: number;
  updatedAt: string;
};

let feedCache: FeedCache | undefined;

const server = Fastify({
  logger: true,
});

server.get("/health", async () => {
  return { ok: true };
});

server.get<{ Querystring: FeedQuery }>("/feed.json", async (request) => {
  const limit = parseLimit(request.query.limit, DEFAULT_FEED_LIMIT);
  const commission = request.query.commission;
  const { items, updatedAt, stale } = await getCachedInquiryFeed();
  const filteredItems = filterFeedItems(items, commission).slice(0, limit);

  return buildFeedResponse(filteredItems, updatedAt, stale);
});

server.get("/preview.json", async () => {
  const { items, updatedAt, stale } = await getCachedInquiryFeed();

  return buildFeedResponse(items.slice(0, 3), updatedAt, stale);
});

server.get("/rss.xml", async (request, reply) => {
  const { items } = await getCachedInquiryFeed();
  const feed = buildRssFeed(items, getFeedUrl());

  return reply.type("application/rss+xml").send(feed.xml(true));
});

const port = Number(process.env.PORT ?? 3000);

try {
  await server.listen({ port });
} catch (error) {
  server.log.error(error);
  process.exit(1);
}

async function getCachedInquiryFeed(): Promise<{
  items: InquiryFeedItem[];
  updatedAt: string;
  stale?: true;
}> {
  const now = Date.now();

  if (feedCache && now - feedCache.fetchedAt < CACHE_TTL_MS) {
    return {
      items: feedCache.items,
      updatedAt: feedCache.updatedAt,
    };
  }

  try {
    const items = await getInquiryFeed();
    const updatedAt = new Date().toISOString();

    feedCache = {
      items,
      fetchedAt: now,
      updatedAt,
    };

    return { items, updatedAt };
  } catch (error) {
    if (feedCache) {
      server.log.warn({ error }, "Returning stale inquiry feed cache");

      return {
        items: feedCache.items,
        updatedAt: feedCache.updatedAt,
        stale: true,
      };
    }

    throw error;
  }
}

function buildFeedResponse(
  items: InquiryFeedItem[],
  updatedAt: string,
  stale?: true,
): FeedResponse {
  return {
    title: "Portuguese Parliamentary Inquiry Feed",
    source: "Assembleia da República",
    updatedAt,
    count: items.length,
    items,
    ...(stale ? { stale } : {}),
  };
}

function filterFeedItems(
  items: InquiryFeedItem[],
  commission: string | undefined,
): InquiryFeedItem[] {
  if (!commission) {
    return items;
  }

  const normalizedCommission = commission.trim().toLowerCase();

  return items.filter(
    (item) => item.commissionId.toLowerCase() === normalizedCommission,
  );
}

function parseLimit(value: FeedQuery["limit"], fallback: number): number {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }

  return Math.min(Math.floor(parsed), MAX_FEED_LIMIT);
}

function buildRssFeed(items: InquiryFeedItem[], feedUrl: string): RSS {
  const feed = new RSS({
    title: "Comissões de Inquérito - Assembleia da República",
    description:
      "Latest activity from Portuguese parliamentary inquiry commissions",
    site_url: "https://www.parlamento.pt/",
    feed_url: feedUrl,
    language: "pt-PT",
  });

  for (const item of items) {
    feed.item({
      title: item.title,
      url: item.detailUrl ?? item.sourceUrl,
      description: buildRssDescription(item),
      guid: item.id,
      date: parseItemDate(item),
    });
  }

  return feed;
}

function buildRssDescription(item: InquiryFeedItem): string {
  const parts = [
    `Commission: ${item.commissionName}`,
    `Category: ${item.category}`,
  ];

  if (item.entities && item.entities.length > 0) {
    parts.push(`Entities: ${item.entities.join(", ")}`);
  }

  parts.push(`Source: ${item.sourceUrl}`);

  return parts.join("\n");
}

function parseItemDate(item: InquiryFeedItem): Date {
  if (item.date) {
    const parsedDate = new Date(item.date);

    if (!Number.isNaN(parsedDate.getTime())) {
      return parsedDate;
    }
  }

  return new Date(item.scrapedAt);
}

function getFeedUrl(): string {
  return new URL("/rss.xml", getPublicBaseUrl()).toString();
}

function getPublicBaseUrl(): string {
  const configuredBaseUrl = process.env.PUBLIC_BASE_URL;

  if (configuredBaseUrl) {
    return configuredBaseUrl;
  }

  return `http://localhost:${port}`;
}
