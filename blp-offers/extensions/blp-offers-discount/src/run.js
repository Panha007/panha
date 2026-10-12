/**
 * BLP Offers – cart line discount function.
 *
 * Reads the offer config from the discount metafield `blp_offers.config`
 * (written by the BLP Offers dashboard) and discounts cart lines that carry
 * the line property `_blp_offer = <offer id>` when:
 *   - the offer exists and is active
 *   - the line's variant is one of the offer's reward variants
 *   - at least one OTHER cart line matches the offer's trigger
 *     (product id, variant id, or collection slot cN resolved by the input query)
 *
 * Gift offers get 100% off; upsell offers get `disc` (pct or amt per item).
 * When `limitOne` is set, only 1 unit of the line is discounted.
 */

const GID_PRODUCT = 'gid://shopify/Product/';
const GID_VARIANT = 'gid://shopify/ProductVariant/';

function numId(gid) {
  if (gid == null) return '';
  const s = String(gid);
  const i = s.lastIndexOf('/');
  return i >= 0 ? s.slice(i + 1) : s;
}

function idSet(list) {
  const set = new Set();
  (list || []).forEach((x) => set.add(numId(x)));
  return set;
}

function lineMatchesTrigger(line, offer) {
  const m = line.merchandise;
  if (!m || m.__typename !== 'ProductVariant') return false;
  const trig = offer.trig || {};
  const pid = numId(m.product && m.product.id);
  const vid = numId(m.id);
  if (trig._p && trig._p.has(pid)) return true;
  if (trig._v && trig._v.has(vid)) return true;
  const slot = trig.cslot;
  if (slot && m.product && m.product['c' + slot] === true) return true;
  return false;
}

export function run(input) {
  const classes = (input.discount && input.discount.discountClasses) || [];
  if (!classes.includes('PRODUCT')) return { operations: [] };

  const cfg = input.discount && input.discount.config && input.discount.config.jsonValue;
  const offers = (cfg && Array.isArray(cfg.offers)) ? cfg.offers : [];
  if (!offers.length) return { operations: [] };

  const lines = (input.cart && input.cart.lines) || [];
  if (!lines.length) return { operations: [] };

  // Index offers by id and pre-build lookup sets.
  const byId = {};
  offers.forEach((o) => {
    if (!o || !o.id) return;
    const trig = o.trig || {};
    o.trig = trig;
    trig._p = idSet([].concat(trig.products || [], trig.productsExpanded || []));
    trig._v = idSet(trig.variants || []);
    o._rewards = idSet((o.rewards || []).map((r) => r.variant));
    byId[String(o.id)] = o;
  });

  const candidates = [];

  lines.forEach((line) => {
    const key = line.offer && line.offer.value;
    if (!key) return;
    const offer = byId[String(key).trim()];
    if (!offer || offer.active === false) return;

    const m = line.merchandise;
    if (!m || m.__typename !== 'ProductVariant') return;
    if (!offer._rewards.has(numId(m.id))) return;

    // Trigger must be present on another line (not the reward line itself).
    const triggered = lines.some((other) => other.id !== line.id && lineMatchesTrigger(other, offer));
    if (!triggered) return;

    let value;
    let message;
    if (offer.type === 'gift') {
      value = { percentage: { value: 100 } };
      message = (offer.disc && offer.disc.label) || 'BONUS';
    } else {
      const d = offer.disc || {};
      const amount = Number(d.value) || 0;
      if (amount <= 0) return;
      if (d.type === 'amt') {
        value = { fixedAmount: { amount: amount.toFixed(2), appliesToEachItem: true } };
      } else {
        value = { percentage: { value: Math.min(100, amount) } };
      }
      message = d.label || (d.type === 'amt' ? `$${amount} OFF` : `${amount}% OFF`);
    }

    const target = { id: line.id };
    if (offer.limitOne) target.quantity = 1;

    candidates.push({ message, targets: [{ cartLine: target }], value });
  });

  if (!candidates.length) return { operations: [] };

  return {
    operations: [
      { productDiscountsAdd: { candidates, selectionStrategy: 'ALL' } },
    ],
  };
}
