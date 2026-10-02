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
 * sale happened, only the WhatsApp copy failed).
 *
 * Cost comes from each item's purchase_price SNAPSHOT. Items sold off-catalog
 * have no snapshot; their profit is UNKNOWN, not zero — the report counts
 * them in unknown_cost_items so the owner knows the profit figure is a floor,
 * not the whole truth.
 */
function dailyReport({ transactions, products, date }) {
  const sold = (transactions || []).filter(
    (t) => ["confirmed", "sent"].includes(t.status) && toISTDate(t.created_at) === date
  );

  let totalSales = 0;
  let totalCost = 0;
  let unknownCostItems = 0;
  const byProduct = new Map();

  for (const t of sold) {
    for (const item of t.items || []) {
      totalSales += item.line_total || 0;
      if (item.purchase_price != null) {
        totalCost += item.purchase_price * item.quantity;
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
    total_profit: totalSales - totalCost,
    unknown_cost_items: unknownCostItems,
    best_sellers: bestSellers,
    outstanding_credit: outstandingCredit,
    low_stock: lowStock,
  };
}

module.exports = { dailyReport, toISTDate };
