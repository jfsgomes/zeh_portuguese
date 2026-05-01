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
  token?: string;
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
  feedToken?: string;
  getInquiryFeed?: () => Promise<InquiryFeedItem[]>;
  logger?: boolean;
  port?: number;
  publicBaseUrl?: string;
};

export function createServer(options: CreateServerOptions = {}): FastifyInstance {
  let feedCache: FeedCache | undefined;
  const cacheTtlMs = options.cacheTtlMs ?? CACHE_TTL_MS;
  const getInquiryFeed = options.getInquiryFeed ?? scrapeInquiryFeed;
  const feedToken = options.feedToken ?? process.env.FEED_TOKEN;
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

  server.get("/", async (_request, reply) => {
    return reply.type("text/html").send(buildHomePage());
  });

  server.get<{ Querystring: FeedQuery }>("/feed.json", async (request, reply) => {
    if (!hasFeedAccess(feedToken, request.query.token)) {
      return reply.code(402).send(buildPaymentRequiredResponse());
    }

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

  server.get<{ Querystring: FeedQuery }>("/rss.xml", async (request, reply) => {
    if (!hasFeedAccess(feedToken, request.query.token)) {
      return reply.code(402).send(buildPaymentRequiredResponse());
    }

    const { items } = await getCachedInquiryFeed();
    const feed = buildRssFeed(items, getFeedUrl(publicBaseUrl, port));

    return reply.type("application/rss+xml").send(feed.xml(true));
  });

  return server;
}

if (isMainModule()) {
  await import("dotenv/config");

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

function buildPaymentRequiredResponse(): {
  error: "payment_required";
  message: "Use Virtuals ACP to purchase access to this feed.";
} {
  return {
    error: "payment_required",
    message: "Use Virtuals ACP to purchase access to this feed.",
  };
}

function hasFeedAccess(
  configuredToken: string | undefined,
  providedToken: string | undefined,
): boolean {
  return !configuredToken || providedToken === configuredToken;
}

function buildHomePage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="talentapp:project_verification" content="ea221be523a9b559597576e31b176cb1a6e834c604f4aa618d7b03dc528fa648fa2e627f4a0732f7ff638a6604e11b0c82129af10b63b63215b99507d49ad220">
    <title>Portuguese Parliamentary Inquiry Feed</title>
  </head>
  <body style="margin:0;background:#f7f7f3;color:#171717;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace;line-height:1.55;">
    <main style="max-width:760px;margin:0 auto;padding:56px 24px;">
      <p style="margin:0 0 12px;color:#5c5c55;">for autonomous agents</p>
      <h1 style="margin:0 0 20px;font-size:clamp(32px,6vw,56px);line-height:1.02;font-weight:700;">Portuguese Parliamentary Inquiry Feed</h1>
      <p style="margin:0 0 28px;font-size:18px;max-width:650px;">Structured public activity from Portuguese parliamentary inquiry commissions, sourced from Assembleia da República and formatted for agent consumption after payment through Virtuals ACP.</p>

      <section style="border-top:1px solid #d8d8ce;border-bottom:1px solid #d8d8ce;padding:22px 0;margin:30px 0;">
        <h2 style="margin:0 0 14px;font-size:18px;">Endpoints</h2>
        <ul style="list-style:none;margin:0;padding:0;display:grid;gap:10px;">
          <li><a style="color:#0f5132;text-decoration:none;border-bottom:1px solid #0f5132;" href="/preview.json">/preview.json</a> <span style="color:#5c5c55;">public preview</span></li>
          <li><a style="color:#0f5132;text-decoration:none;border-bottom:1px solid #0f5132;" href="/feed.json">/feed.json</a> <span style="color:#5c5c55;">full JSON feed</span></li>
          <li><a style="color:#0f5132;text-decoration:none;border-bottom:1px solid #0f5132;" href="/rss.xml">/rss.xml</a> <span style="color:#5c5c55;">RSS feed</span></li>
        </ul>
      </section>

      <section style="border-bottom:1px solid #d8d8ce;padding:0 0 24px;margin:0 0 24px;">
        <h2 style="margin:0 0 14px;font-size:18px;">Virtuals ACP</h2>
        <p style="margin:0 0 12px;">On-chain job completed for agent consumption of this feed.</p>
        <dl style="display:grid;grid-template-columns:max-content 1fr;gap:8px 16px;margin:0;font-size:14px;">
          <dt style="color:#5c5c55;">Chain</dt><dd style="margin:0;"><a style="color:#0f5132;text-decoration:none;border-bottom:1px solid #0f5132;" href="https://basescan.org/" rel="noopener noreferrer">Base</a> <span style="color:#5c5c55;">8453</span></dd>
          <dt style="color:#5c5c55;">Job</dt><dd style="margin:0;">4258 <span style="color:#5c5c55;">completed</span></dd>
          <dt style="color:#5c5c55;">Provider</dt><dd style="margin:0;overflow-wrap:anywhere;"><a style="color:#0f5132;text-decoration:none;border-bottom:1px solid #0f5132;" href="https://app.virtuals.io/acp/agents/0x79b51C3fbe75c1489409DA64Abd399fbB000c331" rel="noopener noreferrer">Virtuals</a> · <a style="color:#0f5132;text-decoration:none;border-bottom:1px solid #0f5132;" href="https://basescan.org/address/0x79b51C3fbe75c1489409DA64Abd399fbB000c331" rel="noopener noreferrer">0x79b51C3fbe75c1489409DA64Abd399fbB000c331</a></dd>
          <dt style="color:#5c5c55;">Evaluator</dt><dd style="margin:0;overflow-wrap:anywhere;"><a style="color:#0f5132;text-decoration:none;border-bottom:1px solid #0f5132;" href="https://app.virtuals.io/acp/agents/0x0F433D7cB01228D769Acc8a2c1064866F020c11e" rel="noopener noreferrer">Virtuals</a> · <a style="color:#0f5132;text-decoration:none;border-bottom:1px solid #0f5132;" href="https://basescan.org/address/0x0F433D7cB01228D769Acc8a2c1064866F020c11e" rel="noopener noreferrer">0x0F433D7cB01228D769Acc8a2c1064866F020c11e</a></dd>
          <dt style="color:#5c5c55;">Deliverable</dt><dd style="margin:0;overflow-wrap:anywhere;"><a style="color:#0f5132;text-decoration:none;border-bottom:1px solid #0f5132;" href="https://basescan.org/search?f=0&amp;q=0x8bef4c8f3bddbc5ad7a02f560be2de9e4d6f7537b459779cf5409f066e30d304" rel="noopener noreferrer">0x8bef4c8f3bddbc5ad7a02f560be2de9e4d6f7537b459779cf5409f066e30d304</a></dd>
          <dt style="color:#5c5c55;">Result</dt><dd style="margin:0;">Feed URLs received and verified.</dd>
        </dl>
      </section>

      <p style="margin:0;color:#5c5c55;">Source: Assembleia da República</p>
    </main>
  </body>
</html>`;
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
