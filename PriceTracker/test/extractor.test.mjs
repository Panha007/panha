/*
 * Tests for the shared price extractor's text path — the logic the background
 * worker relies on to re-check prices. Run with: node test/extractor.test.mjs
 *
 * The extractor is a plain script that attaches PriceExtractor to globalThis,
 * so we load it by evaluating the file, then assert against the fixtures.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";
import {
  JSONLD_PRODUCT,
  OG_META_PRODUCT,
  ITEMPROP_PRODUCT,
  EUROPEAN_FORMAT,
  NO_PRICE
} from "./fixtures.js";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "Extension", "Resources", "lib", "extractor.js"), "utf8");
// eslint-disable-next-line no-eval
(0, eval)(src); // defines globalThis.PriceExtractor
const { extractFromHtml, parseAmount, detectCurrency } = globalThis.PriceExtractor;

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log("  ✓", name);
  } catch (err) {
    console.error("  ✗", name);
    console.error("    ", err.message);
    process.exitCode = 1;
  }
}

console.log("parseAmount");
test("US thousands + decimal", () => assert.equal(parseAmount("$1,299.00"), 1299));
test("European format", () => assert.equal(parseAmount("1.299,00"), 1299));
test("decimal comma", () => assert.equal(parseAmount("49,99"), 49.99));
test("currency code prefix", () => assert.equal(parseAmount("USD 49.99"), 49.99));
test("plain integer", () => assert.equal(parseAmount("500"), 500));
test("garbage -> null", () => assert.equal(parseAmount("free"), null));

console.log("detectCurrency");
test("symbol $", () => assert.equal(detectCurrency("$19.99"), "USD"));
test("symbol €", () => assert.equal(detectCurrency("19,99 €"), "EUR"));
test("iso code", () => assert.equal(detectCurrency("AUD 10.00"), "AUD"));

console.log("extractFromHtml");
test("JSON-LD product", () => {
  const p = extractFromHtml(JSONLD_PRODUCT, "https://example.com/p");
  assert.ok(p, "should detect");
  assert.equal(p.amount, 129.99);
  assert.equal(p.currency, "USD");
  assert.equal(p.name, "Acme Wireless Headphones");
  assert.equal(p.image, "https://example.com/headphones.jpg");
});
test("Open Graph meta product", () => {
  const p = extractFromHtml(OG_META_PRODUCT, "https://example.com/g");
  assert.ok(p);
  assert.equal(p.amount, 89);
  assert.equal(p.currency, "AUD");
});
test("itemprop product", () => {
  const p = extractFromHtml(ITEMPROP_PRODUCT, "https://example.com/h");
  assert.ok(p);
  assert.equal(p.amount, 24.5);
  assert.equal(p.currency, "GBP");
});
test("European-formatted JSON-LD price", () => {
  const p = extractFromHtml(EUROPEAN_FORMAT, "https://example.com/e");
  assert.ok(p);
  assert.equal(p.amount, 1299);
  assert.equal(p.currency, "EUR");
});
test("page with no product -> null", () => {
  assert.equal(extractFromHtml(NO_PRICE, "https://example.com/about"), null);
});

console.log(`\n${passed} checks passed`);
