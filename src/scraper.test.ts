import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { getInquiryFeed } from "./scraper.js";

const originalFetch = globalThis.fetch;
const originalConsoleError = console.error;
const cpiinemFixture = readFixture("cpiinem.html");
const cpinirFixture = readFixture("cpinir.html");

afterEach(() => {
  globalThis.fetch = originalFetch;
  console.error = originalConsoleError;
});

test("getInquiryFeed extracts, categorizes, sorts, and deduplicates commission links", async () => {
  globalThis.fetch = async (input) => {
    const url = String(input);
    const html = url.includes("CPIINEM") ? cpiinemFixture : cpinirFixture;

    return new Response(html, {
      headers: { "content-type": "text/html; charset=utf-8" },
      status: 200,
    });
  };

  const items = await getInquiryFeed();
  const first = items[0];
  const second = items[1];
  const third = items[2];

  assert.equal(items.length, 8);
  assert.ok(first);
  assert.ok(second);
  assert.ok(third);
  assert.deepEqual(
    items.slice(0, 5).map((item) => item.date),
    ["2026-04-30", "2026-04-29", "2026-04-29", "2026-04-28", "2026-04-23"],
  );
  assert.equal(first.commissionId, "CPIINEM");
  assert.equal(first.category, "audiencia");
  assert.match(first.title, /Audiência com a Ministra da Saúde/u);
  assert.equal(second.commissionId, "CPINIR");
  assert.equal(second.category, "audicao");
  assert.equal(third.category, "audicao");
  assert.equal(second.detailUrl?.startsWith("https://www.parlamento.pt/"), true);
  assert.equal(second.id.length, 24);
  assert.ok(second.entities?.some((entity) => entity.includes("Marco André")));
  assert.ok(items.some((item) => item.category === "documento"));
  assert.equal(items.some((item) => item.title === "AGENDAS"), false);
  assert.equal(items.some((item) => item.title === "Agenda"), false);
  assert.equal(items.some((item) => item.title === "Ver"), false);
});

test("getInquiryFeed continues when one commission fetch fails", async () => {
  console.error = () => undefined;
  globalThis.fetch = async (input) => {
    const url = String(input);

    if (url.includes("CPIINEM")) {
      throw new Error("network failed");
    }

    return new Response(
      cpinirFixture,
      { status: 200 },
    );
  };

  const items = await getInquiryFeed();
  const first = items[0];

  assert.equal(items.length, 4);
  assert.ok(first);
  assert.equal(first.commissionId, "CPINIR");
  assert.match(first.title, /Marco André Ribeiro Domingues/u);
});

function readFixture(filename: string): string {
  return readFileSync(
    fileURLToPath(new URL(`./fixtures/${filename}`, import.meta.url)),
    "utf8",
  );
}
