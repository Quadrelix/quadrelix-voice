// Finds a customer's phone number inside something the shopkeeper said, and
// hands back the sentence with the number taken out.
//
// Why this doesn't live in hindiNumbers.js: that module does ARITHMETIC on
// number-words, because "तीन सौ" has to become 300 for a price. A phone number
// needs the exact opposite — "नौ आठ सात" is the digit STRING "987", not the sum
// 24. Running the price converter over a spoken number is not a small error:
// measured on the real thing, "नौ तीन आठ सात छह पांच चार तीन दो एक" came out as
// "48", and "शून्य" isn't in its tables at all, so any number containing a zero
// could never have worked. Hence a separate module with its own table of just
// the ten digits. hindiNumbers.js stays untouched — item parsing depends on it.
//
// The other half of the job is REMOVING the number from the text. Whatever is
// left goes to the item parser, and a stray "9876543210" there would bill a
// customer for nine billion mangoes.

// Spoken digits, 0-9 only. Deliberately not the full number-word table: a
// multi-digit word like "पचास" (50) must BREAK a digit run rather than extend
// it, which is what keeps "पचास रुपये" from ever looking like a phone number.
//
// Romanised spellings come from what Sarvam actually emits for Hinglish speech,
// which varies ("saat" / "sat", "panch" / "paanch"). English "no" is left out on
// purpose — it means "nau" (9) to some speakers but "nahi" to everyone else, and
// guessing wrong here sends a bill to the wrong number.
//
// The ENGLISH column is not decoration. Shopkeepers read a customer's number out
// in English digit names, and Sarvam — set to hi-IN — faithfully writes those
// English words in DEVANAGARI script: "nine three zero" arrives as
// "नाइन थ्री जीरो". On the real thing this cost a working dictation:
// "नाइन थ्री जीरो डबल टू फोर एट फोर थ्री नाइन" (9302248439) matched nothing at
// all, so no number was found — and worse, the sentence then fell through to the
// item parser, which billed the whole thing as one nameless 34-rupee item and
// blocked the send waiting for a price nobody could give. The Devanagari-
// transliterated forms below are what that sounds like in script; the plain
// Latin forms cover the rare case where Sarvam returns Hinglish in Latin.
const DIGIT_WORDS = {
  // 0
  "शून्य": "0", "सुन्य": "0", "जीरो": "0", "ज़ीरो": "0", zero: "0", jeero: "0", sunya: "0",
  // 1
  "एक": "1", "वन": "1", ek: "1", ik: "1", one: "1",
  // 2
  "दो": "2", "टू": "2", "टु": "2", do: "2", doh: "2", two: "2",
  // 3
  "तीन": "3", "थ्री": "3", teen: "3", tin: "3", three: "3", thri: "3",
  // 4
  "चार": "4", "फोर": "4", "फ़ोर": "4", char: "4", chaar: "4", four: "4",
  // 5
  "पांच": "5", "पाँच": "5", "फाइव": "5", "फ़ाइव": "5", panch: "5", paanch: "5", panj: "5", five: "5", faiv: "5",
  // 6
  "छह": "6", "छः": "6", "छे": "6", "छह़": "6", "सिक्स": "6", chhah: "6", chah: "6", cheh: "6", chhe: "6", chay: "6", six: "6", siks: "6",
  // 7
  "सात": "7", "सेवन": "7", saat: "7", sat: "7", seven: "7", sevan: "7",
  // 8
  "आठ": "8", "एट": "8", "एट्": "8", aath: "8", ath: "8", eight: "8",
  // 9
  "नौ": "9", "नाइन": "9", "नाईन": "9", nau: "9", nao: "9", nine: "9", nain: "9", nin: "9",
};

// "डबल सात" = 77. This is how people actually read numbers out loud, and without
// it a perfectly ordinary dictation lands one digit short and gets rejected.
const REPEAT_WORDS = {
  "डबल": 2, "डब्बल": 2, "डबल्": 2, double: 2, dabal: 2, dabbal: 2, dubble: 2,
  "ट्रिपल": 3, "ट्रिप्पल": 3, triple: 3, tripal: 3, tripple: 3,
};

// Devanagari numerals. Sarvam usually returns ASCII digits, but "usually" isn't
// a thing to bet a send on.
const DEVANAGARI_DIGITS = { "०": "0", "१": "1", "२": "2", "३": "3", "४": "4", "५": "5", "६": "6", "७": "7", "८": "8", "९": "9" };

// Words that sit next to a dictated number and mean nothing on a bill. They get
// dropped along with the number, because otherwise "number 9876543210" leaves
// behind "number" and the item parser cheerfully sells one Number.
const FILLER_BEFORE = new Set([
  "number", "nombar", "nambar", "no", "num", "नंबर", "नम्बर", "नंबर,",
  "mobile", "mobail", "मोबाइल", "phone", "fone", "फोन", "whatsapp", "व्हाट्सएप", "वाट्सएप",
  "customer", "grahak", "ग्राहक", "unka", "uska", "inka", "iska", "उनका", "उसका", "इनका",
  "mera", "मेरा", "meri", "मेरी", "ka", "ki", "ke", "का", "की", "के", "hai", "है", "is", "ye", "ये",
]);

// Same idea on the trailing side: "…9876543210 pe bhej do". Note "do" is in
// here even though it also means the digit 2 — after a completed phone number
// it is overwhelmingly "bhej do", and leaving it in is actively harmful because
// the item parser would see a digit and try to make a sale out of it.
const FILLER_AFTER = new Set([
  "pe", "par", "पे", "पर", "ko", "को", "me", "में", "hai", "है", "hain", "हैं",
  "bhej", "bhejo", "bhejna", "bhejiye", "भेज", "भेजो", "भेजना", "भेजिए",
  "do", "दो", "de", "dena", "dijiye", "दे", "देना", "दीजिए",
  "kar", "karo", "kardo", "कर", "करो", "please", "jaldi", "जल्दी", "bill", "बिल",
]);

// Punctuation Sarvam sprinkles in, including the Devanagari full stop. Stripped
// before a token is classified, kept in the original when rebuilding the text.
const EDGE_PUNCT = /^[\s,.।?!;:"'()\-]+|[\s,.।?!;:"'()\-]+$/g;

function stripPunct(word) {
  return word.replace(EDGE_PUNCT, "");
}

function toAsciiDigits(str) {
  return str.replace(/[०-९]/g, (d) => DEVANAGARI_DIGITS[d]);
}

// What a single word contributes to a digit run, if anything.
function classify(word) {
  const clean = toAsciiDigits(stripPunct(word));
  if (!clean) return null;

  // A literal group of digits, optionally with a country-code plus. "98765" is
  // five digits towards the run, not one.
  if (/^\+?\d+$/.test(clean)) return { type: "digits", digits: clean.replace(/\D/g, "") };

  const lower = clean.toLowerCase();
  if (DIGIT_WORDS[lower]) return { type: "digits", digits: DIGIT_WORDS[lower] };
  if (REPEAT_WORDS[lower]) return { type: "repeat", times: REPEAT_WORDS[lower] };
  return null;
}

// Turns a run of digits into a validated 10-digit Indian mobile number, and
// reports which slice of the run it used so the caller can put the rest back.
//
// The 6-9 first-digit rule is what makes "any 10-digit number" a safe trigger:
// Indian mobile numbers all start 6, 7, 8 or 9, so a 10-digit run that starts
// with anything else is a quantity, a weight, a serial — not a customer.
function extractFromRun(digits) {
  const isMobile = (s) => s.length === 10 && /^[6-9]/.test(s);

  if (isMobile(digits)) return { phone: digits, start: 0, end: 10 };

  // "+91 98765 43210" and "091..." are both how people write their own number.
  if (digits.length === 12 && digits.startsWith("91") && isMobile(digits.slice(2))) {
    return { phone: digits.slice(2), start: 0, end: 12 };
  }
  if (digits.length === 11 && digits.startsWith("0") && isMobile(digits.slice(1))) {
    return { phone: digits.slice(1), start: 0, end: 11 };
  }

  // Longer run: a price ran straight into the number with no word between them,
  // e.g. "…sabun 10 9876543210" heard as one breath. Try the tail, then the head.
  // The unused digits are handed back to the caller and re-inserted into the
  // sentence, so the price they came from survives.
  //
  // 12 digits, not 11, is the floor on purpose. The likeliest cause of an
  // 11-digit run is one extra digit in a single dictated number, and slicing
  // that down to 10 would send the bill to a number nobody said. Refusing it
  // costs the shopkeeper one repeat; accepting it costs a stranger a bill.
  if (digits.length >= 12) {
    const tail = digits.slice(-10);
    if (isMobile(tail)) return { phone: tail, start: digits.length - 10, end: digits.length };
    const head = digits.slice(0, 10);
    if (isMobile(head)) return { phone: head, start: 0, end: 10 };
  }

  return null;
}

/**
 * findPhoneNumber(text) -> { phone, rest }
 *
 * `phone` is a 10-digit string, or null if the text holds no phone number.
 * `rest` is the text with the number (and the filler words around it) removed,
 * ready to hand to the item parser. When no number is found, `rest` is the
 * input unchanged.
 */
function findPhoneNumber(text) {
  if (typeof text !== "string" || !text.trim()) return { phone: null, rest: "" };

  // Split keeping the whitespace, so a sentence with no number rebuilds byte
  // for byte and nothing downstream can tell we looked at it.
  const parts = text.split(/(\s+)/);

  // Walk the words, growing a run of digits and breaking it on anything else.
  // Each run remembers the token range it covered so we can cut it out later.
  const runs = [];
  let current = null;
  let pendingRepeat = 0;

  const closeRun = () => {
    if (current && current.digits) runs.push(current);
    current = null;
    pendingRepeat = 0;
  };

  for (let i = 0; i < parts.length; i++) {
    if (/^\s+$/.test(parts[i]) || parts[i] === "") continue; // whitespace token
    const info = classify(parts[i]);

    if (!info) {
      closeRun();
      continue;
    }
    if (info.type === "repeat") {
      // A repeat word only makes sense inside a number being dictated, so it
      // starts a run if one isn't open yet.
      if (!current) current = { digits: "", from: i, to: i };
      current.to = i;
      pendingRepeat = info.times;
      continue;
    }

    if (!current) current = { digits: "", from: i, to: i };
    // "डबल सात" repeats one digit; "डबल 98" is nonsense, so the repeat is
    // dropped rather than applied to the whole group.
    current.digits += pendingRepeat && info.digits.length === 1
      ? info.digits.repeat(pendingRepeat)
      : info.digits;
    pendingRepeat = 0;
    current.to = i;
  }
  closeRun();

  const matches = runs
    .map((run) => ({ run, found: extractFromRun(run.digits) }))
    .filter((m) => m.found);
  if (!matches.length) return { phone: null, rest: text };

  // Later wins. If the shopkeeper corrects themselves — "9876543210, nahi nahi,
  // 9123456780" — the second number is the one they meant. Both still get cut
  // out of the text, or the abandoned one would be sold as an item.
  const phone = matches[matches.length - 1].found.phone;

  // Mark tokens to remove rather than splicing, so that two numbers whose filler
  // words overlap ("…3210 hai 9123…") can't shift each other's indices.
  const drop = new Array(parts.length).fill(false);
  const leftovers = new Map();

  for (const { run, found } of matches) {
    const leftover = run.digits.slice(0, found.start) + run.digits.slice(found.end);
    if (leftover) leftovers.set(run.from, leftover);

    // Widen the cut over the filler words hugging the number. Whitespace is only
    // absorbed once a filler word is actually found past it — otherwise the space
    // separating the number from real sale text disappears and "sabun 10" would
    // rebuild as "sabun10".
    let from = run.from;
    let to = run.to;
    while (from > 0) {
      let prev = from - 1;
      while (prev > 0 && /^\s*$/.test(parts[prev])) prev--;
      if (/^\s*$/.test(parts[prev])) break;
      if (!FILLER_BEFORE.has(stripPunct(parts[prev]).toLowerCase())) break;
      from = prev;
    }
    while (to < parts.length - 1) {
      let next = to + 1;
      while (next < parts.length - 1 && /^\s*$/.test(parts[next])) next++;
      if (/^\s*$/.test(parts[next])) break;
      if (!FILLER_AFTER.has(stripPunct(parts[next]).toLowerCase())) break;
      to = next;
    }
    for (let i = from; i <= to; i++) drop[i] = true;
  }

  const rest = parts
    .map((part, i) => (leftovers.has(i) ? leftovers.get(i) : drop[i] ? "" : part))
    .join("")
    .replace(/\s+/g, " ")
    .replace(/^[\s,.।]+|[\s,.।]+$/g, "")
    .trim();

  return { phone, rest };
}

module.exports = { findPhoneNumber };
