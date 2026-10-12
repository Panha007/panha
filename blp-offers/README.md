# BLP Offers

Private Shopify app for Baby Little Planet that replaces Koala Upsells & Gifts.

- `extensions/blp-offers-discount` – Shopify Function (`cart.lines.discounts.generate.run`).
  It reads the offer list from the discount metafield `blp_offers.config` and discounts cart
  lines carrying the line property `_blp_offer=<offer id>` (gifts = 100% off, upsells = % or $ off)
  when the offer's trigger product/variant/collection is also in the cart.
- Collection triggers are passed as input variables `c1..c20` from the discount metafield
  `blp_offers.vars` (one slot per offer that uses collections).
- Offers are managed from the BLP Offers dashboard (Claude artifact) which writes both metafields.
- Storefront widgets live in the theme (`snippets/blp-offers.liquid`, `assets/blp-offers.js`).

## Deploy

Pushing to `main` runs `.github/workflows/deploy-blp-offers.yml` (repo root), which needs the repository secret
`SHOPIFY_APP_AUTOMATION_TOKEN` (Dev Dashboard → app → Settings → Automation tokens).
