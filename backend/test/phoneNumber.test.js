// Run with: npm test   (Node's built-in runner, offline, no API keys)
//
// findPhoneNumber is the trigger for an irreversible action: the moment it
// returns a number, the app starts a countdown and then sends a bill to that
// number over WhatsApp. So these tests pull in two directions and both matter —
// it has to catch a number however the shopkeeper says it, and it has to stay
// silent on the ordinary sale talk that surrounds it all day.

const test = require("node:test");
const assert = require("node:assert");

const { findPhoneNumber } = require("../src/services/phoneNumber");

// --- Recognising a number --------------------------------------------------

test("literal digits, however Sarvam spaces them", () => {
  for (const said of ["9876543210", "98765 43210", "987 654 3210", "9876543210."]) {
    assert.strictEqual(findPhoneNumber(said).phone, "9876543210", said);
  }
});

test("spoken digit-words become the digit string, not their sum", () => {
  // This is the whole reason phoneNumber.js exists. Run through
  // hindiNumbers.js — which adds number-words up, correctly, for prices — this
  // exact sentence came out as "45".
  assert.strictEqual(
    findPhoneNumber("नौ आठ सात छह पांच चार तीन दो एक शून्य").phone,
    "9876543210"
  );
});

test("zero is recognised in all the ways it gets said", () => {
  // शून्य appears in no table in hindiNumbers.js, so before this module every
  // customer number containing a 0 was undetectable — which is most of them.
  for (const zero of ["शून्य", "जीरो", "zero", "0"]) {
    assert.strictEqual(
      findPhoneNumber(`नौ आठ सात छह पांच चार तीन दो एक ${zero}`).phone,
      "9876543210",
      zero
    );
  }
});

test("English digit-names spoken in Hindi are recognised", () => {
  // Not a hypothetical. This is a transcript Sarvam actually produced on a real
  // phone, from a shopkeeper reading a number out in English digit-names while
  // the recogniser was set to hi-IN — so the English words came back in
  // Devanagari script. Before this was handled, the whole dictation matched
  // nothing, the sentence fell through to the item parser, and the bill grew a
  // nameless line ("Item × 34") that blocked the send forever.
  assert.strictEqual(
    findPhoneNumber("नाइन थ्री जीरो डबल टू फोर एट फोर थ्री नाइन").phone,
    "9302248439"
  );
  // Sarvam punctuates the end of an utterance; the full stop must not split it.
  assert.strictEqual(
    findPhoneNumber("नाइन थ्री जीरो डबल टू फोर एट फोर थ्री नाइन।").phone,
    "9302248439"
  );
  // Same dictation when the recogniser returns Latin instead of Devanagari.
  assert.strictEqual(
    findPhoneNumber("nine three zero double two four eight four three nine").phone,
    "9302248439"
  );
});

test("a dictated English number is cut out of the text entirely", () => {
  // The other half of the bug: with the number unrecognised, this sentence was
  // handed to the item parser whole and billed as one 34-rupee item.
  const { phone, rest } = findPhoneNumber("नाइन थ्री जीरो डबल टू फोर एट फोर थ्री नाइन।");
  assert.strictEqual(phone, "9302248439");
  assert.strictEqual(rest, "");
});

test("a mixed English/Hindi dictation still resolves", () => {
  // People switch mid-number: Hindi words for the digits they know, English for
  // the rest. Every position has to accept either.
  assert.strictEqual(
    findPhoneNumber("नौ थ्री शून्य टू दो फोर एट चार तीन नाइन").phone,
    "9302248439"
  );
});

test("items and an English-numbered dictation in one breath", () => {
  const { phone, rest } = findPhoneNumber(
    "3 dettol sabun 75 rupaye aur number नाइन थ्री जीरो डबल टू फोर एट फोर थ्री नाइन"
  );
  assert.strictEqual(phone, "9302248439");
  assert.strictEqual(rest, "3 dettol sabun 75 rupaye aur");
});

test("ordinary English words are not read as digits", () => {
  // The expansion above adds Latin spellings, and each one is a chance to turn
  // normal shop talk into a phone number. "for" (four), "too"/"tu" (two),
  // "ate" (eight) and "van" (one) are all real words or real Hindi, so they are
  // deliberately NOT in the table: a false positive here sends a stranger's
  // bill to a number nobody said.
  for (const said of [
    "2 kilo aam 60 rupaye for you",
    "ye shirt tu de de",
    "main van se aaya",
    "usne ate kiya",
  ]) {
    assert.strictEqual(findPhoneNumber(said).phone, null, said);
  }
});

test("romanized digit-words work too", () => {
  assert.strictEqual(
    findPhoneNumber("nau aath saat chhah panch char teen do ek zero").phone,
    "9876543210"
  );
});

test("Devanagari numerals are read as digits", () => {
  assert.strictEqual(findPhoneNumber("९८७६५४३२१०").phone, "9876543210");
});

test("digits and words mixed in one number", () => {
  // People switch halfway through: the first block fast, the rest spelled out.
  assert.strictEqual(findPhoneNumber("98765 चार तीन दो एक शून्य").phone, "9876543210");
});

test("'double' and 'triple' expand the following digit", () => {
  // A very common way to read a number aloud. Without this the run lands one or
  // two digits short and gets rejected as not-a-phone-number.
  assert.strictEqual(
    findPhoneNumber("डबल नौ आठ सात छह पांच चार तीन दो एक").phone,
    "9987654321"
  );
  assert.strictEqual(
    findPhoneNumber("nau triple aath saat chhah panch char teen do").phone,
    "9888765432"
  );
});

test("country code and trunk prefix normalise to the last 10 digits", () => {
  assert.strictEqual(findPhoneNumber("+91 98765 43210").phone, "9876543210");
  assert.strictEqual(findPhoneNumber("91 9876543210").phone, "9876543210");
  assert.strictEqual(findPhoneNumber("09876543210").phone, "9876543210");
});

// --- Staying silent --------------------------------------------------------
// A false positive here is the expensive direction: it sends a real customer's
// bill to a number nobody gave. Everything below is ordinary counter talk.

test("prices and quantities are never mistaken for a phone number", () => {
  for (const said of [
    "10 rupaye",
    "पचास रुपये", // one word, value 50 — must not extend a digit run
    "2 kilo aam 60 rupaye",
    "1 banarasi saree 300 rupaye 2 black saree 400 rupaye",
    "तीन सौ रुपये",
  ]) {
    assert.strictEqual(findPhoneNumber(said).phone, null, said);
  }
});

test("a 9- or 11-digit run is not a mobile number", () => {
  assert.strictEqual(findPhoneNumber("987654321").phone, null);
  // 11 digits is refused rather than trimmed to 10. The likeliest cause is one
  // extra digit in a single dictated number, and trimming would send the bill to
  // a number nobody said — the shopkeeper repeating themselves is the cheaper
  // failure. (A leading trunk "0" is the one 11-digit shape that IS accepted.)
  assert.strictEqual(findPhoneNumber("98765432109").phone, null);
});

test("a 10-digit run that can't be an Indian mobile is rejected", () => {
  // Indian mobiles all start 6/7/8/9. A 10-digit run starting anything else is
  // a serial, an order id, a weight — not a customer. This rule is what makes
  // "any 10-digit number" safe to use as an auto-send trigger.
  for (const said of ["5876543210", "1234567890", "0123456789"]) {
    assert.strictEqual(findPhoneNumber(said).phone, null, said);
  }
});

test("no number leaves the sentence byte-for-byte untouched", () => {
  const said = "₹2 की मिर्च, ₹5 का समोसा और ₹10 की भिंडी।";
  assert.deepStrictEqual(findPhoneNumber(said), { phone: null, partial: null, rest: said });
});

test("empty and non-string input don't throw", () => {
  assert.deepStrictEqual(findPhoneNumber(""), { phone: null, partial: null, rest: "" });
  assert.deepStrictEqual(findPhoneNumber("   "), { phone: null, partial: null, rest: "" });
  assert.deepStrictEqual(findPhoneNumber(undefined), { phone: null, partial: null, rest: "" });
  assert.deepStrictEqual(findPhoneNumber(null), { phone: null, partial: null, rest: "" });
});

// --- Partial dictation ------------------------------------------------------
// Sarvam sometimes garbles a long dictated number ("छानवे सबन जीरी सात निवारी
// आठ" is a real transcript) so no 10-digit number survives, but a few digit-
// words do. The app must KNOW a number was being said so it can ask for a
// repeat, instead of looking like it ignored the shopkeeper.

test("garbled dictation reports the digits that survived", () => {
  // Real transcript from a shopkeeper dictating a number in Hindi. Only सात
  // (7) and आठ (8) came through clean; the rest is Sarvam's mishearing.
  const r = findPhoneNumber("छानवे सबन जीरी सात निवारी आठ");
  assert.strictEqual(r.phone, null); // no full number
  assert.strictEqual(r.partial, "78"); // but the app knows digits were said
});

test("a partial Hindi digit run reports what came through", () => {
  const r = findPhoneNumber("नौ आठ सात छह");
  assert.strictEqual(r.phone, null);
  assert.strictEqual(r.partial, "9876");
});

test("two digit-words alone are still a partial, not a number", () => {
  const r = findPhoneNumber("सात आठ");
  assert.strictEqual(r.phone, null);
  assert.strictEqual(r.partial, "78");
});

test("a single digit is not a partial number", () => {
  // "2 kilo aam 60 rupaye" — single digit-words are quantities and prices,
  // every shopkeeper says dozens of them a day. Only a RUN of 2+ digits hints
  // at a phone number.
  assert.deepStrictEqual(findPhoneNumber("2 kilo aam 60 rupaye"), {
    phone: null, partial: null, rest: "2 kilo aam 60 rupaye",
  });
  assert.deepStrictEqual(findPhoneNumber("नौ"), { phone: null, partial: null, rest: "नौ" });
});

test("a full number reports no partial", () => {
  const r = findPhoneNumber("नौ आठ सात छह पांच चार तीन दो एक शून्य");
  assert.strictEqual(r.phone, "9876543210");
  assert.strictEqual(r.partial, null);
});

// --- What's left over goes to the item parser ------------------------------
// `rest` is fed straight to parseSaleItems. Anything left behind gets billed,
// so the number and the words that only existed to introduce it must both go.

test("the number is removed so it can't be billed as an item", () => {
  const { phone, rest } = findPhoneNumber("2 kilo aam 60 rupaye 9876543210");
  assert.strictEqual(phone, "9876543210");
  assert.strictEqual(rest, "2 kilo aam 60 rupaye");
});

test("filler words introducing the number are removed with it", () => {
  // Left in, "number" becomes a product and the shopkeeper's bill has a line
  // item called "Number" on it.
  assert.strictEqual(findPhoneNumber("mera number 9876543210 hai").rest, "");
  assert.strictEqual(findPhoneNumber("मेरा नंबर नौ आठ सात छह पांच चार तीन दो एक शून्य है").rest, "");
  assert.strictEqual(findPhoneNumber("customer ka mobile 9876543210 pe bhej do").rest, "");
});

test("filler stripping stops at the first real word", () => {
  // "do" is both a filler ("bhej do") and the digit 2, so the walk has to end
  // as soon as it hits something that isn't filler — here the next sale line.
  const { rest } = findPhoneNumber("9876543210 pe bhej do 2 kilo aam ₹60");
  assert.strictEqual(rest, "2 kilo aam ₹60");
});

test("a price that ran into the number keeps its digits", () => {
  // Said in one breath with no word between them, the two collapse into a
  // single 12-digit run. The phone is the trailing 10; the "10" belongs to the
  // price and has to survive, or the item ends up with no price and the whole
  // hands-free flow stalls waiting for one.
  const { phone, rest } = findPhoneNumber("3 dettol sabun 10 9876543210");
  assert.strictEqual(phone, "9876543210");
  assert.strictEqual(rest, "3 dettol sabun 10");
});

test("a self-correction keeps the last number and buries the first", () => {
  // "…nahi nahi…" — the abandoned number must not survive into `rest`, where it
  // would be parsed as a quantity.
  const { phone, rest } = findPhoneNumber("9876543210 nahi nahi 9123456780");
  assert.strictEqual(phone, "9123456780");
  assert.match(rest, /^nahi nahi$/);
});

test("items and the number in one breath both come out right", () => {
  // The shape the hands-free flow actually has to survive: the shopkeeper never
  // pauses between the last item and the customer's number.
  const { phone, rest } = findPhoneNumber(
    "do shanti amla tel bees rupaye aur number नौ आठ सात छह पांच चार तीन दो एक शून्य"
  );
  assert.strictEqual(phone, "9876543210");
  assert.strictEqual(rest, "do shanti amla tel bees rupaye aur");
});
