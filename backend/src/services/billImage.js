// Generates the bill as a PNG image using Jimp (pure JS — no native
// compilation needed, works in any environment).

const Jimp = require("jimp");
const path = require("path");
const fs = require("fs");
const { generateUpiQrBuffer } = require("./qr");

const OUTPUT_DIR = path.join(__dirname, "..", "..", "generated_bills");
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const WIDTH = 700;
const ROW_HEIGHT = 34;
const MARGIN = 30;

async function generateBillImage({ transaction, shop }) {
  const itemRows = transaction.items.length;
  const height = 260 + itemRows * ROW_HEIGHT + 320; // header + items + QR block

  const image = new Jimp(WIDTH, height, "#ffffff");

  const fontTitle = await Jimp.loadFont(Jimp.FONT_SANS_32_BLACK);
  const fontSubtitle = await Jimp.loadFont(Jimp.FONT_SANS_14_BLACK);
  const fontHeader = await Jimp.loadFont(Jimp.FONT_SANS_16_BLACK);
  const fontBody = await Jimp.loadFont(Jimp.FONT_SANS_16_BLACK);
  const fontBold = await Jimp.loadFont(Jimp.FONT_SANS_16_BLACK);
  const fontTotal = await Jimp.loadFont(Jimp.FONT_SANS_32_BLACK);

  let y = MARGIN;

  // Shop name + subtitle
  image.print(fontTitle, MARGIN, y, shop.shop_name);
  y += 44;
  image.print(fontSubtitle, MARGIN, y, `Contact: ${shop.owner_phone}`);
  y += 40;

  // divider
  drawLine(image, y);
  y += 20;

  // table header
  image.print(fontHeader, MARGIN, y, "Product");
  image.print(fontHeader, 420, y, "Qty");
  image.print(fontHeader, 490, y, "Price");
  image.print(fontHeader, 590, y, "Total");
  y += 28;
  drawLine(image, y);
  y += 14;

  // item rows
  for (const item of transaction.items) {
    image.print(fontBody, MARGIN, y, truncate(item.product_name, 30));
    image.print(fontBody, 420, y, String(item.quantity));
    image.print(fontBody, 490, y, `Rs.${item.price}`);
    image.print(fontBody, 590, y, `Rs.${item.line_total}`);
    y += ROW_HEIGHT;
  }

  y += 6;
  drawLine(image, y);
  y += 20;

  // total
  image.print(fontTotal, MARGIN, y, `Total: Rs.${transaction.total_amount}`);
  y += 60;

  drawLine(image, y);
  y += 20;

  // QR code
  const qrBuffer = await generateUpiQrBuffer({
    upiId: shop.upi_id,
    payeeName: shop.shop_name,
    amount: transaction.total_amount,
  });
  const qrImage = await Jimp.read(qrBuffer);
  qrImage.resize(220, 220);
  const qrX = (WIDTH - 220) / 2;
  image.composite(qrImage, qrX, y);
  y += 230;

  image.print(
    fontBold,
    0,
    y,
    { text: `Scan to pay Rs.${transaction.total_amount}`, alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER },
    WIDTH
  );

  const filename = `bill_${transaction.transaction_id}.png`;
  const filepath = path.join(OUTPUT_DIR, filename);
  await image.writeAsync(filepath);
  return filepath;
}

function drawLine(image, y) {
  for (let x = MARGIN; x < WIDTH - MARGIN; x++) {
    image.setPixelColor(0xccccccff, x, y);
  }
}

function truncate(str, len) {
  return str.length > len ? str.slice(0, len - 1) + "…" : str;
}

module.exports = { generateBillImage };
