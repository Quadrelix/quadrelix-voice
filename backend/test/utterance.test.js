// Run with: npm test
//
// These two functions decide what happens to every sentence the hands-free
// screen overhears — whether it's worth a Gemini call at all, and whether it's a
// new item or the answer to a price the app is still waiting for. Both are pure,
// so a wrong decision is reproducible here rather than only on a real bill.

const test = require("node:test");
const assert = require("node:assert");

const { hasItemContent, matchPriceFill } = require("../src/services/utterance");

// --- hasItemContent: the gate before the parser -----------------------------

test("sale-shaped text passes the gate", () => {
  for (const said of [
    "2 kilo aam 60 rupaye",
    "do shanti amla tel bees rupaye", // spoken numbers, no digits typed
    "₹2 की मिर्च",
    "पाँच साड़ी तीन सौ रुपये",
  ]) {
    assert.strictEqual(hasItemContent(said), true, said);
  }
});

test("conversation and leftovers don't reach the parser", () => {
  // Continuous listening hears all of this. Each one that got through would cost
  // a Gemini call and come back as an error the shopkeeper can't act on.
  for (const said of [
    "",
    "   ",
    "haan theek hai",
    "aur",
    "namaste bhaiya kaise hain",
    "।",
    undefined,
    null,
  ]) {
    assert.strictEqual(hasItemContent(said), false, String(said));
  }
});

// --- matchPriceFill: a repeated product answers a missing price -------------

test("a product already on the bill without a price gets filled, not duplicated", () => {
  // The situation this exists for: the price was missed, the sale can't be sent
  // until it's there, and the shopkeeper's hands are full so they say it again.
  const existing = [{ product_name: "Aam", quantity: 2, unit: "kilo", price: null }];
  const parsed = [{ product: "aam", quantity: 1, unit: null, price: 60 }];

  const { fills, additions } = matchPriceFill(existing, parsed);
  assert.deepStrictEqual(fills, [{ item_index: 0, price: 60 }]);
  assert.deepStrictEqual(additions, []);
});

test("a restated quantity is ignored — only the price is taken", () => {
  // "aam 60 rupaye" is answering a question about price, not re-counting the
  // mangoes. Overwriting the count nobody re-confirmed is the worse mistake.
  const existing = [{ product_name: "Aam", quantity: 2, unit: "kilo", price: null }];
  const parsed = [{ product: "Aam", quantity: 5, unit: "kilo", price: 60 }];

  const { fills } = matchPriceFill(existing, parsed);
  assert.deepStrictEqual(fills, [{ item_index: 0, price: 60 }]);
});

test("an already-priced item of the same name is a genuine second line", () => {
  // Two separate sales of the same product must stay two lines. Only a NULL
  // price is a question waiting to be answered.
  const existing = [{ product_name: "Aam", quantity: 2, unit: "kilo", price: 60 }];
  const parsed = [{ product: "Aam", quantity: 1, unit: "kilo", price: 55 }];

  const { fills, additions } = matchPriceFill(existing, parsed);
  assert.deepStrictEqual(fills, []);
  assert.deepStrictEqual(additions, parsed);
});

test("a brand named only the first time still matches", () => {
  // Bill says "Tata Namak"; the shopkeeper quotes the price as just "namak".
  const existing = [{ product_name: "Tata Namak", quantity: 2, unit: "packet", price: null }];
  const parsed = [{ product: "Namak", quantity: 1, unit: null, price: 25 }];

  assert.deepStrictEqual(matchPriceFill(existing, parsed).fills, [
    { item_index: 0, price: 25 },
  ]);
});

test("an ambiguous loose match is added, not guessed at", () => {
  // Two unpriced items both partially match "namak". Picking one would print a
  // price on the wrong line of a real bill, and nothing on screen would say so.
  const existing = [
    { product_name: "Tata Namak", quantity: 1, unit: "packet", price: null },
    { product_name: "Sendha Namak", quantity: 1, unit: "packet", price: null },
  ];
  const parsed = [{ product: "Namak", quantity: 1, unit: null, price: 25 }];

  const { fills, additions } = matchPriceFill(existing, parsed);
  assert.deepStrictEqual(fills, []);
  assert.deepStrictEqual(additions, parsed);
});

test("Devanagari names match on their own terms", () => {
  const existing = [{ product_name: "आम", quantity: 2, unit: "किलो", price: null }];
  const parsed = [{ product: "आम", quantity: 1, unit: null, price: 60 }];
  assert.deepStrictEqual(matchPriceFill(existing, parsed).fills, [
    { item_index: 0, price: 60 },
  ]);
});

test("a parsed item with no price can never be a fill", () => {
  // Nothing to fill with. It's a new item even if the name matches exactly.
  const existing = [{ product_name: "Aam", quantity: 2, unit: "kilo", price: null }];
  const parsed = [{ product: "Aam", quantity: 3, unit: "kilo", price: null }];

  const { fills, additions } = matchPriceFill(existing, parsed);
  assert.deepStrictEqual(fills, []);
  assert.deepStrictEqual(additions, parsed);
});

test("two prices for the same name fill once and then add", () => {
  // One unpriced line can only answer one question. The second mention has to
  // become its own item or it would overwrite the first and vanish.
  const existing = [{ product_name: "Aam", quantity: 2, unit: "kilo", price: null }];
  const parsed = [
    { product: "Aam", quantity: 1, unit: null, price: 60 },
    { product: "Aam", quantity: 1, unit: null, price: 55 },
  ];

  const { fills, additions } = matchPriceFill(existing, parsed);
  assert.deepStrictEqual(fills, [{ item_index: 0, price: 60 }]);
  assert.deepStrictEqual(additions, [parsed[1]]);
});

test("the right index is filled when several items are unpriced", () => {
  const existing = [
    { product_name: "Aam", quantity: 2, unit: "kilo", price: null },
    { product_name: "Dettol Sabun", quantity: 3, unit: null, price: null },
  ];
  const parsed = [{ product: "Dettol Sabun", quantity: 1, unit: null, price: 10 }];

  assert.deepStrictEqual(matchPriceFill(existing, parsed).fills, [
    { item_index: 1, price: 10 },
  ]);
});

test("a mixed sentence fills one price and adds the new item", () => {
  // "aam 60 rupaye aur teen dettol sabun 10 rupaye" — one answer, one new sale.
  const existing = [{ product_name: "Aam", quantity: 2, unit: "kilo", price: null }];
  const parsed = [
    { product: "Aam", quantity: 1, unit: null, price: 60 },
    { product: "Dettol Sabun", quantity: 3, unit: null, price: 10 },
  ];

  const { fills, additions } = matchPriceFill(existing, parsed);
  assert.deepStrictEqual(fills, [{ item_index: 0, price: 60 }]);
  assert.deepStrictEqual(additions, [parsed[1]]);
});

test("an empty or absent bill just adds everything", () => {
  const parsed = [{ product: "Aam", quantity: 2, unit: "kilo", price: 60 }];
  assert.deepStrictEqual(matchPriceFill([], parsed), { fills: [], additions: parsed });
  assert.deepStrictEqual(matchPriceFill(undefined, parsed), { fills: [], additions: parsed });
  assert.deepStrictEqual(matchPriceFill([], undefined), { fills: [], additions: [] });
});
