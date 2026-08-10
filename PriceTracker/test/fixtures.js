// Sample HTML snippets exercising each extraction strategy.
export const JSONLD_PRODUCT = `
<!DOCTYPE html><html><head>
<title>Acme Wireless Headphones</title>
<meta property="og:title" content="Acme Wireless Headphones" />
<meta property="og:image" content="https://example.com/headphones.jpg" />
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Product",
  "name": "Acme Wireless Headphones",
  "image": ["https://example.com/headphones.jpg"],
  "offers": { "@type": "Offer", "price": "129.99", "priceCurrency": "USD" }
}
</script>
</head><body><h1>Acme Wireless Headphones</h1></body></html>`;

export const OG_META_PRODUCT = `
<!DOCTYPE html><html><head>
<title>Deluxe Coffee Grinder</title>
<meta property="og:title" content="Deluxe Coffee Grinder" />
<meta property="product:price:amount" content="89.00" />
<meta property="product:price:currency" content="AUD" />
<meta property="og:image" content="https://example.com/grinder.png" />
</head><body></body></html>`;

export const ITEMPROP_PRODUCT = `
<!DOCTYPE html><html><head><title>Garden Hose 20m</title></head>
<body>
  <div itemscope itemtype="http://schema.org/Product">
    <span itemprop="name">Garden Hose 20m</span>
    <span itemprop="priceCurrency" content="GBP"></span>
    <span itemprop="price" content="24.50">£24.50</span>
  </div>
</body></html>`;

export const EUROPEAN_FORMAT = `
<script type="application/ld+json">
{ "@type": "Product", "name": "Euro Widget",
  "offers": { "price": "1.299,00", "priceCurrency": "EUR" } }
</script>`;

export const NO_PRICE = `
<!DOCTYPE html><html><head><title>About Us</title></head>
<body><p>We are a company.</p></body></html>`;
