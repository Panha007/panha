# Price Tracker — Safari Extension App

Track the price of goods on any online store, right from Safari. Open a product
page, click the toolbar icon, and Price Tracker starts watching that item. It
re-checks prices on a schedule and sends you a notification when a price drops
or hits your target.

![icon](Extension/Resources/images/icon-128.png)

## Features

- **One-click tracking** — detects the product name, price, currency and image
  on the page you're viewing and tracks it with a single click.
- **Robust price detection** — reads schema.org JSON-LD, Open Graph /
  `product:price` meta tags, microdata (`itemprop`), and falls back to common
  price selectors. Handles US (`1,299.00`) and European (`1.299,00`) number
  formats and a wide range of currencies.
- **Automatic re-checks** — a background worker re-fetches each tracked page on
  a schedule you choose (1–24 hours) and records the new price.
- **Price-drop & target alerts** — native notifications when a price falls, or
  when it reaches a target you set.
- **Dashboard** — a full page listing every tracked item with its current
  price, change since you added it, lowest-ever price, and a price-history
  sparkline.
- **Private by design** — everything is stored locally in the extension's own
  storage. No accounts, no servers, no analytics.

## Project layout

```
PriceTracker/
├── Extension/
│   ├── Resources/                 # the Safari Web Extension (Manifest V3)
│   │   ├── manifest.json
│   │   ├── background.js           # scheduling, re-checks, notifications
│   │   ├── content.js              # detects the product on the current page
│   │   ├── lib/extractor.js        # shared price-extraction library
│   │   ├── popup.html/.css/.js      # toolbar popup ("Track this price")
│   │   ├── list.html/.css/.js       # dashboard + settings (options page)
│   │   └── images/                 # generated app icons
│   └── SafariWebExtensionHandler.swift  # native message bridge (reference)
├── scripts/
│   ├── build-xcode-project.sh      # generate the Xcode app via Apple's tool
│   └── make_icons.py               # regenerate the icon set (no deps)
└── test/
    ├── extractor.test.mjs          # unit tests for price extraction
    ├── fixtures.js
    └── sample-product.html         # a page to test detection against
```

## Build the Safari app (macOS, requires Xcode)

Safari extensions ship inside a host app. Apple's converter turns the web
extension in `Extension/Resources` into a ready-to-build Xcode project:

```bash
./scripts/build-xcode-project.sh          # macOS + iOS
# or
./scripts/build-xcode-project.sh --macos-only
```

Then:

1. `open xcode/"Price Tracker"/"Price Tracker".xcodeproj`
2. Select the app target → **Signing & Capabilities** → choose your Team.
3. Press **Run** to install the host app.
4. Enable the extension: **Safari → Settings → Extensions → Price Tracker**.
   - For unsigned local builds, first enable **Safari → Settings → Advanced →
     Show features for web developers**, then **Develop → Allow Unsigned
     Extensions**.

> The converter generates its own `SafariWebExtensionHandler.swift`; the copy in
> `Extension/` is kept for reference so the native side is reviewable in-repo.

## Try the extension logic without Xcode

Because the extension is a standard Manifest V3 web extension, you can load
`Extension/Resources` unpacked in a Chromium-based browser to exercise the same
popup, dashboard, and background logic during development
(`chrome://extensions` → Developer mode → *Load unpacked*). Safari-specific
packaging still requires the Xcode step above.

Open `test/sample-product.html` in the browser to confirm product detection.

## Run the tests

```bash
node test/extractor.test.mjs
```

This covers price parsing (currencies, thousands/decimal separators) and the
JSON-LD / Open Graph / microdata extraction paths used when re-checking prices.

## Regenerate icons

```bash
python3 scripts/make_icons.py
```

## How price re-checking works

The content script only reads the page you're actively viewing. For scheduled
re-checks the background worker `fetch`es the product URL and extracts the price
from the returned HTML using the same shared library (via a regex/JSON path,
since service workers have no DOM). Some sites render prices only via JavaScript
or block background requests; those items will show a "no price found" note and
keep their last known price until the next successful check. You can always open
the product and re-track it, or hit **Check now**.

## Notes & limitations

- Prices are detected from structured data first, which is accurate on most
  major stores. Sites that expose no structured data and render prices purely
  client-side may not be trackable in the background.
- Notification and background-fetch behavior depends on Safari granting the
  extension the relevant permissions when you enable it.
