/*
 * Content script — runs on every page. Its only job is to look at the current
 * document and, when asked by the popup, report back the product it can see
 * (name, price, currency, image). All the parsing lives in the shared
 * PriceExtractor library loaded just before this file.
 */
(function () {
  "use strict";

  const api = typeof browser !== "undefined" ? browser : chrome;

  function detect() {
    try {
      return window.PriceExtractor.extractFromDocument(document, location.href);
    } catch (err) {
      console.warn("[Price Tracker] detection failed:", err);
      return null;
    }
  }

  api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message && message.type === "DETECT_PRODUCT") {
      sendResponse({ product: detect() });
    }
    // Returning true keeps the message channel open for async responders;
    // our response is synchronous so we simply return undefined.
  });
})();
