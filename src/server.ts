import Fastify from "fastify";
import { getInquiryFeed, type InquiryFeedItem } from "./scraper.js";

const CACHE_TTL_MS = 5 * 60 * 1000;

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
  const limit = parseLimit(request.query.limit, 20);
  const commission = request.query.commission;
  const { items, updatedAt, stale } = await getCachedInquiryFeed();
  const filteredItems = filterFeedItems(items, commission).slice(0, limit);

  return buildFeedResponse(filteredItems, updatedAt, stale);
});

server.get("/preview.json", async () => {
  const { items, updatedAt, stale } = await getCachedInquiryFeed();

  return buildFeedResponse(items.slice(0, 3), updatedAt, stale);
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

  return Math.floor(parsed);
}
