// Run with: npm test   (uses Node's built-in test runner — no dependencies)
//
// These only exercise parseWithRegex, itemsFromLLMJson and
// convertHindiNumbersToDigits — all pure functions with no network calls, so the
// suite runs offline and without any API keys. parseSaleItems and parseWithLLM
// are deliberately NOT tested here: they hit the Gemini API when GEMINI_API_KEY
// is set, which would make the suite non-hermetic.

const test = require("node:test");
const assert = require("node:assert");

const { parseWithRegex, itemsFromLLMJson } = require("../src/services/parser");
const { convertHindiNumbersToDigits } = require("../src/services/hindiNumbers");

test("parses a single item with quantity, product and price", () => {
  assert.deepStrictEqual(parseWithRegex("5 white shirt 500 rupaye"), [
    { quantity: 5, unit: null, product: "White Shirt", price: 500 },
  ]);
});

test("parses an item with no currency word", () => {
  assert.deepStrictEqual(parseWithRegex("2 saree 3000"), [
    { quantity: 2, unit: null, product: "Saree", price: 3000 },
  ]);
});

test("splits multiple items on 'aur' and keeps each price", () => {
  assert.deepStrictEqual(parseWithRegex("5 shirt 500 aur 2 pant 800"), [
    { quantity: 5, unit: null, product: "Shirt", price: 500 },
    { quantity: 2, unit: null, product: "Pant", price: 800 },
  ]);
});

test("returns price: null rather than guessing when no price was spoken", () => {
  assert.deepStrictEqual(parseWithRegex("2 red shirt aur 3 kurti"), [
    { quantity: 2, unit: null, product: "Red Shirt", price: null },
    { quantity: 3, unit: null, product: "Kurti", price: null },
  ]);
});

// --- Regression tests: spoken number-words ---------------------------------
// Before hindiNumbers.js was wired into the parser, these produced garbage —
// romanized input latched onto the price as the quantity and dropped the
// product name ("Item"), and Devanagari threw outright. Real transactions with
// quantity: 600 and product_name: "।" got saved to data.json this way.

test("romanized Hindi number-words become quantities, not products", () => {
  assert.deepStrictEqual(
    parseWithRegex("do shirt 500 rupaye aur teen pant 800 rupaye"),
    [
      { quantity: 2, unit: null, product: "Shirt", price: 500 },
      { quantity: 3, unit: null, product: "Pant", price: 800 },
    ]
  );
});

test("Devanagari number-words parse instead of throwing", () => {
  // Also pins down that polite filler ("मुझे" — "give me") stays out of the
  // product name. The parser reads the words on BOTH sides of the count so that
  // "namak 2 kilo" works, and the trailing side has to win here.
  assert.deepStrictEqual(
    parseWithRegex("मुझे पाँच साड़ी तीन सौ रुपये और चार धोती"),
    [
      { quantity: 5, unit: null, product: "साड़ी", price: 300 },
      { quantity: 4, unit: null, product: "धोती", price: null },
    ]
  );
});

test("compound spoken prices ('paanch sau' = 500) resolve correctly", () => {
  assert.deepStrictEqual(parseWithRegex("पाँच शर्ट पाँच सौ रुपये"), [
    { quantity: 5, unit: null, product: "शर्ट", price: 500 },
  ]);
});

test("throws a usable message when there is no quantity at all", () => {
  assert.throws(() => parseWithRegex("shirt"), /Couldn't find a quantity/);
});

// --- Regression tests: price-first phrasing ("₹2 की मिर्च") -----------------
// This shape crashed the whole sentence with: Couldn't find a quantity in "₹".
// The chunk splitter treated ₹ like रुपये and cut AFTER it, but ₹ is written
// before its amount, so "₹2" became the chunk "₹" (no digits) plus "2".
// Underneath sat a second bug: even split correctly, "₹2 की मिर्च" read as
// quantity 2 of a product literally named "की मिर्च".

test("₹ before the amount is a price, not a quantity", () => {
  assert.deepStrictEqual(parseWithRegex("₹300 की साड़ी"), [
    { quantity: 1, unit: null, product: "साड़ी", price: 300 },
  ]);
});

test("the exact sentence from the bug report parses into three items", () => {
  assert.deepStrictEqual(parseWithRegex("₹2 की मिर्च, ₹5 का समोसा और ₹10 की भिंडी।"), [
    { quantity: 1, unit: null, product: "मिर्च", price: 2 },
    { quantity: 1, unit: null, product: "समोसा", price: 5 },
    { quantity: 1, unit: null, product: "भिंडी", price: 10 },
  ]);
});

test("price-first items split even without a comma or 'aur'", () => {
  // Shopkeepers rattle these off back to back. The ₹ itself has to act as the
  // boundary, since there's no separator word to split on.
  assert.deepStrictEqual(parseWithRegex("₹2 की मिर्च ₹5 का समोसा"), [
    { quantity: 1, unit: null, product: "मिर्च", price: 2 },
    { quantity: 1, unit: null, product: "समोसा", price: 5 },
  ]);
});

test("the postposition alone marks a price, with no ₹ typed", () => {
  // Voice input never contains "₹" — Sarvam transcribes the words only.
  assert.deepStrictEqual(parseWithRegex("10 का समोसा"), [
    { quantity: 1, unit: null, product: "समोसा", price: 10 },
  ]);
});

test("quantity-first phrasing still wins when a price trails the product", () => {
  // "5 साड़ी ₹300" is five sarees at ₹300, NOT ₹5 worth. Splitting on every ₹
  // would have broken this into a nonsense second item.
  assert.deepStrictEqual(parseWithRegex("5 साड़ी ₹300"), [
    { quantity: 5, unit: null, product: "साड़ी", price: 300 },
  ]);
});

test("products that merely start like a postposition stay intact", () => {
  // का/के/की are whole words. "काजू" and "kela" only BEGIN with those letters,
  // and misreading them would turn a count into a price — "2 काजू" would become
  // one lot of cashews costing ₹2, and "3 kela" would bill a product named "La".
  assert.deepStrictEqual(parseWithRegex("2 काजू"), [
    { quantity: 2, unit: null, product: "काजू", price: null },
  ]);
  assert.deepStrictEqual(parseWithRegex("3 kela"), [
    { quantity: 3, unit: null, product: "Kela", price: null },
  ]);
  // The sharp one: here the price IS ₹50, so the leftover words go through the
  // postposition-stripping path. Without a whole-word check the leading "ki" of
  // "kilo" gets eaten and the bill reads "Lo Aam".
  assert.deepStrictEqual(parseWithRegex("₹50 kilo aam"), [
    { quantity: 1, unit: "kilo", product: "Aam", price: 50 },
  ]);
});

// --- Free word order -------------------------------------------------------
// The shopkeeper says the parts in whatever order comes out: price first or
// last, product before or after the count, unit anywhere. Each group below must
// produce the SAME item however it was phrased — that is the whole point.

test("the unit of measure is its own field, not part of the product name", () => {
  // "5 kilo aam" used to bill a product literally named "Kilo Aam", which then
  // printed as a distinct line item from plain "Aam" bought the day before.
  assert.deepStrictEqual(parseWithRegex("5 kilo aam"), [
    { quantity: 5, unit: "kilo", product: "Aam", price: null },
  ]);
  assert.deepStrictEqual(parseWithRegex("2 dozen kela"), [
    { quantity: 2, unit: "dozen", product: "Kela", price: null },
  ]);
  assert.deepStrictEqual(parseWithRegex("2 पैकेट बिस्कुट"), [
    { quantity: 2, unit: "पैकेट", product: "बिस्कुट", price: null },
  ]);
});

test("unit abbreviations normalise, but Devanagari units stay as spoken", () => {
  // "kg" and "kilo" are the same shelf, so they must not become two rows on a
  // bill. Devanagari maps to itself instead of to Latin: a Hindi bill reading
  // "2 किलो आम" is right, "2 kilo आम" is a half-translated mess.
  assert.deepStrictEqual(parseWithRegex("3 kg aam ₹60"), [
    { quantity: 3, unit: "kilo", product: "Aam", price: 60 },
  ]);
  assert.deepStrictEqual(parseWithRegex("2 किलो आम ₹60"), [
    { quantity: 2, unit: "किलो", product: "आम", price: 60 },
  ]);
});

test("quantity, unit, product and price parse the same in any order", () => {
  const expected = [{ quantity: 2, unit: "kilo", product: "Aam", price: 60 }];
  for (const sentence of [
    "2 kilo aam ₹60", // count, unit, name, price
    "aam 2 kilo ₹60", // name first — the shape the positional parser dropped
    "2 kilo aam 60 rupaye", // currency word instead of ₹
    "aam ₹60 2 kilo", // price in the middle
    "kilo 2 aam ₹60", // unit before the count
    "₹60 kilo 2 kilo aam", // rate stated up front, unit said twice
  ]) {
    assert.deepStrictEqual(parseWithRegex(sentence), expected, sentence);
  }
});

test("a product named before its price parses like one named after", () => {
  // "मिर्च ₹2 की" and "₹2 की मिर्च" are both "two rupees' worth of chilli".
  // The first used to come out as quantity 2 of a product named "Item".
  const expected = [{ quantity: 1, unit: null, product: "मिर्च", price: 2 }];
  assert.deepStrictEqual(parseWithRegex("₹2 की मिर्च"), expected);
  assert.deepStrictEqual(parseWithRegex("मिर्च ₹2 की"), expected);
});

test("two product-first price mentions back to back stay separate items", () => {
  // Both names sit BEFORE their price here, so the item boundary has to fall
  // after each "₹… की" group. Cutting on the wrong side glued the names together
  // into one item called "मिर्च भिंडी" and left the second item as "Item".
  assert.deepStrictEqual(parseWithRegex("मिर्च ₹2 की भिंडी ₹10 की"), [
    { quantity: 1, unit: null, product: "मिर्च", price: 2 },
    { quantity: 1, unit: null, product: "भिंडी", price: 10 },
  ]);
});

test("the product name is found whichever side of the count it sits on", () => {
  assert.deepStrictEqual(parseWithRegex("3 packet biscuit ₹20"), [
    { quantity: 3, unit: "packet", product: "Biscuit", price: 20 },
  ]);
  assert.deepStrictEqual(parseWithRegex("biscuit 3 packet ₹20"), [
    { quantity: 3, unit: "packet", product: "Biscuit", price: 20 },
  ]);
  assert.deepStrictEqual(parseWithRegex("namak 2 kilo ₹50"), [
    { quantity: 2, unit: "kilo", product: "Namak", price: 50 },
  ]);
});

test("price is per-unit, so quantity × price is the line total", () => {
  // Confirmed with the shop owner: "₹50 ka 2 kilo namak" is ₹50 PER KILO — the
  // bill total is ₹100, not ₹50. Shopkeepers quote rates, not lot totals, so
  // reading this as a total would undercharge every weighed sale.
  const expected = [{ quantity: 2, unit: "kilo", product: "Namak", price: 50 }];
  assert.deepStrictEqual(parseWithRegex("₹50 ka 2 kilo namak"), expected);
  assert.deepStrictEqual(parseWithRegex("₹50 का 2 किलो नमक"), [
    { quantity: 2, unit: "किलो", product: "नमक", price: 50 },
  ]);

  // The owner's own multi-item example: ₹300 + (2 × ₹400) = ₹1100.
  const items = parseWithRegex(
    "1 banarasi saree 300 rupaye 2 black banarasi saree 400 rupaye"
  );
  assert.deepStrictEqual(items, [
    { quantity: 1, unit: null, product: "Banarasi Saree", price: 300 },
    { quantity: 2, unit: null, product: "Black Banarasi Saree", price: 400 },
  ]);
  assert.strictEqual(
    items.reduce((sum, i) => sum + i.quantity * i.price, 0),
    1100
  );
});

test("the regex parser keeps brand words but not their position", () => {
  // Documented limitation, not an aspiration: telling a brand from a product
  // name needs knowledge a regex doesn't have, so a brand spoken last STAYS
  // last. Only parseWithLLM normalises this (see itemsFromLLMJson's brand
  // handling below). Both forms still get the right count, unit and price —
  // which is what the money on the bill depends on.
  assert.deepStrictEqual(parseWithRegex("Tata namak 2 packet ₹25"), [
    { quantity: 2, unit: "packet", product: "Tata Namak", price: 25 },
  ]);
  assert.deepStrictEqual(parseWithRegex("namak Tata 2 packet ₹25"), [
    { quantity: 2, unit: "packet", product: "Namak Tata", price: 25 },
  ]);
});

// --- LLM response handling -------------------------------------------------
// Gemini constrains its reply to a schema, so these test our own normalisation
// of that reply — not the model. The stakes: anything that slips through here
// goes straight into line_total and onto a customer's bill. Every failure case
// throws, which makes parseSaleItems fall back to the regex parser.

test("reads a well-formed LLM reply into items", () => {
  const raw = JSON.stringify({
    items: [
      { quantity: 5, product: "साड़ी", price: 300 },
      { quantity: 1, product: "मिर्च", price: 2 },
    ],
  });
  assert.deepStrictEqual(itemsFromLLMJson(raw), [
    { quantity: 5, unit: null, product: "साड़ी", price: 300 },
    { quantity: 1, unit: null, product: "मिर्च", price: 2 },
  ]);
});

test("brand and unit come back as separate fields", () => {
  // The model reports the brand separately precisely so that word order stops
  // mattering: "Tata namak" and "namak Tata" both arrive as brand "Tata" +
  // product "Namak", and we compose brand-first so the bill reads the same way.
  const raw = JSON.stringify({
    items: [{ quantity: 2, unit: "packet", brand: "Tata", product: "Namak", price: 25 }],
  });
  assert.deepStrictEqual(itemsFromLLMJson(raw), [
    { quantity: 2, unit: "packet", product: "Tata Namak", price: 25 },
  ]);
});

test("a blank or absent brand doesn't leave a leading space in the name", () => {
  const blank = JSON.stringify({ items: [{ quantity: 1, brand: "   ", product: "Aam" }] });
  assert.strictEqual(itemsFromLLMJson(blank)[0].product, "Aam");
});

test("an omitted unit becomes null so every item has the same shape", () => {
  const raw = JSON.stringify({ items: [{ quantity: 3, product: "Kurti", unit: "  " }] });
  assert.strictEqual(itemsFromLLMJson(raw)[0].unit, null);
});

test("the LLM's unit is normalised through the same table as the regex parser", () => {
  // Whichever parser handled the sentence, "kg" has to bill as "kilo" — two
  // spellings of one unit on the same bill looks like a broken shop.
  const raw = JSON.stringify({
    items: [
      { quantity: 2, product: "Aam", unit: "KG" },
      { quantity: 1, product: "Dahi", unit: "किलो" },
      { quantity: 4, product: "Biscuit", unit: "pkts" },
    ],
  });
  assert.deepStrictEqual(
    itemsFromLLMJson(raw).map((i) => i.unit),
    ["kilo", "किलो", "packet"]
  );
});

test("a unit with the model's reasoning fused into it is dropped, not printed", () => {
  // Not hypothetical: these two are verbatim from live gemini-3.7-flash replies.
  // The schema now pins `unit` to an enum so they shouldn't reach us at all, but
  // a bill is the wrong place to find out the model ignored the enum. Dropping
  // to null costs only the word "kilo" on the bill; printing it costs trust.
  const junk = JSON.stringify({
    items: [
      { quantity: 2, product: "Aam", unit: "kiloShort/kilo/etc", price: 60 },
      { quantity: 1, product: "Namak", unit: "packetComponent", price: 25 },
    ],
  });
  const items = itemsFromLLMJson(junk);
  assert.deepStrictEqual(
    items.map((i) => i.unit),
    [null, null]
  );
  // The rest of the item must survive — the quantity and price are still right,
  // and throwing the whole reply away would drop the sale to the regex parser.
  assert.strictEqual(items[0].quantity, 2);
  assert.strictEqual(items[0].price, 60);
});

test("a real unit we simply haven't listed still comes through", () => {
  // The junk filter is shaped ("one short word of letters"), not a whitelist, so
  // grain sold by the quintal doesn't lose its unit just because the alias table
  // never mentioned it.
  const raw = JSON.stringify({ items: [{ quantity: 2, product: "Gehu", unit: "quintal" }] });
  assert.strictEqual(itemsFromLLMJson(raw)[0].unit, "quintal");
});

test("an omitted price becomes null rather than 0", () => {
  // The schema leaves price out when no price was spoken. It must arrive as null
  // so the app still asks the owner for it — 0 would silently bill a free item.
  const raw = JSON.stringify({ items: [{ quantity: 3, product: "Kurti" }] });
  assert.deepStrictEqual(itemsFromLLMJson(raw), [
    { quantity: 3, unit: null, product: "Kurti", price: null },
  ]);
});

test("an explicit null price is also accepted", () => {
  const raw = JSON.stringify({ items: [{ quantity: 3, product: "Kurti", price: null }] });
  assert.strictEqual(itemsFromLLMJson(raw)[0].price, null);
});

test("numeric strings are coerced, junk is rejected", () => {
  const ok = JSON.stringify({ items: [{ quantity: "2", product: "Pant", price: "800" }] });
  assert.deepStrictEqual(itemsFromLLMJson(ok), [
    { quantity: 2, unit: null, product: "Pant", price: 800 },
  ]);

  const junkPrice = JSON.stringify({ items: [{ quantity: 2, product: "Pant", price: "aath sau" }] });
  assert.throws(() => itemsFromLLMJson(junkPrice), /unusable price/);
});

test("rejects a reply with no usable quantity or product", () => {
  assert.throws(
    () => itemsFromLLMJson(JSON.stringify({ items: [{ quantity: 0, product: "Pant" }] })),
    /unusable quantity/
  );
  assert.throws(
    () => itemsFromLLMJson(JSON.stringify({ items: [{ quantity: 2, product: "  " }] })),
    /no product name/
  );
});

test("rejects empty, non-JSON and item-less replies", () => {
  assert.throws(() => itemsFromLLMJson(""), /empty response/);
  assert.throws(() => itemsFromLLMJson(undefined), /empty response/);
  assert.throws(() => itemsFromLLMJson("Sure! Here are the items:"), /valid JSON/);
  assert.throws(() => itemsFromLLMJson(JSON.stringify({ items: [] })), /No items found/);
});

// --- hindiNumbers unit tests ----------------------------------------------

test("converts standalone number-words to digits", () => {
  assert.strictEqual(convertHindiNumbersToDigits("पाँच"), "5");
  assert.strictEqual(convertHindiNumbersToDigits("do"), "2");
  assert.strictEqual(convertHindiNumbersToDigits("teen"), "3");
});

test("combines multiplier phrases", () => {
  assert.strictEqual(convertHindiNumbersToDigits("तीन सौ"), "300");
  assert.strictEqual(convertHindiNumbersToDigits("paanch sau"), "500");
  assert.strictEqual(convertHindiNumbersToDigits("do hazaar"), "2000");
});

test("handles compound tens", () => {
  assert.strictEqual(convertHindiNumbersToDigits("पच्चीस"), "25");
  assert.strictEqual(convertHindiNumbersToDigits("निन्यानवे"), "99");
});

test("leaves non-number words untouched", () => {
  assert.strictEqual(convertHindiNumbersToDigits("shirt pant"), "shirt pant");
  assert.strictEqual(
    convertHindiNumbersToDigits("do shirt aur teen pant"),
    "2 shirt aur 3 pant"
  );
});

test("unit words that start like a number-word survive conversion", () => {
  // "dozen"/"darjan" start with "do" (2) and "das" (10). Converting a prefix
  // would leave "2zen", stripping the unit and mangling the count.
  assert.strictEqual(convertHindiNumbersToDigits("2 dozen kela"), "2 dozen kela");
  assert.strictEqual(convertHindiNumbersToDigits("teen darjan"), "3 darjan");
});

test("leaves digits that are already digits alone", () => {
  assert.strictEqual(
    convertHindiNumbersToDigits("5 white shirt 500 rupaye"),
    "5 white shirt 500 rupaye"
  );
});
