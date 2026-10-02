// Matches a freshly parsed spoken item against the owner's product catalog, so
// a price the shopkeeper didn't say can still be filled from the catalog — the
// single biggest friction in the voice flow is "Price?" blocking the send.
//
// Matching is deliberately conservative: when two catalog products could both
// be the match, this returns null and the item stays unpriced. A wrongly
// auto-filled price lands on a real bill with nobody watching; an unfilled
// price just makes the shopkeeper say the number out loud. Every tier below
// keeps that bias.

const normalize = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[.,।!?'"()\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const words = (s) => normalize(s).split(" ").filter(Boolean);

/**
 * findCatalogMatch(products, { product, brand }) -> catalog entry or null
 *
 * Tier 1 — exact name. Several products sharing a name is normal (same soap,
 * different brands); brand words disambiguate when they were spoken.
 * Tier 2 — one name's words sit inside the other's: "namak" matches a catalog
 * "Tata Namak" (the brand word counts as part of the name here). Unique hit
 * wins; two or more hits is ambiguous -> null.
 */
function findCatalogMatch(products, { product, brand } = {}) {
  if (!product || !Array.isArray(products) || !products.length) return null;

  const query = normalize(product);
  const queryWords = words(product);
  const brandWords = words(brand || "");

  // A spoken brand word must appear in the product's own words. It can VETO an
  // exact-name hit: "Lux ... sabun" with both a generic "Sabun" and a "Lux
  // Sabun" in the catalog means the Lux one — the generic exact match loses.
  const brandOk = (p) => {
    if (!brandWords.length) return true;
    const pWords = new Set([...words(p.name), ...words(p.brand)]);
    return brandWords.every((w) => pWords.has(w));
  };

  // Tier 1 — exact name (brand-vetoed).
  const exact = products.filter((p) => normalize(p.name) === query && brandOk(p));
  if (exact.length === 1) return exact[0];

  // Tier 2 — one side's words all sit inside the other's ("namak" finds
  // "Tata Namak"). Unique hit wins; two or more is ambiguous -> null.
  const subset = products.filter((p) => {
    if (!brandOk(p)) return false;
    const pWords = [...words(p.name), ...words(p.brand)];
    if (!pWords.length || !queryWords.length) return false;
    const pSet = new Set(pWords);
    const qSet = new Set(queryWords);
    return queryWords.every((w) => pSet.has(w)) || pWords.every((w) => qSet.has(w));
  });
  if (subset.length === 1) return subset[0];
  return null; // ambiguous, or nothing matched
}

/**
 * autoFillPrices(parsedItems, products) -> filledCount
 *
 * For every item that matches a catalog product, links product_id + a
 * purchase_price SNAPSHOT (used for profit and stock deduction later). Items
 * without a spoken price additionally get the catalog's selling price —
 * a price the shopkeeper said out loud is never overwritten: they may be
 * quoting a discount, or the catalog may simply be stale.
 */
function autoFillPrices(parsedItems, products) {
  const items = Array.isArray(parsedItems) ? parsedItems : [];
  let filled = 0;
  for (const item of items) {
    const match = findCatalogMatch(products, { product: item.product, brand: item.brand });
    if (!match) continue;
    item.product_id = match.product_id;
    item.purchase_price = match.purchase_price ?? null;
    if (item.price == null) {
      item.price = match.selling_price;
      filled++;
    }
  }
  return filled;
}

module.exports = { findCatalogMatch, autoFillPrices, normalize };
