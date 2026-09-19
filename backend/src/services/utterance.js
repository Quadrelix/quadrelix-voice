// Decisions the hands-free flow has to make about a single overheard sentence,
// kept as pure functions so they can be tested without a mic, a network or a
// database. The route in sale.js does the I/O; the judgement lives here.

const { convertHindiNumbersToDigits } = require("./hindiNumbers");

/**
 * Is there anything in this text worth sending to the item parser?
 *
 * Continuous listening hears a lot that isn't a sale — "haan", "theek hai",
 * "aur", the customer talking, and whatever is left over after a phone number
 * has been cut out. Every one of those would otherwise cost a Gemini call and
 * come back as either junk or an error.
 *
 * The test is simply "does it contain a number", because every item needs one:
 * a quantity, a price, or both. Spoken number-words count, which is why the
 * text goes through the Hindi converter first — "do shirt" has a number in it,
 * "shirt" alone does not.
 */
function hasItemContent(text) {
  if (typeof text !== "string" || !text.trim()) return false;
  return /\d/.test(convertHindiNumbersToDigits(text));
}

// Product names are compared loosely: case, spacing and edge punctuation vary
// between two transcriptions of the same word.
function normalizeName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[.,।!?'"()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// True when one name's words are all present in the other's — "namak" matches an
// existing "Tata Namak", because the shopkeeper who named the brand the first
// time won't necessarily name it again when quoting the price.
function isPartialNameMatch(a, b) {
  const wordsA = a.split(" ").filter(Boolean);
  const wordsB = b.split(" ").filter(Boolean);
  if (!wordsA.length || !wordsB.length) return false;
  const [shortWords, longWords] =
    wordsA.length <= wordsB.length ? [wordsA, wordsB] : [wordsB, wordsA];
  const longSet = new Set(longWords);
  return shortWords.every((w) => longSet.has(w));
}

/**
 * matchPriceFill(existingItems, parsedItems)
 *   -> { fills: [{ item_index, price }], additions: [parsedItem] }
 *
 * When a freshly parsed item names a product that's already on the bill WITHOUT
 * a price, and this time a price was spoken, treat it as answering the missing
 * price rather than as a second line item.
 *
 * This rule is what keeps the hands-free flow from dead-ending exactly where it
 * matters most. A sale can't be sent while any item's price is null, and the
 * shopkeeper's hands are full — they cannot tap the price box. Their natural fix
 * is to say it again ("aam 60 rupaye"), and without this rule that adds a second
 * Aam line and the bill is now wrong in a way they can't see.
 *
 * `existingItems` is the DB shape (`product_name`, `price`), `parsedItems` is
 * the parser shape (`product`, `price`).
 */
function matchPriceFill(existingItems, parsedItems) {
  const existing = Array.isArray(existingItems) ? existingItems : [];
  const parsed = Array.isArray(parsedItems) ? parsedItems : [];

  const fills = [];
  const additions = [];
  // One unpriced line can only be answered once per sentence, otherwise "aam 60
  // aur aam 60" would write the same index twice and lose the second item.
  const claimed = new Set();

  const unpriced = existing
    .map((item, index) => ({ item, index }))
    .filter(({ item, index }) => item && item.price == null && !claimed.has(index));

  for (const candidate of parsed) {
    // Nothing to fill a price with — this is a new item however it's named.
    if (candidate.price == null) {
      additions.push(candidate);
      continue;
    }

    const name = normalizeName(candidate.product);
    const open = unpriced.filter(({ index }) => !claimed.has(index));

    let target = open.find(({ item }) => normalizeName(item.product_name) === name);

    // Fall back to a loose match only when it's unambiguous. Two unpriced items
    // that both partially match means we don't know which price was quoted, and
    // guessing would put a number on the wrong line of a real bill.
    if (!target) {
      const loose = open.filter(({ item }) =>
        isPartialNameMatch(normalizeName(item.product_name), name)
      );
      if (loose.length === 1) target = loose[0];
    }

    if (target) {
      claimed.add(target.index);
      // The restated quantity is deliberately ignored — only the price is taken.
      // "aam 60 rupaye" is answering a question about price, not re-counting the
      // mangoes, and silently changing a quantity nobody re-confirmed is worse
      // than keeping the one that was actually said the first time.
      fills.push({ item_index: target.index, price: candidate.price });
    } else {
      additions.push(candidate);
    }
  }

  return { fills, additions };
}

module.exports = { hasItemContent, matchPriceFill, normalizeName };
