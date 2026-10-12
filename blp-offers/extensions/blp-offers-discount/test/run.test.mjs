import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../src/run.js';

const V = (n) => `gid://shopify/ProductVariant/${n}`;
const P = (n) => `gid://shopify/Product/${n}`;

function line(id, variant, product, extra = {}) {
  return {
    id: `gid://shopify/CartLine/${id}`,
    quantity: extra.qty || 1,
    offer: extra.offer ? { value: extra.offer } : null,
    cost: { amountPerQuantity: { amount: '10.0' } },
    merchandise: { __typename: 'ProductVariant', id: V(variant), product: { id: P(product), ...(extra.cols || {}) } },
  };
}

const config = {
  v: 1,
  offers: [
    { id: 'g1', type: 'gift', active: true, limitOne: true,
      trig: { products: [P(100)], variants: [], collections: [] },
      rewards: [{ variant: V(900), product: P(90), qty: 1 }],
      disc: { type: 'pct', value: 100, label: 'BONUS' } },
    { id: 'u1', type: 'upsell', active: true,
      trig: { products: [], variants: [V(201)], collections: [] },
      rewards: [{ variant: V(901), product: P(91) }],
      disc: { type: 'pct', value: 10, label: '10% OFF' } },
    { id: 'c1', type: 'upsell', active: true,
      trig: { products: [], variants: [], collections: ['gid://shopify/Collection/5'], cslot: 3 },
      rewards: [{ variant: V(902), product: P(92) }],
      disc: { type: 'amt', value: 5, label: '$5 OFF' } },
    { id: 'off', type: 'gift', active: false,
      trig: { products: [P(100)] }, rewards: [{ variant: V(903) }] },
  ],
};

const base = (lines) => ({
  cart: { lines },
  discount: { discountClasses: ['PRODUCT'], config: { jsonValue: config } },
});

test('gift is free when trigger product in cart, limited to 1', () => {
  const out = run(base([line(1, 100, 100), line(2, 900, 90, { offer: 'g1', qty: 2 })]));
  assert.equal(out.operations.length, 1);
  const c = out.operations[0].productDiscountsAdd.candidates;
  assert.equal(c.length, 1);
  assert.deepEqual(c[0].value, { percentage: { value: 100 } });
  assert.equal(c[0].targets[0].cartLine.quantity, 1);
  assert.equal(c[0].message, 'BONUS');
});

test('no discount when trigger missing', () => {
  const out = run(base([line(2, 900, 90, { offer: 'g1' })]));
  assert.equal(out.operations.length, 0);
});

test('no discount without _blp_offer property', () => {
  const out = run(base([line(1, 100, 100), line(2, 900, 90)]));
  assert.equal(out.operations.length, 0);
});

test('upsell pct by variant trigger', () => {
  const out = run(base([line(1, 201, 20), line(2, 901, 91, { offer: 'u1', qty: 3 })]));
  const c = out.operations[0].productDiscountsAdd.candidates[0];
  assert.deepEqual(c.value, { percentage: { value: 10 } });
  assert.equal(c.targets[0].cartLine.quantity, undefined);
});

test('collection trigger via slot', () => {
  const out = run(base([line(1, 300, 30, { cols: { c3: true } }), line(2, 902, 92, { offer: 'c1' })]));
  const c = out.operations[0].productDiscountsAdd.candidates[0];
  assert.deepEqual(c.value, { fixedAmount: { amount: '5.00', appliesToEachItem: true } });
});

test('inactive offer ignored; wrong reward variant ignored', () => {
  assert.equal(run(base([line(1, 100, 100), line(2, 903, 93, { offer: 'off' })])).operations.length, 0);
  assert.equal(run(base([line(1, 100, 100), line(2, 999, 99, { offer: 'g1' })])).operations.length, 0);
});

test('empty config / no product class', () => {
  assert.equal(run({ cart: { lines: [line(1, 1, 1)] }, discount: { discountClasses: ['PRODUCT'], config: null } }).operations.length, 0);
  assert.equal(run({ cart: { lines: [line(1, 1, 1)] }, discount: { discountClasses: ['ORDER'], config: { jsonValue: config } } }).operations.length, 0);
});
