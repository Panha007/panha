/*
 * Popup logic. Asks the content script what product is on the active tab,
 * shows it, and lets the user start tracking it (optionally with a target
 * price). Also exposes quick actions: check-now and open the full list.
 */
(function () {
  "use strict";

  const api = typeof browser !== "undefined" ? browser : chrome;

  const els = {
    loading: document.getElementById("loading"),
    detected: document.getElementById("detected"),
    image: document.getElementById("product-image"),
    name: document.getElementById("product-name"),
    price: document.getElementById("product-price"),
    targetRow: document.getElementById("target-row"),
    targetInput: document.getElementById("target-input"),
    trackBtn: document.getElementById("track-btn"),
    already: document.getElementById("already"),
    empty: document.getElementById("empty"),
    count: document.getElementById("count"),
    checkNow: document.getElementById("check-now"),
    openList: document.getElementById("open-list")
  };

  let currentProduct = null;

  function money(amount, currency) {
    if (amount == null) return "—";
    try {
      return new Intl.NumberFormat(undefined, {
        style: currency ? "currency" : "decimal",
        currency: currency || undefined,
        maximumFractionDigits: 2
      }).format(amount);
    } catch (_) {
      return (currency ? currency + " " : "") + Number(amount).toFixed(2);
    }
  }

  function send(message) {
    return new Promise((resolve) => api.runtime.sendMessage(message, resolve));
  }

  async function getActiveTab() {
    const tabs = await api.tabs.query({ active: true, currentWindow: true });
    return tabs && tabs[0];
  }

  function askContentScript(tabId) {
    return new Promise((resolve) => {
      let settled = false;
      const done = (v) => {
        if (!settled) {
          settled = true;
          resolve(v);
        }
      };
      try {
        api.tabs.sendMessage(tabId, { type: "DETECT_PRODUCT" }, (resp) => {
          // Ignore lastError; a missing content script just means "no product".
          void api.runtime.lastError;
          done(resp && resp.product ? resp.product : null);
        });
      } catch (_) {
        done(null);
      }
      setTimeout(() => done(null), 1500);
    });
  }

  function showDetected(product, alreadyTracked) {
    els.loading.hidden = true;
    els.detected.hidden = false;
    els.name.textContent = product.name || product.url;
    els.price.textContent = money(product.amount, product.currency);
    if (product.image) {
      els.image.src = product.image;
      els.image.hidden = false;
      els.image.onerror = () => (els.image.hidden = true);
    }
    if (alreadyTracked) {
      els.already.hidden = false;
    } else {
      els.targetRow.hidden = false;
      els.trackBtn.hidden = false;
    }
  }

  function showEmpty() {
    els.loading.hidden = true;
    els.empty.hidden = false;
  }

  async function refreshCount() {
    const resp = await send({ type: "GET_PRODUCTS" });
    const n = resp && resp.products ? resp.products.length : 0;
    els.count.textContent = n ? `${n} item${n === 1 ? "" : "s"} tracked` : "Nothing tracked yet";
    return resp && resp.products ? resp.products : [];
  }

  async function init() {
    const tab = await getActiveTab();
    const products = await refreshCount();

    if (!tab || !tab.id || !/^https?:/i.test(tab.url || "")) {
      showEmpty();
      return;
    }

    const product = await askContentScript(tab.id);
    if (!product || !product.amount) {
      showEmpty();
      return;
    }
    currentProduct = product;
    const already = products.some((p) => p.url === product.url);
    showDetected(product, already);
  }

  els.trackBtn.addEventListener("click", async () => {
    if (!currentProduct) return;
    els.trackBtn.disabled = true;
    els.trackBtn.textContent = "Tracking…";

    const targetRaw = parseFloat(els.targetInput.value);
    const resp = await send({ type: "ADD_PRODUCT", product: currentProduct });
    if (resp && resp.ok && resp.product && Number.isFinite(targetRaw) && targetRaw > 0) {
      await send({ type: "SET_TARGET", id: resp.product.id, targetPrice: targetRaw });
    }

    els.trackBtn.hidden = true;
    els.targetRow.hidden = true;
    els.already.hidden = false;
    els.already.textContent = "✓ Now tracking this product.";
    await refreshCount();
  });

  els.checkNow.addEventListener("click", async () => {
    els.checkNow.textContent = "Checking…";
    els.checkNow.disabled = true;
    await send({ type: "CHECK_NOW" });
    els.checkNow.textContent = "Checked ✓";
    setTimeout(() => {
      els.checkNow.textContent = "Check now";
      els.checkNow.disabled = false;
    }, 1500);
  });

  els.openList.addEventListener("click", () => {
    if (api.runtime.openOptionsPage) api.runtime.openOptionsPage();
    else api.tabs.create({ url: api.runtime.getURL("list.html") });
    window.close();
  });

  init();
})();
