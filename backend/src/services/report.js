// The end-of-day numbers: total sales, total cost, profit, best sellers and
// outstanding udaar. Pure functions — no db, no clock (the route passes the
// date), so a full day of sales can be replayed in a test.

const { normalize } = require("./productMatch");

// ISO timestamp -> 'YYYY-MM-DD' in IST — the shop's "today", not UTC's. The
// en-CA locale is the trick: it formats dates as YYYY-MM-DD everywhere.
function toISTDate(iso) {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/**
 * dailyReport({ transactions, products, date }) -> the day's summary
 *
 * 'draft' transactions are half-heard sentences, not sales — only 'confirmed'
 * and 'sent' count (a Twilio failure on /finalize leaves 'confirmed': the
 * sale happened, only the WhatsApp copy failed). A sale belongs to the day it
 * was FINALIZED, not the day the draft was started — a bill begun at 23:55 and
 * completed at 00:05 is tomorrow's sale.
 *
 * Cost comes from each item's purchase_price SNAPSHOT. Items sold off-catalog
 * have no snapshot; their profit is UNKNOWN, not zero. So the margin is only
 * computed over items whose cost IS known:
 *
 *   total_profit  = revenue of known-cost items  −  their cost
 *                   (a gross margin, NOT net profit — shop expenses are not
 *                   modelled, and unknown-cost items are left out, never
 *                   counted as pure profit)
 *   cost_coverage = share of total_sales that total_profit is based on (0–1);
 *                   null when nothing was sold. 1 means every item had a cost.
 *   missing_cost_sales = revenue the margin does NOT cover.
 */
function dailyReport({ transactions, products, date }) {
  const sold = (transactions || []).filter(
    (t) =>
      ["confirmed", "sent"].includes(t.status) &&
      toISTDate(t.finalized_at || t.created_at) === date
  );

  let totalSales = 0;
  let totalCost = 0;
  let knownCostSales = 0;
  let unknownCostItems = 0;
  const byProduct = new Map();

  for (const t of sold) {
    for (const item of t.items || []) {
      totalSales += item.line_total || 0;
      if (item.purchase_price != null) {
        totalCost += item.purchase_price * item.quantity;
        knownCostSales += item.line_total || 0;
      } else {
        unknownCostItems++;
      }
      const key = normalize(item.product_name);
      const agg = byProduct.get(key) || { name: item.product_name, quantity: 0, revenue: 0 };
      agg.quantity += item.quantity || 0;
      agg.revenue += item.line_total || 0;
      byProduct.set(key, agg);
    }
  }

  const bestSellers = [...byProduct.values()]
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 5);

  // Udaar: credit sales with no settlement mechanism in the MVP, so
  // outstanding = every credit sale's total. The moment a settle flow exists,
  // this is the one line that changes.
  const outstandingCredit = sold
    .filter((t) => t.payment_status === "credit")
    .reduce((sum, t) => sum + (t.total_amount || 0), 0);

  const lowStock = (products || [])
    .filter((p) => p.min_stock_level != null && (p.stock_qty || 0) <= p.min_stock_level)
    .map((p) => ({ name: p.name, stock_qty: p.stock_qty || 0, min_stock_level: p.min_stock_level }));

  return {
    date,
    transactions: sold.length,
    total_sales: totalSales,
    total_cost: totalCost,
    total_profit: knownCostSales - totalCost,
    profit_basis: "known_cost_items",
    known_cost_sales: knownCostSales,
    missing_cost_sales: totalSales - knownCostSales,
    cost_coverage: totalSales > 0 ? knownCostSales / totalSales : null,
    unknown_cost_items: unknownCostItems,
    best_sellers: bestSellers,
    outstanding_credit: outstandingCredit,
    low_stock: lowStock,
  };
}

module.exports = { dailyReport, toISTDate };
