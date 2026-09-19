// Generates the bill as a PNG image.
//
// Rendered with @napi-rs/canvas (Skia) rather than Jimp. Jimp can only draw its
// own bitmap fonts, which are Latin-1 only, so every Devanagari product name
// came out as "?? ??? ????" — which broke the one thing this app is for:
// recording sales spoken in Hindi. Skia does real HarfBuzz text shaping, so
// "साड़ी" renders with its matras in the right places, and it ships prebuilt
// binaries for Windows and Linux (no native compilation on install).
//
// The Noto Sans Devanagari faces in assets/fonts/ are bundled deliberately:
// relying on a system font would mean the bill looks different on the dev
// laptop than on a Linux server, and most servers have no Devanagari font at
// all. Both weights are registered under one family alias ("Bill Sans") so
// Skia picks Regular vs Bold from the weight in ctx.font. They also cover
// Latin, digits and ₹, so one family renders "साड़ी x2 = ₹600" in a single run.

const { createCanvas, loadImage, GlobalFonts } = require("@napi-rs/canvas");
const path = require("path");
const fs = require("fs");
const { generateUpiQrBuffer } = require("./qr");

const OUTPUT_DIR = path.join(__dirname, "..", "..", "generated_bills");
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const FONT_DIR = path.join(__dirname, "..", "..", "assets", "fonts");
const FAMILY = "Bill Sans";

// Registration is global and process-wide, so do it once at require time.
// Fail loudly here rather than silently rendering tofu boxes on every bill.
for (const file of ["NotoSansDevanagari-Regular.ttf", "NotoSansDevanagari-Bold.ttf"]) {
  const fontPath = path.join(FONT_DIR, file);
  if (!fs.existsSync(fontPath)) {
    throw new Error(
      `Missing bill font: ${fontPath}\n` +
        `Bills cannot render Hindi without it. Re-download the Noto Sans ` +
        `Devanagari Regular + Bold TTFs into backend/assets/fonts/.`
    );
  }
  if (!GlobalFonts.registerFromPath(fontPath, FAMILY)) {
    throw new Error(`Could not register bill font: ${fontPath}`);
  }
}

const WIDTH = 700;
const MARGIN = 30;
const ROW_HEIGHT = 34; // vertical pitch between item rows
const ROW_BASELINE = 24; // where the text sits inside its row
const QR_SIZE = 220;
const RULE = "#cccccc";

// Right edges of the three numeric columns. They're right-aligned so the rupee
// amounts line up on their last digit no matter how wide the numbers get.
const QTY_RIGHT = 452;
const PRICE_RIGHT = 560;
const TOTAL_RIGHT = WIDTH - MARGIN;
// Product names get whatever is left, minus a gap so a long name can't collide
// with the quantity column. The gap has to fit the WIDEST quantity cell, which
// is now "quantity + unit" ("12 packet", "3 डिब्बा") rather than a bare number —
// a 60px reserve was sized for "12" and let unit text run into the name.
const PRODUCT_MAX_WIDTH = QTY_RIGHT - 110 - MARGIN;

const font = (size, weight = "normal") => `${weight} ${size}px "${FAMILY}"`;

// Devanagari writes one "character" as several code points (consonant + nukta +
// vowel sign), so any trimming has to work in graphemes, not code units.
const segmenter = new Intl.Segmenter("hi", { granularity: "grapheme" });

async function generateBillImage({ transaction, shop }) {
  const height =
    MARGIN + // top
    44 + // shop name
    26 + // contact line
    28 + // divider gap
    28 + // table header
    18 + // header rule
    transaction.items.length * ROW_HEIGHT +
    26 + // rule above total
    52 + // total line
    30 + // divider before QR
    QR_SIZE +
    46 + // "scan to pay" caption
    MARGIN; // bottom

  const canvas = createCanvas(WIDTH, height);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, WIDTH, height);
  ctx.fillStyle = "#000000";
  ctx.textBaseline = "alphabetic";

  let y = MARGIN + 26;

  // Shop header
  ctx.font = font(30, "bold");
  ctx.fillText(shop.shop_name, MARGIN, y);
  y += 30;

  ctx.font = font(14);
  ctx.fillStyle = "#555555";
  ctx.fillText(`Contact: ${shop.owner_phone}`, MARGIN, y);
  ctx.fillStyle = "#000000";
  y += 28;

  drawRule(ctx, y);
  y += 28;

  // Table header
  ctx.font = font(16, "bold");
  ctx.fillText("Product", MARGIN, y);
  drawRight(ctx, "Qty", QTY_RIGHT, y);
  drawRight(ctx, "Price", PRICE_RIGHT, y);
  drawRight(ctx, "Total", TOTAL_RIGHT, y);
  y += 10;

  drawRule(ctx, y);
  y += 8;

  // Item rows
  ctx.font = font(16);
  for (const item of transaction.items) {
    const baseline = y + ROW_BASELINE;
    ctx.fillText(fitToWidth(ctx, item.product_name, PRODUCT_MAX_WIDTH), MARGIN, baseline);
    drawRight(ctx, quantityLabel(item), QTY_RIGHT, baseline);
    drawRight(ctx, money(item.price), PRICE_RIGHT, baseline);
    drawRight(ctx, money(item.line_total), TOTAL_RIGHT, baseline);
    y += ROW_HEIGHT;
  }

  y += 16;
  drawRule(ctx, y);
  y += 42;

  // Total
  ctx.font = font(28, "bold");
  ctx.fillText("Total", MARGIN, y);
  drawRight(ctx, money(transaction.total_amount), TOTAL_RIGHT, y);
  y += 30;

  drawRule(ctx, y);
  y += 30;

  // UPI QR — scanning it pre-fills payee and amount in any UPI app.
  // Generated at the exact size it's drawn at, so no rescaling blurs it.
  const qrBuffer = await generateUpiQrBuffer({
    upiId: shop.upi_id,
    payeeName: shop.shop_name,
    amount: transaction.total_amount,
    size: QR_SIZE,
  });
  const qrImage = await loadImage(qrBuffer);
  ctx.drawImage(qrImage, (WIDTH - QR_SIZE) / 2, y, QR_SIZE, QR_SIZE);
  y += QR_SIZE + 30;

  ctx.font = font(16, "bold");
  drawCentered(ctx, `Scan to pay ${money(transaction.total_amount)}`, y);

  const filename = `bill_${transaction.transaction_id}.png`;
  const filepath = path.join(OUTPUT_DIR, filename);
  await fs.promises.writeFile(filepath, canvas.toBuffer("image/png"));
  return filepath;
}

function drawRule(ctx, y) {
  ctx.save();
  ctx.strokeStyle = RULE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  // +0.5 keeps the 1px line on a pixel boundary instead of blurring across two
  ctx.moveTo(MARGIN, y + 0.5);
  ctx.lineTo(WIDTH - MARGIN, y + 0.5);
  ctx.stroke();
  ctx.restore();
}

function drawRight(ctx, text, rightX, y) {
  ctx.fillText(text, rightX - ctx.measureText(text).width, y);
}

function drawCentered(ctx, text, y) {
  ctx.fillText(text, (WIDTH - ctx.measureText(text).width) / 2, y);
}

function money(amount) {
  // A missing price is shown as a dash rather than "₹null" — the parser leaves
  // price null when the shopkeeper didn't say one.
  return amount === null || amount === undefined ? "—" : `₹${amount}`;
}

// "2 kilo" for weighed goods, plain "2" for counted ones. The unit lives in its
// own field rather than inside product_name so that mangoes bought by the kilo
// and by the piece are still the same product on the bill — and so this column
// reads as an amount, not as part of the name.
//
// Records written before the parser tracked units have no `unit` key at all;
// they must keep rendering as a bare number, not "2 undefined".
function quantityLabel(item) {
  const unit = typeof item.unit === "string" ? item.unit.trim() : "";
  return unit ? `${item.quantity} ${unit}` : String(item.quantity);
}

// Truncates by measured width, not character count: Devanagari clusters are
// wider than Latin letters, so a fixed 30-character cut either overflowed the
// column or wasted half of it depending on the script.
//
// Cuts on grapheme boundaries so a name is never sliced between a consonant and
// its vowel sign — "साड़ी" cut by code unit would leave a stranded "ा".
function fitToWidth(ctx, text, maxWidth) {
  const str = String(text ?? "");
  if (ctx.measureText(str).width <= maxWidth) return str;

  const clusters = [...segmenter.segment(str)].map((s) => s.segment);
  let out = "";
  for (const cluster of clusters) {
    if (ctx.measureText(out + cluster + "…").width > maxWidth) break;
    out += cluster;
  }
  return (out || clusters[0] || "") + "…";
}

module.exports = { generateBillImage };
