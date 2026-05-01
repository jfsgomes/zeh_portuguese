import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { pathToFileURL } from "node:url";
import RSS from "rss";
import {
  getInquiryFeed as scrapeInquiryFeed,
  type InquiryFeedItem,
} from "./scraper.js";

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

type CreateServerOptions = {
  cacheTtlMs?: number;
  getInquiryFeed?: () => Promise<InquiryFeedItem[]>;
  logger?: boolean;
  port?: number;
  publicBaseUrl?: string;
};

export function createServer(options: CreateServerOptions = {}): FastifyInstance {
  let feedCache: FeedCache | undefined;
  const cacheTtlMs = options.cacheTtlMs ?? CACHE_TTL_MS;
  const getInquiryFeed = options.getInquiryFeed ?? scrapeInquiryFeed;
  const port = options.port ?? Number(process.env.PORT ?? 3000);
  const publicBaseUrl = options.publicBaseUrl ?? process.env.PUBLIC_BASE_URL;
  const server = Fastify({
    logger: options.logger ?? true,
  });

  async function getCachedInquiryFeed(): Promise<{
    items: InquiryFeedItem[];
    updatedAt: string;
    stale?: true;
  }> {
    const now = Date.now();

    if (feedCache && now - feedCache.fetchedAt < cacheTtlMs) {
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

  server.get("/rss.xml", async (_request, reply) => {
    const { items } = await getCachedInquiryFeed();
    const feed = buildRssFeed(items, getFeedUrl(publicBaseUrl, port));

    return reply.type("application/rss+xml").send(feed.xml(true));
  });

  return server;
}

if (isMainModule()) {
  const port = Number(process.env.PORT ?? 3000);
  const server = createServer({ port });

  try {
    await server.listen({ port });
  } catch (error) {
    server.log.error(error);
    process.exit(1);
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

function getFeedUrl(publicBaseUrl: string | undefined, port: number): string {
  return new URL("/rss.xml", getPublicBaseUrl(publicBaseUrl, port)).toString();
}

function getPublicBaseUrl(
  configuredBaseUrl: string | undefined,
  port: number,
): string {
  if (configuredBaseUrl) {
    return configuredBaseUrl;
  }

  return `http://localhost:${port}`;
}

function isMainModule(): boolean {
  return Boolean(
    process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href,
  );
}
