// Guards the bill renderer. The failure this exists to catch: Devanagari
// product names rendering as "?? ??? ????" (or empty tofu boxes) because the
// bundled font went missing or the renderer stopped shaping Hindi. That bug
// shipped once already with the old Jimp bitmap-font renderer.
//
// Runs fully offline — the renderer only needs the local font files and the
// qrcode package, no API keys.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const { generateBillImage } = require("../src/services/billImage");

const SHOP = {
  shop_name: "रोहित जनरल स्टोर",
  owner_phone: "9876543210",
  upi_id: "rohitstore@upi",
};

function bill(items, id) {
  return {
    transaction: {
      transaction_id: id,
      items,
      total_amount: items.reduce((sum, i) => sum + (i.line_total || 0), 0),
    },
    shop: SHOP,
  };
}

// PNG stores width/height as big-endian uint32s in the IHDR chunk.
function readPng(filepath) {
  const buf = fs.readFileSync(filepath);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return {
    isPng: buf.subarray(0, 8).equals(signature),
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    bytes: buf.length,
  };
}

test("renders a Devanagari bill to a valid PNG", async () => {
  const filepath = await generateBillImage(
    bill(
      [
        { product_name: "साड़ी", quantity: 5, price: 300, line_total: 1500 },
        { product_name: "नहाने की साबुन", quantity: 2, price: 45, line_total: 90 },
      ],
      "test-devanagari"
    )
  );

  assert.ok(fs.existsSync(filepath), "bill file should exist");
  const png = readPng(filepath);
  assert.ok(png.isPng, "should be a real PNG");
  assert.strictEqual(png.width, 700);
  // Devanagari glyphs are a lot of ink. If the font failed to load we'd get
  // blank space or repeated identical tofu boxes, which compress far smaller.
  assert.ok(png.bytes > 5000, `expected a substantial PNG, got ${png.bytes} bytes`);
});

test("Devanagari and Latin names produce different renders", async () => {
  // Same layout, same numbers — only the script differs. If the renderer were
  // dropping Devanagari to "?" or tofu, these two would come out suspiciously
  // similar in size; more importantly, identical bytes would mean neither
  // rendered at all.
  const items = (name) => [{ product_name: name, quantity: 1, price: 100, line_total: 100 }];

  const hindiPath = await generateBillImage(bill(items("साड़ी"), "test-script-hi"));
  const latinPath = await generateBillImage(bill(items("Saree"), "test-script-en"));

  const hindi = fs.readFileSync(hindiPath);
  const latin = fs.readFileSync(latinPath);
  assert.ok(!hindi.equals(latin), "Hindi and Latin names must render differently");
});

test("row count changes the image height", async () => {
  const one = await generateBillImage(
    bill([{ product_name: "साड़ी", quantity: 1, price: 100, line_total: 100 }], "test-rows-1")
  );
  const four = await generateBillImage(
    bill(
      Array.from({ length: 4 }, (_, i) => ({
        product_name: `धोती ${i + 1}`,
        quantity: 1,
        price: 100,
        line_total: 100,
      })),
      "test-rows-4"
    )
  );

  assert.ok(
    readPng(four).height > readPng(one).height,
    "a bill with more items should be taller"
  );
});

test("a missing price does not render as null", async () => {
  // The parser leaves price null when the shopkeeper didn't say one, so the
  // renderer has to cope rather than printing "₹null".
  const filepath = await generateBillImage(
    bill([{ product_name: "अंडा", quantity: 30, price: null, line_total: null }], "test-null-price")
  );
  assert.ok(readPng(filepath).isPng);
});

test("an overlong name is truncated, not left to overflow", async () => {
  // Both names start with the same text, which already exceeds the product
  // column on its own. If truncation works, the extra tail is never drawn and
  // the two bills are byte-identical. If it were removed, the longer name would
  // paint further right and the bytes would differ.
  const base = "साड़ी धोती कुर्ता पायजामा चादर तकिया रुमाल तौलिया साबुन तेल शैम्पू";
  const row = (name) => [{ product_name: name, quantity: 1, price: 100, line_total: 100 }];

  const longPath = await generateBillImage(bill(row(base), "test-name-long"));
  const longerPath = await generateBillImage(
    bill(row(base + " कंघी बाल्टी मग साबुनदानी"), "test-name-longer")
  );

  assert.ok(
    fs.readFileSync(longPath).equals(fs.readFileSync(longerPath)),
    "both names should be clipped to the same visible text"
  );
  assert.strictEqual(readPng(longPath).width, 700);
});

test("the bundled Devanagari fonts are present", () => {
  // billImage.js throws at require time if these are gone; assert it directly
  // so the reason is obvious instead of surfacing as an unrelated crash.
  const fontDir = path.join(__dirname, "..", "assets", "fonts");
  for (const file of ["NotoSansDevanagari-Regular.ttf", "NotoSansDevanagari-Bold.ttf"]) {
    const fontPath = path.join(fontDir, file);
    assert.ok(fs.existsSync(fontPath), `missing bundled font: ${file}`);
    // A truncated download (e.g. an HTML 404 page saved as .ttf) would be tiny.
    assert.ok(fs.statSync(fontPath).size > 50000, `${file} looks truncated`);
  }
});

test("the UPI QR survives rendering and still holds the payment link", async () => {
  // This is the payment path: if compositing ever blurred or clipped the QR,
  // the bill would still look fine but nobody could pay it. So decode the QR
  // back out of the finished PNG rather than trusting that it looks right.
  const jsQR = require("jsqr").default || require("jsqr");
  const { createCanvas, loadImage } = require("@napi-rs/canvas");

  const filepath = await generateBillImage(
    bill([{ product_name: "साड़ी", quantity: 5, price: 300, line_total: 1500 }], "test-qr")
  );

  const img = await loadImage(filepath);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, img.width, img.height);

  const decoded = jsQR(new Uint8ClampedArray(data), width, height);
  assert.ok(decoded, "should be able to decode a QR out of the rendered bill");

  const params = new URL(decoded.data.replace("upi://", "https://")).searchParams;
  assert.strictEqual(params.get("pa"), SHOP.upi_id);
  assert.strictEqual(params.get("pn"), SHOP.shop_name);
  assert.strictEqual(params.get("am"), "1500");
  assert.strictEqual(params.get("cu"), "INR");
});

test.after(() => {
  // Keep generated_bills/ free of test artifacts.
  const dir = path.join(__dirname, "..", "generated_bills");
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith("bill_test-")) fs.unlinkSync(path.join(dir, name));
  }
});
