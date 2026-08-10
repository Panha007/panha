/*
 * Background service worker.
 *
 * Owns the tracked-product store and the periodic price-check loop:
 *   • Stores tracked products in `storage.local`.
 *   • On an alarm, re-fetches each product page, re-extracts the price with the
 *     shared library, appends to the price history and fires a notification
 *     when the price drops (or falls to/under the user's target).
 *   • Answers messages from the popup and the list page.
 */

import "./lib/extractor.js"; // side-effect: defines globalThis.PriceExtractor

const api = typeof browser !== "undefined" ? browser : chrome;
const Extractor = globalThis.PriceExtractor;

const STORE_KEY = "trackedProducts";
const SETTINGS_KEY = "settings";
const ALARM_NAME = "price-check";

const DEFAULT_SETTINGS = {
  checkIntervalMinutes: 360, // every 6 hours
  notifyOnAnyDrop: true
};

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

async function getProducts() {
  const data = await api.storage.local.get(STORE_KEY);
  return Array.isArray(data[STORE_KEY]) ? data[STORE_KEY] : [];
}

async function saveProducts(products) {
  await api.storage.local.set({ [STORE_KEY]: products });
}

async function getSettings() {
  const data = await api.storage.local.get(SETTINGS_KEY);
  return Object.assign({}, DEFAULT_SETTINGS, data[SETTINGS_KEY] || {});
}

async function saveSettings(patch) {
  const settings = Object.assign(await getSettings(), patch || {});
  await api.storage.local.set({ [SETTINGS_KEY]: settings });
  await rescheduleAlarm(settings.checkIntervalMinutes);
  return settings;
}

function makeId() {
  return "p_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

// ---------------------------------------------------------------------------
// Tracking operations
// ---------------------------------------------------------------------------

async function addProduct(product) {
  const products = await getProducts();

  // De-dupe on URL: if we already track this page, just refresh its price.
  const existing = products.find((p) => p.url === product.url);
  const now = Date.now();
  if (existing) {
    if (product.amount && product.amount !== existing.currentPrice) {
      recordPrice(existing, product.amount, now);
    }
    await saveProducts(products);
    return existing;
  }

  const entry = {
    id: makeId(),
    url: product.url,
    name: product.name || product.url,
    image: product.image || null,
    currency: product.currency || null,
    startPrice: product.amount,
    currentPrice: product.amount,
    lowestPrice: product.amount,
    targetPrice: null,
    addedAt: now,
    lastChecked: now,
    lastError: null,
    history: [{ t: now, price: product.amount }]
  };
  products.push(entry);
  await saveProducts(products);
  await updateBadge();
  return entry;
}

function recordPrice(entry, price, when) {
  entry.currentPrice = price;
  entry.lastChecked = when;
  entry.lastError = null;
  if (entry.lowestPrice == null || price < entry.lowestPrice) entry.lowestPrice = price;

  const last = entry.history[entry.history.length - 1];
  if (!last || last.price !== price) {
    entry.history.push({ t: when, price });
    // Keep history bounded.
    if (entry.history.length > 500) entry.history = entry.history.slice(-500);
  }
}

async function removeProduct(id) {
  const products = (await getProducts()).filter((p) => p.id !== id);
  await saveProducts(products);
  await updateBadge();
}

async function setTarget(id, targetPrice) {
  const products = await getProducts();
  const entry = products.find((p) => p.id === id);
  if (entry) {
    entry.targetPrice = targetPrice != null && targetPrice > 0 ? targetPrice : null;
    await saveProducts(products);
  }
  return entry;
}

// ---------------------------------------------------------------------------
// Price checking
// ---------------------------------------------------------------------------

async function checkOne(entry) {
  const when = Date.now();
  try {
    const res = await fetch(entry.url, {
      headers: { "Accept": "text/html,application/xhtml+xml" },
      credentials: "omit",
      redirect: "follow"
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const html = await res.text();
    const found = Extractor.extractFromHtml(html, entry.url);
    if (!found || !found.amount) throw new Error("No price found on page");

    const previous = entry.currentPrice;
    recordPrice(entry, found.amount, when);
    if (found.currency && !entry.currency) entry.currency = found.currency;
    if (found.image && !entry.image) entry.image = found.image;

    return { entry, previous, current: found.amount };
  } catch (err) {
    entry.lastChecked = when;
    entry.lastError = String(err && err.message ? err.message : err);
    return { entry, previous: entry.currentPrice, current: entry.currentPrice, error: entry.lastError };
  }
}

async function checkAll() {
  const products = await getProducts();
  if (!products.length) return { checked: 0 };
  const settings = await getSettings();

  let drops = 0;
  for (const entry of products) {
    const { previous, current, error } = await checkOne(entry);
    if (error) continue;

    const hitTarget = entry.targetPrice != null && current <= entry.targetPrice;
    const dropped = current < previous;

    if (hitTarget || (dropped && settings.notifyOnAnyDrop)) {
      drops++;
      notifyPriceChange(entry, previous, current, hitTarget);
    }
  }
  await saveProducts(products);
  return { checked: products.length, drops };
}

function formatMoney(amount, currency) {
  if (amount == null) return "—";
  try {
    return new Intl.NumberFormat(undefined, {
      style: currency ? "currency" : "decimal",
      currency: currency || undefined,
      maximumFractionDigits: 2
    }).format(amount);
  } catch (_) {
    return (currency ? currency + " " : "") + amount.toFixed(2);
  }
}

function notifyPriceChange(entry, previous, current, hitTarget) {
  const cur = entry.currency;
  const title = hitTarget ? "🎯 Target price reached!" : "📉 Price dropped!";
  const message =
    `${entry.name}\n` +
    `${formatMoney(previous, cur)} → ${formatMoney(current, cur)}` +
    (hitTarget && entry.targetPrice != null
      ? ` (target ${formatMoney(entry.targetPrice, cur)})`
      : "");
  try {
    api.notifications.create("drop_" + entry.id + "_" + Date.now(), {
      type: "basic",
      iconUrl: api.runtime.getURL("images/icon-128.png"),
      title,
      message
    });
  } catch (err) {
    console.warn("[Price Tracker] notification failed:", err);
  }
}

async function updateBadge() {
  try {
    const count = (await getProducts()).length;
    if (api.action && api.action.setBadgeText) {
      await api.action.setBadgeText({ text: count ? String(count) : "" });
      if (api.action.setBadgeBackgroundColor) {
        await api.action.setBadgeBackgroundColor({ color: "#2f6bff" });
      }
    }
  } catch (_) {
    /* badge is best-effort */
  }
}

// ---------------------------------------------------------------------------
// Alarms
// ---------------------------------------------------------------------------

async function rescheduleAlarm(minutes) {
  const period = Math.max(15, Number(minutes) || DEFAULT_SETTINGS.checkIntervalMinutes);
  try {
    await api.alarms.clear(ALARM_NAME);
    api.alarms.create(ALARM_NAME, { periodInMinutes: period, delayInMinutes: 1 });
  } catch (err) {
    console.warn("[Price Tracker] could not schedule alarm:", err);
  }
}

api.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) checkAll();
});

api.runtime.onInstalled.addListener(async () => {
  const settings = await getSettings();
  await rescheduleAlarm(settings.checkIntervalMinutes);
  await updateBadge();
});

api.runtime.onStartup && api.runtime.onStartup.addListener(async () => {
  const settings = await getSettings();
  await rescheduleAlarm(settings.checkIntervalMinutes);
  await updateBadge();
});

// Clicking a notification opens the tracked-items list.
api.notifications.onClicked &&
  api.notifications.onClicked.addListener(() => {
    api.runtime.openOptionsPage && api.runtime.openOptionsPage();
  });

// ---------------------------------------------------------------------------
// Message router (popup + list page)
// ---------------------------------------------------------------------------

api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    try {
      switch (message && message.type) {
        case "ADD_PRODUCT":
          sendResponse({ ok: true, product: await addProduct(message.product) });
          break;
        case "GET_PRODUCTS":
          sendResponse({ ok: true, products: await getProducts() });
          break;
        case "REMOVE_PRODUCT":
          await removeProduct(message.id);
          sendResponse({ ok: true });
          break;
        case "SET_TARGET":
          sendResponse({ ok: true, product: await setTarget(message.id, message.targetPrice) });
          break;
        case "CHECK_NOW":
          sendResponse({ ok: true, result: await checkAll() });
          break;
        case "CHECK_ONE": {
          const products = await getProducts();
          const entry = products.find((p) => p.id === message.id);
          if (!entry) {
            sendResponse({ ok: false, error: "not found" });
            break;
          }
          await checkOne(entry);
          await saveProducts(products);
          sendResponse({ ok: true, product: entry });
          break;
        }
        case "GET_SETTINGS":
          sendResponse({ ok: true, settings: await getSettings() });
          break;
        case "SAVE_SETTINGS":
          sendResponse({ ok: true, settings: await saveSettings(message.settings) });
          break;
        default:
          sendResponse({ ok: false, error: "unknown message type" });
      }
    } catch (err) {
      sendResponse({ ok: false, error: String(err && err.message ? err.message : err) });
    }
  })();
  return true; // async response
});
