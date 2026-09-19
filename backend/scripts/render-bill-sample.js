// Renders a sample bill covering the cases the old Jimp renderer got wrong.
// Run it and look at the PNG when you change anything about the layout:
//   npm run render:sample
const { generateBillImage } = require("../src/services/billImage");

const items = [
  { product_name: "साड़ी", quantity: 5, unit: null, price: 300, line_total: 1500 },
  { product_name: "आम", quantity: 2, unit: "kilo", price: 60, line_total: 120 },
  { product_name: "आम", quantity: 3, unit: "किलो", price: 60, line_total: 180 },
  { product_name: "Tata Namak", quantity: 12, unit: "packet", price: 25, line_total: 300 },
  { product_name: "नहाने की साबुन", quantity: 2, unit: "डिब्बा", price: 45, line_total: 90 },
  // No `unit` key at all — the shape every record written before units existed
  // has. Must render as a bare "12", not "12 undefined".
  { product_name: "Shirt", quantity: 12, price: 500, line_total: 6000 },
  { product_name: "पाँच किलो चीनी का बड़ा पैकेट एक्स्ट्रा लंबा नाम", quantity: 1, unit: "पैकेट", price: 1250, line_total: 1250 },
  { product_name: "साड़ी धोती कुर्ता पायजामा चादर तकिया रुमाल तौलिया साबुन तेल", quantity: 1, unit: null, price: 99, line_total: 99 },
  { product_name: "Extremely Long English Product Name That Should Get Cut Off Here", quantity: 1, unit: "dozen", price: 10, line_total: 10 },
  { product_name: "Chai & Biscuit <combo>", quantity: 3, unit: "plate", price: 20, line_total: 60 },
  { product_name: "अंडा", quantity: 30, unit: null, price: null, line_total: null },
];

generateBillImage({
  transaction: {
    transaction_id: "devanagari-render-check",
    items,
    total_amount: items.reduce((s, i) => s + (i.line_total || 0), 0),
  },
  shop: {
    shop_name: "रोहित जनरल स्टोर",
    owner_phone: "9876543210",
    upi_id: "rohitstore@upi",
  },
})
  .then((p) => console.log("wrote", p))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
