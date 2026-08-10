/*
 * Tracked-items dashboard (also the extension's options page).
 * Renders every tracked product with its current price, change since it was
 * added, lowest-ever price and a sparkline of its price history. Lets the user
 * edit target prices, check a single item, remove items, and tune the global
 * check interval / notification settings.
 */
(function () {
  "use strict";

  const api = typeof browser !== "undefined" ? browser : chrome;

  const els = {
    items: document.getElementById("items"),
    empty: document.getElementById("empty"),
    template: document.getElementById("item-template"),
    checkAll: document.getElementById("check-all"),
    interval: document.getElementById("interval"),
    notifyAny: document.getElementById("notify-any"),
    status: document.getElementById("status")
  };

  function send(message) {
    return new Promise((resolve) => api.runtime.sendMessage(message, resolve));
  }

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

  function flash(text) {
    els.status.textContent = text;
    clearTimeout(flash._t);
    flash._t = setTimeout(() => (els.status.textContent = ""), 2500);
  }

  function sparkline(svg, history) {
    const points = (history || []).filter((h) => Number.isFinite(h.price));
    svg.innerHTML = "";
    if (points.length < 2) return;

    const W = 120;
    const H = 40;
    const pad = 3;
    const prices = points.map((p) => p.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const span = max - min || 1;
    const step = (W - pad * 2) / (points.length - 1);

    const coords = points.map((p, i) => {
      const x = pad + i * step;
      const y = H - pad - ((p.price - min) / span) * (H - pad * 2);
      return [x, y];
    });

    const ns = "http://www.w3.org/2000/svg";
    const path = document.createElementNS(ns, "polyline");
    path.setAttribute("fill", "none");
    const rising = prices[prices.length - 1] > prices[0];
    path.setAttribute("stroke", rising ? "var(--up)" : "var(--down)");
    path.setAttribute("stroke-width", "2");
    path.setAttribute("stroke-linejoin", "round");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("points", coords.map((c) => c.join(",")).join(" "));
    svg.appendChild(path);

    const last = coords[coords.length - 1];
    const dot = document.createElementNS(ns, "circle");
    dot.setAttribute("cx", last[0]);
    dot.setAttribute("cy", last[1]);
    dot.setAttribute("r", "2.5");
    dot.setAttribute("fill", rising ? "var(--up)" : "var(--down)");
    svg.appendChild(dot);
  }

  function renderItem(p) {
    const node = els.template.content.firstElementChild.cloneNode(true);
    const img = node.querySelector(".pt-item-thumb");
    const name = node.querySelector(".pt-item-name");
    const current = node.querySelector(".pt-current");
    const delta = node.querySelector(".pt-delta");
    const lowest = node.querySelector(".pt-lowest");
    const targetInput = node.querySelector(".pt-target-input");
    const errorEl = node.querySelector(".pt-error");
    const spark = node.querySelector(".pt-spark");

    if (p.image) {
      img.src = p.image;
      img.onerror = () => (img.hidden = true);
    } else {
      img.hidden = true;
    }

    name.textContent = p.name || p.url;
    name.href = p.url;
    current.textContent = money(p.currentPrice, p.currency);

    if (p.startPrice != null && p.currentPrice != null && p.startPrice !== p.currentPrice) {
      const diff = p.currentPrice - p.startPrice;
      const pct = (diff / p.startPrice) * 100;
      delta.textContent = `${diff < 0 ? "▼" : "▲"} ${money(Math.abs(diff), p.currency)} (${pct.toFixed(1)}%)`;
      delta.classList.add(diff < 0 ? "down" : "up");
    } else {
      delta.textContent = "no change";
      delta.style.color = "var(--muted)";
    }

    lowest.textContent = `lowest ${money(p.lowestPrice, p.currency)}`;
    if (p.lastError) {
      errorEl.textContent = "⚠ " + p.lastError;
    }
    if (p.targetPrice != null) targetInput.value = p.targetPrice;

    sparkline(spark, p.history);

    // Target editing (persist on change).
    targetInput.addEventListener("change", async () => {
      const val = parseFloat(targetInput.value);
      await send({
        type: "SET_TARGET",
        id: p.id,
        targetPrice: Number.isFinite(val) && val > 0 ? val : null
      });
      flash("Target saved");
    });

    node.querySelector(".pt-check-one").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      btn.textContent = "…";
      await send({ type: "CHECK_ONE", id: p.id });
      await load();
    });

    node.querySelector(".pt-remove").addEventListener("click", async () => {
      await send({ type: "REMOVE_PRODUCT", id: p.id });
      await load();
    });

    return node;
  }

  async function load() {
    const resp = await send({ type: "GET_PRODUCTS" });
    const products = (resp && resp.products) || [];
    products.sort((a, b) => b.addedAt - a.addedAt);

    els.items.innerHTML = "";
    els.empty.hidden = products.length > 0;
    for (const p of products) els.items.appendChild(renderItem(p));
  }

  async function loadSettings() {
    const resp = await send({ type: "GET_SETTINGS" });
    const s = (resp && resp.settings) || {};
    if (s.checkIntervalMinutes) els.interval.value = String(s.checkIntervalMinutes);
    els.notifyAny.checked = s.notifyOnAnyDrop !== false;
  }

  els.interval.addEventListener("change", async () => {
    await send({ type: "SAVE_SETTINGS", settings: { checkIntervalMinutes: Number(els.interval.value) } });
    flash("Schedule updated");
  });

  els.notifyAny.addEventListener("change", async () => {
    await send({ type: "SAVE_SETTINGS", settings: { notifyOnAnyDrop: els.notifyAny.checked } });
    flash("Preferences saved");
  });

  els.checkAll.addEventListener("click", async () => {
    els.checkAll.disabled = true;
    els.checkAll.textContent = "Checking…";
    const resp = await send({ type: "CHECK_NOW" });
    await load();
    els.checkAll.disabled = false;
    els.checkAll.textContent = "Check all now";
    const r = resp && resp.result;
    flash(r ? `Checked ${r.checked} item(s), ${r.drops || 0} drop(s)` : "Done");
  });

  loadSettings();
  load();
})();
