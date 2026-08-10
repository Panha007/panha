/*
 * Price Tracker — shared extraction library.
 *
 * Runs in two very different environments:
 *   1. The content script, where a live `document` (DOM) is available.
 *   2. The background service worker, where only the raw HTML *text* of a
 *      re-fetched page is available (no DOMParser in the worker global scope).
 *
 * So we expose both a DOM-based path and a text/regex-based path, sharing the
 * price-normalisation logic between them. The module attaches itself to
 * `globalThis.PriceExtractor` so it works whether it is loaded as a classic
 * content script or imported for side effect by the module service worker.
 */
(function (root) {
  "use strict";

  // Map of common currency symbols / codes to ISO 4217 codes.
  const CURRENCY_SYMBOLS = {
    "$": "USD",
    "US$": "USD",
    "A$": "AUD",
    "AU$": "AUD",
    "C$": "CAD",
    "CA$": "CAD",
    "NZ$": "NZD",
    "£": "GBP",
    "€": "EUR",
    "¥": "JPY",
    "₹": "INR",
    "₩": "KRW",
    "₽": "RUB",
    "R$": "BRL",
    "₺": "TRY",
    "฿": "THB",
    "₫": "VND",
    "kr": "SEK",
    "CHF": "CHF"
  };

  /**
   * Turn a messy human price string into a numeric amount.
   * Handles "1,299.00", "1.299,00", "$1,299", "USD 49.99", "49,99 €", etc.
   * Returns null when no sensible number can be found.
   */
  function parseAmount(raw) {
    if (raw === null || raw === undefined) return null;
    let s = String(raw).trim();
    if (!s) return null;

    // Strip everything except digits, separators and a leading minus.
    s = s.replace(/[^0-9.,\-]/g, "");
    if (!s) return null;

    const hasComma = s.includes(",");
    const hasDot = s.includes(".");

    if (hasComma && hasDot) {
      // Whichever separator appears last is the decimal separator.
      if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
        // European style: 1.299,00
        s = s.replace(/\./g, "").replace(",", ".");
      } else {
        // US style: 1,299.00
        s = s.replace(/,/g, "");
      }
    } else if (hasComma) {
      // Ambiguous: "1,299" (thousands) vs "49,99" (decimal).
      const parts = s.split(",");
      if (parts.length === 2 && parts[1].length === 2) {
        s = parts[0] + "." + parts[1]; // decimal comma
      } else {
        s = s.replace(/,/g, ""); // thousands separators
      }
    }

    const value = parseFloat(s);
    return Number.isFinite(value) ? value : null;
  }

  /** Guess an ISO currency code from a string that may contain a symbol/code. */
  function detectCurrency(raw) {
    if (!raw) return null;
    const s = String(raw).trim();

    const isoMatch = s.match(/\b([A-Z]{3})\b/);
    if (isoMatch && isoMatch[1] !== "USD") {
      // Accept explicit 3-letter codes (but keep scanning symbols below too).
      if (
        [
          "USD", "EUR", "GBP", "JPY", "AUD", "CAD", "NZD", "CHF", "CNY",
          "INR", "KRW", "BRL", "RUB", "TRY", "THB", "VND", "SEK", "NOK",
          "DKK", "PLN", "MXN", "ZAR", "SGD", "HKD"
        ].includes(isoMatch[1])
      ) {
        return isoMatch[1];
      }
    }
    if (/\bUSD\b/.test(s)) return "USD";

    for (const sym of Object.keys(CURRENCY_SYMBOLS)) {
      if (s.includes(sym)) return CURRENCY_SYMBOLS[sym];
    }
    return null;
  }

  /** Normalise a candidate into a clean {amount, currency} or null. */
  function normalise(amountRaw, currencyRaw) {
    const amount = parseAmount(amountRaw);
    if (amount === null || amount <= 0) return null;
    const currency = detectCurrency(currencyRaw) || detectCurrency(amountRaw) || null;
    return { amount, currency };
  }

  // ---------------------------------------------------------------------------
  // JSON-LD (schema.org Product / Offer) — works from any JSON blob.
  // ---------------------------------------------------------------------------

  function walkForProduct(node, out) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((n) => walkForProduct(n, out));
      return;
    }
    const type = node["@type"];
    const types = Array.isArray(type) ? type : [type];
    if (types.some((t) => typeof t === "string" && /product/i.test(t))) {
      out.push(node);
    }
    // Offers can appear standalone too.
    for (const key of Object.keys(node)) {
      walkForProduct(node[key], out);
    }
  }

  function readOffer(offers) {
    if (!offers) return null;
    const list = Array.isArray(offers) ? offers : [offers];
    for (const offer of list) {
      if (!offer || typeof offer !== "object") continue;
      const price =
        offer.price ??
        offer.lowPrice ??
        (offer.priceSpecification && offer.priceSpecification.price);
      const currency =
        offer.priceCurrency ??
        (offer.priceSpecification && offer.priceSpecification.priceCurrency);
      const n = normalise(price, currency);
      if (n) return n;
    }
    return null;
  }

  function fromJsonLdObjects(objects) {
    const products = [];
    objects.forEach((o) => walkForProduct(o, products));
    for (const p of products) {
      const priced = readOffer(p.offers);
      if (priced) {
        return {
          name: typeof p.name === "string" ? p.name.trim() : null,
          image: pickImage(p.image),
          amount: priced.amount,
          currency: priced.currency
        };
      }
    }
    return null;
  }

  function pickImage(image) {
    if (!image) return null;
    if (typeof image === "string") return image;
    if (Array.isArray(image)) return pickImage(image[0]);
    if (typeof image === "object" && image.url) return image.url;
    return null;
  }

  function safeJsonParse(text) {
    try {
      return JSON.parse(text);
    } catch (_) {
      // Some sites emit invalid JSON-LD with trailing commas / HTML entities.
      try {
        return JSON.parse(text.replace(/,\s*([}\]])/g, "$1"));
      } catch (_e) {
        return null;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // DOM path (content script).
  // ---------------------------------------------------------------------------

  function extractFromDocument(doc, url) {
    const result = { url, name: null, image: null, amount: null, currency: null };

    // 1. JSON-LD structured data — most reliable.
    const ldObjects = [];
    doc.querySelectorAll('script[type="application/ld+json"]').forEach((el) => {
      const parsed = safeJsonParse(el.textContent || "");
      if (parsed) ldObjects.push(parsed);
    });
    const fromLd = fromJsonLdObjects(ldObjects);
    if (fromLd && fromLd.amount) Object.assign(result, fromLd);

    // 2. Open Graph / meta product tags — fill any gaps.
    if (!result.amount) {
      const metaPrice =
        metaContent(doc, "product:price:amount") ||
        metaContent(doc, "og:price:amount") ||
        metaContent(doc, "twitter:data1") ||
        itempropContent(doc, "price");
      const metaCurrency =
        metaContent(doc, "product:price:currency") ||
        metaContent(doc, "og:price:currency") ||
        itempropContent(doc, "priceCurrency");
      const n = normalise(metaPrice, metaCurrency);
      if (n) {
        result.amount = n.amount;
        result.currency = n.currency;
      }
    }

    // 3. Visible-price heuristic — last resort using common selectors.
    if (!result.amount) {
      const n = heuristicPriceFromDom(doc);
      if (n) {
        result.amount = n.amount;
        result.currency = n.currency;
      }
    }

    if (!result.name) {
      result.name =
        metaContent(doc, "og:title") ||
        (doc.querySelector("h1") && doc.querySelector("h1").textContent.trim()) ||
        (doc.title || "").trim() ||
        null;
    }
    if (!result.image) {
      result.image = metaContent(doc, "og:image") || firstProductImage(doc);
    }
    if (result.name) result.name = result.name.replace(/\s+/g, " ").slice(0, 200);

    return result.amount ? result : null;
  }

  function metaContent(doc, key) {
    const el =
      doc.querySelector(`meta[property="${key}"]`) ||
      doc.querySelector(`meta[name="${key}"]`) ||
      doc.querySelector(`meta[itemprop="${key}"]`);
    return el ? el.getAttribute("content") : null;
  }

  function itempropContent(doc, prop) {
    const el = doc.querySelector(`[itemprop="${prop}"]`);
    if (!el) return null;
    return el.getAttribute("content") || el.getAttribute("value") || el.textContent;
  }

  const PRICE_SELECTORS = [
    "[itemprop='price']",
    "[data-price-amount]",
    "[data-product-price]",
    ".price .amount",
    ".product-price",
    ".product__price",
    ".price-item--sale",
    ".price--main",
    ".a-price .a-offscreen", // Amazon
    ".x-price-primary",       // eBay
    "[data-testid='price']",
    ".price",
    ".Price",
    ".sale-price",
    ".current-price"
  ];

  function heuristicPriceFromDom(doc) {
    for (const sel of PRICE_SELECTORS) {
      const els = doc.querySelectorAll(sel);
      for (const el of els) {
        const text =
          el.getAttribute("content") ||
          el.getAttribute("data-price-amount") ||
          el.getAttribute("data-product-price") ||
          el.textContent ||
          "";
        if (/\d/.test(text)) {
          const n = normalise(text, text);
          if (n) return n;
        }
      }
    }
    return null;
  }

  function firstProductImage(doc) {
    const img =
      doc.querySelector("[itemprop='image']") ||
      doc.querySelector("#main-image, .product__media img, .product-image img, img");
    if (!img) return null;
    return img.getAttribute("content") || img.getAttribute("src") || null;
  }

  // ---------------------------------------------------------------------------
  // Text path (background service worker) — regex over the raw HTML string.
  // ---------------------------------------------------------------------------

  function extractFromHtml(html, url) {
    if (!html) return null;
    const result = { url, name: null, image: null, amount: null, currency: null };

    // 1. JSON-LD blocks.
    const ldObjects = [];
    const ldRegex =
      /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = ldRegex.exec(html)) !== null) {
      const parsed = safeJsonParse(decodeEntities(m[1].trim()));
      if (parsed) ldObjects.push(parsed);
    }
    const fromLd = fromJsonLdObjects(ldObjects);
    if (fromLd && fromLd.amount) Object.assign(result, fromLd);

    // 2. Meta tags.
    if (!result.amount) {
      const price =
        metaFromHtml(html, "product:price:amount") ||
        metaFromHtml(html, "og:price:amount");
      const currency =
        metaFromHtml(html, "product:price:currency") ||
        metaFromHtml(html, "og:price:currency");
      const n = normalise(price, currency);
      if (n) {
        result.amount = n.amount;
        result.currency = n.currency;
      }
    }

    // 3. itemprop="price" attribute anywhere in the markup.
    if (!result.amount) {
      const ip = html.match(/itemprop=["']price["'][^>]*content=["']([^"']+)["']/i);
      const ic = html.match(/itemprop=["']priceCurrency["'][^>]*content=["']([^"']+)["']/i);
      const n = normalise(ip && ip[1], ic && ic[1]);
      if (n) {
        result.amount = n.amount;
        result.currency = n.currency;
      }
    }

    if (!result.name) {
      result.name =
        metaFromHtml(html, "og:title") ||
        (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] ||
        null;
      if (result.name) result.name = decodeEntities(result.name).replace(/\s+/g, " ").trim().slice(0, 200);
    }
    if (!result.image) result.image = metaFromHtml(html, "og:image");

    return result.amount ? result : null;
  }

  function metaFromHtml(html, key) {
    // Match both attribute orderings: property before content and vice versa.
    const patterns = [
      new RegExp(
        `<meta[^>]+(?:property|name|itemprop)=["']${escapeRegExp(key)}["'][^>]+content=["']([^"']*)["']`,
        "i"
      ),
      new RegExp(
        `<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name|itemprop)=["']${escapeRegExp(key)}["']`,
        "i"
      )
    ];
    for (const re of patterns) {
      const match = html.match(re);
      if (match) return decodeEntities(match[1]);
    }
    return null;
  }

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function decodeEntities(s) {
    if (!s) return s;
    return s
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)));
  }

  root.PriceExtractor = {
    parseAmount,
    detectCurrency,
    extractFromDocument,
    extractFromHtml
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
