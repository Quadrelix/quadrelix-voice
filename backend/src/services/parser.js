// Converts a spoken/typed sentence — possibly with MULTIPLE items in one
// sentence, e.g. "2 red shirt aur 3 kurti" — into an array of items:
//   [{ quantity, unit, product, price }, ...]
//
// `price` is always a PER-UNIT price, so the caller can rely on
// line_total = quantity * price. "₹50 ka 2 kilo namak" is ₹50 per kilo (₹100),
// not ₹50 total. Shop owners quote rates, not lot totals.
//
// `unit` is the unit of measure when one was spoken ("kilo", "packet", "dozen")
// and null otherwise. It is kept OUT of the product name so the bill reads
// "Aam | 2 kilo" instead of "Kilo Aam | 2".
//
// price may come back as `null` if the sentence didn't mention it for that
// item (e.g. "2 red shirt aur 3 kurti" has no prices at all) — the caller
// is responsible for asking the owner to fill in any missing prices before
// saving, since we never want to silently guess a price.
//
// Two modes:
//   1. parseWithRegex()  -> offline fallback, no API key needed. First turns
//      spoken number-words into digits ("do"/"दो" -> 2, "teen sau" -> 300),
//      splits on "and"/"aur"/",", then reads each piece WITHOUT relying on
//      word order: it looks for a number that is *marked* as money (see
//      PRICE_MARKED) wherever it sits, and treats whatever is left as the
//      quantity, unit and product name. That is what makes all of these land
//      the same way:
//        "2 kilo aam ₹60"  "aam 2 kilo ₹60"  "₹60 kilo 2 kilo aam"
//        "₹2 की मिर्च"      "मिर्च ₹2 की"
//      Only when no money marker exists at all does it fall back to reading by
//      position (first number = quantity, last = price), which is what handles
//      "2 saree 3000".
//      The number-word step is what makes voice input usable without an LLM:
//      Sarvam transcribes "पाँच" as a word, not a digit, and without converting
//      it the regexes below would either throw or latch onto the wrong number.
//      Word order it CANNOT fix: a brand spoken after the product ("namak Tata")
//      stays in that order, because telling a brand from a product name needs
//      knowledge the regex doesn't have. That is the LLM's job.
//   2. parseWithLLM()    -> calls the Gemini API. Far better at genuinely free
//      word order — it also normalises brand position ("namak Tata" ->
//      "Tata Namak") and picks the unit out of any position.
//      Requires GEMINI_API_KEY in .env.
//
// parseSaleItems() tries the LLM first (if a key is configured), and falls
// back to the regex parser otherwise.

const { GoogleGenAI } = require("@google/genai");
const { convertHindiNumbersToDigits } = require("./hindiNumbers");

// Currency words that FOLLOW their amount ("500 रुपये"). Deliberately excludes
// ₹, which precedes it — see splitIntoChunks.
//
// Kept as a source string as well as a regex because PRICE_MARKED embeds it:
// "500 रुपये" is one of the three ways a number gets marked as money, so the
// same vocabulary has to be usable inside a larger pattern.
const CURRENCY_AFTER_SRC = "रुपये|रुपए|रूपये|rupaye|rupees|(?<![a-z])rs\\.?(?![a-z])";
const CURRENCY_AFTER = new RegExp(CURRENCY_AFTER_SRC, "gi");

// "₹2 की मिर्च" = "two rupees' worth of chilli". Very common for loose veg and
// snacks, where the shopkeeper names the money, not a count. The postposition
// (की/का/के) is grammar, never part of the product name.
//
// Followed by (?=\s|$) rather than \b everywhere it's used: \b is defined on
// [A-Za-z0-9_], so there is no word boundary after a Devanagari syllable and
// \b silently never matches "की". The lookahead also stops "ki" matching inside
// "kilo", which would turn a quantity into a price.
const WORTH_OF = "की|का|के|ki|ka|ke";
const WORTH_OF_END = "(?=\\s|$)";

// Units of measure, mapped alias -> canonical form so "kg", "kilos" and
// "kilogram" all bill as "kilo". Devanagari units map to themselves: a bill for
// a Hindi-speaking shop reads better as "2 किलो आम" than "2 kilo आम", and the
// product name already keeps whatever script was spoken.
//
// Bare single letters ("g", "l", "m") are deliberately NOT here — they would
// match inside product names and silently strip a word off the name.
const UNIT_ALIASES = {
  kilo: ["kilo", "kilos", "kg", "kgs", "kilogram", "kilograms"],
  gram: ["gram", "grams", "gm", "gms"],
  litre: ["litre", "litres", "liter", "liters", "ltr"],
  packet: ["packet", "packets", "pkt", "pkts"],
  dozen: ["dozen", "dozens", "darjan"],
  piece: ["piece", "pieces", "pcs", "pc"],
  bottle: ["bottle", "bottles"],
  box: ["box", "boxes", "dabba"],
  meter: ["meter", "meters", "metre", "metres"],
  plate: ["plate", "plates"],
  किलो: ["किलो"],
  ग्राम: ["ग्राम"],
  लीटर: ["लीटर"],
  पैकेट: ["पैकेट"],
  दर्जन: ["दर्जन"],
  पीस: ["पीस"],
  नग: ["नग"],
  बोतल: ["बोतल"],
  डिब्बा: ["डिब्बा"],
  मीटर: ["मीटर"],
  प्लेट: ["प्लेट"],
};

const UNIT_LOOKUP = new Map();
for (const [canonical, aliases] of Object.entries(UNIT_ALIASES)) {
  for (const alias of aliases) UNIT_LOOKUP.set(alias, canonical);
}

const CANONICAL_UNITS = Object.keys(UNIT_ALIASES);

// Cleans up a unit that came from the LLM. Needed because the model sometimes
// appends commentary to this field instead of just answering it — real replies
// have included "kiloShort/kilo/etc" and "packetComponent", which would have
// printed verbatim in the Qty column of a customer's bill.
//
// A known alias normalises as usual. Anything else is only kept if it still
// LOOKS like a unit — one short run of letters — and is otherwise dropped to
// null. Dropping it loses nothing important (the bill just reads "2" instead of
// "2 kilo") whereas printing junk makes the shop look broken. The letters-only
// escape hatch means a legitimate unit we simply haven't listed, like "quintal",
// still comes through.
function normalizeUnit(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const canonical = UNIT_LOOKUP.get(trimmed.toLowerCase());
  if (canonical) return canonical;
  return /^\p{L}{1,10}$/u.test(trimmed) ? trimmed : null;
}

// The heart of the word-order-independent parsing: a number that is *marked* as
// money rather than as a count. Three markers, any of which can appear anywhere
// in the sentence:
//   ₹ before the number        "₹2",  "2 kilo aam ₹60"
//   a postposition after it    "2 की", "मिर्च ₹2 की"
//   a currency word after it   "300 रुपये"
// Whichever number carries a marker is the price; everything else in the chunk
// is quantity/unit/product, so the shopkeeper can say the parts in any order.
const PRICE_MARKED = new RegExp(
  "₹\\s*(\\d+(?:\\.\\d+)?)" +
    `|(\\d+(?:\\.\\d+)?)\\s*(?:(?:${WORTH_OF})${WORTH_OF_END}|(?:${CURRENCY_AFTER_SRC}))`,
  "i"
);

// Standalone की/का/के are pure grammar and never part of a product name. Only
// whole words are removed, so "काजू" and "kela" (which merely START with those
// letters) survive intact.
const POSTPOSITION_WORD = new RegExp(`(?:^|\\s)(?:${WORTH_OF})${WORTH_OF_END}`, "gi");

// A "₹<amount> <postposition>" group — "₹2 की", "₹300 का". This is the price
// mention that carries no trailing currency word, so splitIntoChunks has to
// place item boundaries around it by hand.
const RUPEE_WORTH_GROUP = new RegExp(
  `₹\\s*\\d+(?:\\.\\d+)?\\s*(?:${WORTH_OF})${WORTH_OF_END}`,
  "gi"
);

// Conjunctions that separate items. Also stripped from the ENDS of a finished
// chunk: a ||| boundary inserted right before " aur " swallows the space the
// split pattern needs, leaving "aur" stuck to the next item's name ("Aur Pant").
const SEPARATOR_WORD = "and|aur|और";

function splitIntoChunks(text) {
  // Items spoken back-to-back without "and/aur" still need separating —
  // treat the end of a price mention (rupaye/rupees/rs) as a natural
  // boundary too, since that's where one item's price ends and the next
  // item's quantity typically begins.
  //
  // ₹ is NOT in that list. It is written before its amount, so it marks where a
  // price STARTS, not where one ends: putting the boundary after it split "₹2"
  // into a lone "₹" chunk with no digits, which threw "Couldn't find a quantity
  // in ₹" and killed the whole sentence.
  let withBoundaries = text.replace(CURRENCY_AFTER, "$&|||");

  // For "₹<amount> की" groups the boundary side depends on which order the
  // shopkeeper is speaking in, and the two orders want OPPOSITE cuts:
  //   price first   "₹2 की मिर्च ₹5 का समोसा"  -> cut BEFORE each group
  //   product first "मिर्च ₹2 की भिंडी ₹10 की"  -> cut AFTER  each group
  // A name sitting between two price groups is genuinely ambiguous — it could
  // belong to either — so the shape is decided ONCE from the first group and
  // applied to the whole sentence. People don't usually flip order mid-sentence,
  // and guessing per-group produced chunks like "₹2 की मिर्च ₹5 का" + "समोसा".
  const firstGroup = withBoundaries.match(RUPEE_WORTH_GROUP);
  if (firstGroup) {
    const firstIndex = withBoundaries.indexOf(firstGroup[0]);
    const productFirst = hasProductName(withBoundaries.slice(0, firstIndex));
    withBoundaries = withBoundaries.replace(RUPEE_WORTH_GROUP, (match) =>
      productFirst ? `${match}|||` : `|||${match}`
    );
  }

  return withBoundaries
    .split(new RegExp(`\\s+(?:${SEPARATOR_WORD})\\s+|[,।]\\s*|\\|\\|\\|\\s*`, "gi"))
    .map((s) =>
      s
        .trim()
        .replace(new RegExp(`^(?:${SEPARATOR_WORD})\\s+`, "i"), "")
        .replace(new RegExp(`\\s+(?:${SEPARATOR_WORD})$`, "i"), "")
        .trim()
    )
    .filter(Boolean);
}

// True if `text` holds anything that could be a product name — i.e. a word left
// over once digits, ₹ and the grammar postpositions are taken out.
function hasProductName(text) {
  return /\S/.test(
    text
      .replace(/[\d₹.,|]/g, " ")
      .replace(POSTPOSITION_WORD, " ")
  );
}

// Pulls the unit of measure out of a run of words, wherever it sits. Returns the
// canonical unit plus the words with EVERY unit token removed — "₹60 kilo 2 kilo
// aam" mentions the unit twice (once as a rate, once as a quantity) and leaving
// the second one behind would bill a product literally named "Kilo Aam".
function extractUnit(text) {
  let unit = null;
  const kept = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const canonical = UNIT_LOOKUP.get(word.toLowerCase());
    if (canonical) {
      unit ??= canonical;
      continue;
    }
    kept.push(word);
  }
  return { unit, rest: kept.join(" ") };
}

function stripPostpositions(text) {
  return text.replace(POSTPOSITION_WORD, " ");
}

// Handles every chunk where some number is explicitly marked as money, which is
// what makes word order irrelevant: "2 kilo aam ₹60", "aam 2 kilo ₹60" and
// "₹60 kilo 2 kilo aam" all come out identical. Returns null when nothing is
// marked, so the positional path below still handles "2 saree 3000".
function parseMarkedChunk(text) {
  const marked = text.match(PRICE_MARKED);
  if (!marked) return null;

  // Group 1 is the "₹ before" form, group 2 the "postposition/currency after" form.
  const price = Number(marked[1] ?? marked[2]);
  if (!Number.isFinite(price)) return null;

  // Cut the whole price expression out. Whatever remains is quantity + unit +
  // product, in whatever order it was spoken.
  const rest = `${text.slice(0, marked.index)} ${text.slice(marked.index + marked[0].length)}`
    .replace(/₹/g, " ");

  // The first number left over is the count. None left means the shopkeeper
  // named money instead of a count ("₹2 की मिर्च"), which is one lot of it —
  // quantity 1 keeps quantity * price equal to what they actually said.
  const quantityMatch = rest.match(/\d+(?:\.\d+)?/);
  const quantity = quantityMatch ? Number(quantityMatch[0]) : 1;

  let unit;
  let product;
  if (quantityMatch) {
    const after = extractUnit(
      stripPostpositions(rest.slice(quantityMatch.index + quantityMatch[0].length))
    );
    const before = extractUnit(stripPostpositions(rest.slice(0, quantityMatch.index)));

    // The unit is read from BOTH sides, so it can sit anywhere. Safe to do
    // blindly: a unit word is never a product name.
    unit = after.unit ?? before.unit;

    // The name, however, normally FOLLOWS the count ("2 kilo aam"), and only
    // sits in front when nothing usable is left behind it ("namak 2 kilo" — the
    // shape the old positional parser dropped on the floor). Preferring the
    // trailing side also keeps polite filler out of the name: "मुझे 5 साड़ी 300
    // रुपये" is "साड़ी", not "मुझे साड़ी".
    product = tidyProduct(after.rest) || tidyProduct(before.rest);
  } else {
    const all = extractUnit(stripPostpositions(rest));
    unit = all.unit;
    product = tidyProduct(all.rest);
  }
  if (!product) return null; // nothing left that could be a product name

  return capitalize({ quantity, unit, product, price });
}

function tidyProduct(raw) {
  return raw
    .replace(/₹/g, " ")
    .replace(new RegExp(`^(?:${WORTH_OF})${WORTH_OF_END}\\s*`, "i"), "")
    .replace(/^(of|x)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseChunkWithRegex(chunk) {
  const lowered = chunk.toLowerCase();

  // Try the marked-money path first, on the text with ₹ and currency words still
  // intact — those symbols ARE the signal that a number is a price not a count.
  const marked = parseMarkedChunk(lowered);
  if (marked) return marked;

  // Nothing marked, so fall back to reading by position.
  const cleaned = lowered
    .replace(CURRENCY_AFTER, " ")
    .replace(/₹/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const numbers = cleaned.match(/\d+(\.\d+)?/g);

  if (!numbers || numbers.length === 0) {
    throw new Error(`Couldn't find a quantity in "${chunk}"`);
  }

  const quantity = Number(numbers[0]);
  // price only present if there's a SECOND number in this chunk
  const price = numbers.length >= 2 ? Number(numbers[numbers.length - 1]) : null;

  const firstNumIndex = cleaned.indexOf(numbers[0]);
  let productEnd = cleaned.length;
  if (numbers.length >= 2) {
    productEnd = cleaned.lastIndexOf(numbers[numbers.length - 1]);
  }

  const between = extractUnit(cleaned.slice(firstNumIndex + numbers[0].length, productEnd));
  let product = tidyProduct(between.rest);
  // "namak 2 kilo" puts the name BEFORE the number, so when nothing usable sits
  // between the numbers, look in front of the first one.
  if (!product) product = tidyProduct(extractUnit(cleaned.slice(0, firstNumIndex)).rest);
  if (!product) product = "item";

  return capitalize({ quantity, unit: between.unit, product, price });
}

// Only affects Latin names; \w doesn't match Devanagari, so Hindi passes through.
function capitalize(item) {
  return { ...item, product: item.product.replace(/\b\w/g, (c) => c.toUpperCase()) };
}

function parseWithRegex(text) {
  // Spoken numbers arrive as words ("do shirt paanch sau rupaye") — turn them
  // into digits before anything else tries to read a quantity or price.
  const chunks = splitIntoChunks(convertHindiNumbersToDigits(text));
  if (chunks.length === 0) throw new Error("Couldn't understand that sentence");
  return chunks.map(parseChunkWithRegex);
}

// A "lite" Flash model on purpose. This is a one-sentence extraction task, and
// the bigger thinking models are the wrong trade here: measured on a real key,
// gemini-3.7-flash took 33-45s per call (it emits a reasoning step first) and
// its free tier allows only 20 requests A DAY — a shopkeeper would hit the wall
// after 20 sales and wait most of a minute for each one. Override with
// GEMINI_MODEL in .env if you want to compare.
const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";

// Gemini validates its own reply against this schema before returning it, so we
// get JSON in exactly this shape instead of fishing a {...} blob out of prose.
//
// `price`, `unit` and `brand` are deliberately absent from `required`: the model
// omits a field when the shopkeeper never said it, and a missing price has to
// STAY missing — guessing one would print a wrong number on a real customer's
// bill. Absence is how nullability is expressed here because this schema dialect
// is an OpenAPI subset, which has no null-union types.
const ITEMS_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      description: "One entry per product mentioned, in the order it was spoken.",
      items: {
        type: "object",
        properties: {
          quantity: {
            type: "number",
            description:
              "How many units. Use 1 when the shopkeeper named an amount of money instead of a count.",
          },
          // Constrained to an enum, not free text, because free text is where
          // this model misbehaves: live replies have come back with the answer
          // and its reasoning fused together ("kiloShort/kilo/etc"), which would
          // have printed straight into the Qty column of a bill. An enum makes
          // that shape impossible on the wire, and since `unit` is optional the
          // model can still omit it rather than force a wrong match.
          unit: {
            type: "string",
            enum: CANONICAL_UNITS,
            description:
              "Unit of measure if one was spoken. Use the Devanagari value when it was spoken in Devanagari. Omit entirely if the shopkeeper just counted items.",
          },
          brand: {
            type: "string",
            description:
              "Brand name if one was spoken (Tata, Amul, Parle, Nestle...), no matter where in the sentence it appeared. Omit if no brand was named.",
          },
          product: {
            type: "string",
            description:
              "Product name WITHOUT the brand, the unit, digits, currency symbols, or postpositions (की/का/के). Keep descriptive words that are part of the name, like colour or fabric ('black banarasi saree').",
          },
          price: {
            type: "number",
            description:
              "Price PER UNIT in INR, never the line total. Omit this field entirely if no price was spoken for this item.",
          },
        },
        required: ["quantity", "product"],
      },
    },
  },
  required: ["items"],
};

function buildPrompt(text) {
  return `You extract sale items from what an Indian shopkeeper just said, so a bill can be printed. The sentence may be Hindi, English or Hinglish, and may list several products at once joined by "and"/"aur"/comma — or by nothing at all.

The shopkeeper speaks in ANY word order. Quantity, unit, brand, product and price can each come first, last or in the middle. Your job is to work out which number is a count and which is money, and to pull the brand and unit out of the product name — regardless of where they sat in the sentence.

These pairs must produce IDENTICAL output:
  "2 kilo aam ₹60"            = "aam 2 kilo ₹60"            -> quantity 2, unit kilo, product "Aam", price 60
  "₹2 की मिर्च"                = "मिर्च ₹2 की"                -> quantity 1, product "मिर्च", price 2
  "Tata namak 2 packet ₹25"   = "namak Tata 2 packet ₹25"   -> quantity 2, unit packet, brand "Tata", product "Namak", price 25
  "3 dozen kela 50 rupaye"    = "kela 50 rupaye 3 dozen"    -> quantity 3, unit dozen, product "Kela", price 50

CRITICAL — price is always PER UNIT, never a lot total:
  "₹50 ka 2 kilo namak"  -> quantity 2, unit kilo, price 50   (₹50 per kilo, the bill total will be ₹100)
  "5 shirt 500 rupaye"   -> quantity 5, price 500             (₹500 each, total ₹2500)
When the shopkeeper names money with no count at all ("₹2 की मिर्च" = two rupees' worth of chilli), that is one lot: quantity 1, price 2. This is normal for loose vegetables and snacks. Never read the 2 in "₹2 की" as a quantity.

Other rules:
- If no price was spoken for an item, omit the price field. Do NOT guess, default or copy another item's price.
- की/का/के are grammar. They never belong in the product name.
- Keep descriptive words that are genuinely part of the name (colour, fabric, variety): "black banarasi saree".
- Report the unit in the same script it was spoken: "kilo" for "kilo"/"kg", "किलो" for "किलो".

Worked multi-item example:
  "1 banarasi saree 300 rupaye 2 black banarasi saree 400 rupaye"
  -> [{quantity: 1, product: "Banarasi Saree", price: 300}, {quantity: 2, product: "Black Banarasi Saree", price: 400}]

Sentence: "${text}"`;
}

// Split out from the network call so the response handling is testable without an
// API key. Throws rather than returning junk — parseSaleItems catches that and
// falls back to the regex parser, which is better than saving a bogus bill.
function itemsFromLLMJson(raw) {
  if (!raw || !raw.trim()) throw new Error("LLM returned an empty response");

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("LLM did not return valid JSON");
  }

  if (!Array.isArray(parsed.items) || parsed.items.length === 0) {
    throw new Error("No items found in that sentence");
  }

  return parsed.items.map((item) => {
    const quantity = Number(item.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error(`LLM returned an unusable quantity: ${JSON.stringify(item.quantity)}`);
    }

    // Brand comes back separately so that "Tata namak" and "namak Tata" both
    // reach us as brand "Tata" + product "Namak". Composing brand-first here is
    // what makes the bill read the same either way.
    const brand = typeof item.brand === "string" ? item.brand.trim() : "";
    const bare = typeof item.product === "string" ? item.product.trim() : "";
    if (!bare) throw new Error("LLM returned an item with no product name");
    const product = brand ? `${brand} ${bare}` : bare;

    // Normalised through the same table the regex parser uses, so "kg" bills as
    // "kilo" whichever parser handled the sentence — and so a malformed value
    // becomes null instead of reaching a customer's bill.
    const unit = normalizeUnit(item.unit);

    // Absent, null and "" all mean "no price was spoken". Anything else must be a
    // real number — a non-numeric price would end up multiplied into line_total.
    const priceGiven = item.price !== undefined && item.price !== null && item.price !== "";
    const price = priceGiven ? Number(item.price) : null;
    if (priceGiven && !Number.isFinite(price)) {
      throw new Error(`LLM returned an unusable price: ${JSON.stringify(item.price)}`);
    }

    return { quantity, unit, product, price };
  });
}

async function parseWithLLM(text) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");

  // Constructed per call, not at module load: the test suite requires this file
  // with no key present, and reading the env late also means dotenv is
  // guaranteed to have run by the time we look.
  const ai = new GoogleGenAI({ apiKey });

  const interaction = await ai.interactions.create({
    model: process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
    input: buildPrompt(text),
    response_format: {
      type: "text",
      mime_type: "application/json",
      schema: ITEMS_SCHEMA,
    },
  });

  return itemsFromLLMJson(interaction.output_text);
}

async function parseSaleItems(text) {
  if (process.env.GEMINI_API_KEY) {
    try {
      // Deadline: a hung Gemini call must not hold the shopkeeper at the counter.
      // Past it, the offline parser answers instead.
      let timer;
      const deadline = new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Gemini timed out")),
          Number(process.env.GEMINI_TIMEOUT_MS) || 8000
        );
      });
      try {
        return await Promise.race([parseWithLLM(text), deadline]);
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      console.warn("LLM parse failed, falling back to regex parser:", err.message);
    }
  }
  return parseWithRegex(text);
}

module.exports = { parseSaleItems, parseWithRegex, parseWithLLM, itemsFromLLMJson };
