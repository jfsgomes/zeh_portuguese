import * as cheerio from "cheerio";
import { createHash } from "node:crypto";
import type { AnyNode } from "domhandler";

export type InquiryFeedItem = {
  id: string;
  commissionId: string;
  commissionName: string;
  category:
    | "agenda"
    | "audicao"
    | "audiencia"
    | "iniciativa"
    | "peticao"
    | "documento"
    | "unknown";
  title: string;
  date?: string;
  time?: string;
  entities?: string[];
  sourceUrl: string;
  detailUrl?: string;
  scrapedAt: string;
};

type InquirySource = {
  commissionId: string;
  commissionName: string;
  url: string;
};

const FALLBACK_SOURCES: InquirySource[] = [
  {
    commissionId: "CPIINEM",
    commissionName:
      "Comissao Parlamentar de Inquerito ao Atendimento de Emergencia Medica pelo INEM",
    url: "https://www.parlamento.pt/sites/com/XVIILeg/CPIINEM/Paginas/default.aspx",
  },
  {
    commissionId: "CPINIR",
    commissionName:
      "Comissao Parlamentar de Inquerito Nacional aos Incendios Rurais",
    url: "https://www.parlamento.pt/sites/com/XVIILeg/CPINIR/Paginas/default.aspx",
  },
];

const LINK_KEYWORDS = [
  "agenda",
  "audição",
  "audicao",
  "audiência",
  "audiencia",
  "reunião",
  "reuniao",
  "iniciativa",
  "petição",
  "peticao",
  "relatório",
  "relatorio",
  "documento",
];

const DATE_PATTERNS = [
  /\b(?<day>\d{1,2})\/(?<month>\d{1,2})\/(?<year>\d{4})\b/u,
  /\b(?<year>\d{4})-(?<month>\d{1,2})-(?<day>\d{1,2})\b/u,
  /\b(?<day>\d{1,2})-(?<month>\d{1,2})-(?<year>\d{4})\b/u,
];

const TIME_PATTERN = /\b(?<hour>[01]?\d|2[0-3])[:h](?<minute>[0-5]\d)\b/iu;

export async function getInquiryFeed(): Promise<InquiryFeedItem[]> {
  const scrapedAt = new Date().toISOString();
  const results = await Promise.allSettled(
    FALLBACK_SOURCES.map((source) => scrapeCommission(source, scrapedAt)),
  );

  const items = results.flatMap((result) => {
    if (result.status === "fulfilled") {
      return result.value;
    }

    console.error("Failed to scrape inquiry commission:", result.reason);
    return [];
  });

  return sortNewestFirst(dedupeById(items));
}

async function scrapeCommission(
  source: InquirySource,
  scrapedAt: string,
): Promise<InquiryFeedItem[]> {
  const response = await fetch(source.url, {
    headers: {
      "user-agent": "zeh_portuguese/1.0 (+https://github.com/jfsgomes/zeh_portuguese)",
    },
  });

  if (!response.ok) {
    throw new Error(
      `${source.commissionId} returned ${response.status} ${response.statusText}`,
    );
  }

  const html = await response.text();
  const $ = cheerio.load(html);
  const items: InquiryFeedItem[] = [];

  $("a").each((_, element) => {
    const link = $(element);
    const title = normalizeText(link.text());

    if (!title || !containsUsefulKeyword(title)) {
      return;
    }

    const nearbyText = getNearbyText($, link);
    const detailUrl = normalizeUrl(link.attr("href"), source.url);

    if (!detailUrl || isLikelyNavigationLink(title, detailUrl, source)) {
      return;
    }

    const category = inferCategory(title, nearbyText);
    const date = extractDate(nearbyText) ?? extractDate(title);
    const time = extractTime(nearbyText) ?? extractTime(title);
    const entities = extractEntities(nearbyText);
    const id = createStableId({
      commissionId: source.commissionId,
      title,
      ...(date ? { date } : {}),
      ...(detailUrl ? { detailUrl } : {}),
    });

    items.push({
      id,
      commissionId: source.commissionId,
      commissionName: source.commissionName,
      category,
      title,
      ...(date ? { date } : {}),
      ...(time ? { time } : {}),
      ...(entities.length > 0 ? { entities } : {}),
      sourceUrl: source.url,
      ...(detailUrl ? { detailUrl } : {}),
      scrapedAt,
    });
  });

  return items;
}

function containsUsefulKeyword(text: string): boolean {
  const normalized = normalizeForMatch(text);
  return LINK_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

function inferCategory(
  title: string,
  nearbyText = "",
): InquiryFeedItem["category"] {
  const titleCategory = inferCategoryFromText(title);

  if (titleCategory !== "unknown") {
    return titleCategory;
  }

  return inferCategoryFromText(nearbyText);
}

function inferCategoryFromText(text: string): InquiryFeedItem["category"] {
  const normalized = normalizeForMatch(text);

  if (normalized.includes("agenda") || normalized.includes("reuniao")) {
    return "agenda";
  }

  if (normalized.includes("audicao")) {
    return "audicao";
  }

  if (normalized.includes("audiencia")) {
    return "audiencia";
  }

  if (normalized.includes("iniciativa")) {
    return "iniciativa";
  }

  if (normalized.includes("peticao")) {
    return "peticao";
  }

  if (
    normalized.includes("relatorio") ||
    normalized.includes("documento") ||
    normalized.includes("documentacao")
  ) {
    return "documento";
  }

  return "unknown";
}

function getNearbyText(
  $: cheerio.CheerioAPI,
  link: cheerio.Cheerio<AnyNode>,
): string {
  const rowContainer = link.closest("div.row");
  const semanticContainer = link.closest("tr, li, article, section");
  const container =
    rowContainer.length > 0
      ? rowContainer
      : semanticContainer.length > 0
        ? semanticContainer
        : link.parent();
  const parts = [link.text(), container.text()];

  return normalizeText(parts.join(" "));
}

function extractDate(text: string): string | undefined {
  for (const pattern of DATE_PATTERNS) {
    const match = pattern.exec(text);
    const groups = match?.groups;

    if (!groups) {
      continue;
    }

    const year = groups.year;
    const month = groups.month?.padStart(2, "0");
    const day = groups.day?.padStart(2, "0");

    if (year && month && day) {
      return `${year}-${month}-${day}`;
    }
  }

  return undefined;
}

function extractTime(text: string): string | undefined {
  const match = TIME_PATTERN.exec(text);
  const groups = match?.groups;

  if (!groups?.hour || !groups.minute) {
    return undefined;
  }

  return `${groups.hour.padStart(2, "0")}:${groups.minute}`;
}

function extractEntities(text: string): string[] {
  const candidates = text.match(/\b[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][\wÁÀÂÃÉÊÍÓÔÕÚÇáàâãéêíóôõúç.-]+(?:\s+[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][\wÁÀÂÃÉÊÍÓÔÕÚÇáàâãéêíóôõúç.-]+){1,5}/gu);

  if (!candidates) {
    return [];
  }

  const ignored = new Set([
    "Assembleia Republica",
    "Comissao Parlamentar",
    "Paginas Default",
  ]);

  return [...new Set(candidates.map(normalizeText))]
    .filter((entity) => entity.length > 4 && !ignored.has(stripAccents(entity)))
    .slice(0, 10);
}

function normalizeUrl(href: string | undefined, sourceUrl: string): string | undefined {
  if (!href) {
    return undefined;
  }

  try {
    return new URL(href, sourceUrl).toString();
  } catch {
    return undefined;
  }
}

function isLikelyNavigationLink(
  title: string,
  detailUrl: string,
  source: InquirySource,
): boolean {
  const normalizedTitle = normalizeForMatch(title);

  if (["agendas", "audiencias", "iniciativas"].includes(normalizedTitle)) {
    return true;
  }

  const url = new URL(detailUrl);
  const sourceUrl = new URL(source.url);

  if (url.hostname !== sourceUrl.hostname) {
    return true;
  }

  const isCommissionPage = url.pathname
    .toLowerCase()
    .includes(source.commissionId.toLowerCase());
  const isDetailPage = /Detalhe|Audicao|Audiencia|Iniciativa|Peticao|Documento|Relatorio/u.test(
    url.pathname,
  );
  return !isCommissionPage && !isDetailPage;
}

function createStableId(input: {
  commissionId: string;
  title: string;
  date?: string;
  detailUrl?: string;
}): string {
  const value = [
    input.commissionId,
    input.title,
    input.date ?? "",
    input.detailUrl ?? "",
  ].join("|");

  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function dedupeById(items: InquiryFeedItem[]): InquiryFeedItem[] {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

function sortNewestFirst(items: InquiryFeedItem[]): InquiryFeedItem[] {
  return [...items].sort((a, b) => {
    if (a.date && b.date) {
      return b.date.localeCompare(a.date);
    }

    if (a.date) {
      return -1;
    }

    if (b.date) {
      return 1;
    }

    return a.title.localeCompare(b.title, "pt");
  });
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function normalizeForMatch(text: string): string {
  return stripAccents(text).toLowerCase();
}

function stripAccents(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}
