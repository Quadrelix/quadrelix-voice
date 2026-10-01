// Sends the bill image to the customer's WhatsApp via Twilio's WhatsApp API.
//
// SETUP NEEDED (see backend/README.md for full steps):
//   1. npm install twilio
//   2. .env: WHATSAPP_PROVIDER=twilio, TWILIO_SID=..., TWILIO_AUTH_TOKEN=...,
//      TWILIO_WHATSAPP_NUMBER=+14155238886 (or your sandbox number)
//   3. .env: PUBLIC_BASE_URL=<your ngrok https URL>  <-- REQUIRED, see below
//
// WHY PUBLIC_BASE_URL: Twilio's servers fetch the image from a URL you give
// them — they cannot reach "localhost" or your private 192.168.x.x address.
// Run `ngrok http 3000` in a separate terminal, copy the https:// URL it
// gives you, and put it in .env as PUBLIC_BASE_URL (no trailing slash).

async function sendBillOnWhatsApp({ phone, billImagePath, totalAmount, shopName }) {
  const provider = process.env.WHATSAPP_PROVIDER;

  if (!provider) {
    console.log(
      `[WHATSAPP STUB] Would send bill (₹${totalAmount}) from "${shopName}" to ${phone}.\n` +
        `Image at: ${billImagePath}\n` +
        `Set WHATSAPP_PROVIDER + credentials in .env to actually send.`
    );
    return { status: "simulated", provider: null };
  }

  if (provider === "twilio") {
    return sendViaTwilio({ phone, billImagePath, totalAmount, shopName });
  }

  if (provider === "gupshup") {
    throw new Error("Gupshup integration not implemented yet — see TODO in whatsapp.js");
  }

  if (provider === "meta") {
    throw new Error("Meta Cloud API integration not implemented yet — see TODO in whatsapp.js");
  }

  throw new Error(`Unknown WHATSAPP_PROVIDER: ${provider}`);
}

async function sendViaTwilio({ phone, billImagePath, totalAmount, shopName }) {
  const { TWILIO_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_NUMBER, PUBLIC_BASE_URL } = process.env;

  if (!TWILIO_SID || !TWILIO_AUTH_TOKEN || !TWILIO_WHATSAPP_NUMBER) {
    throw new Error("Missing TWILIO_SID / TWILIO_AUTH_TOKEN / TWILIO_WHATSAPP_NUMBER in .env");
  }
  if (!PUBLIC_BASE_URL) {
    throw new Error(
      "Missing PUBLIC_BASE_URL in .env — run `ngrok http 3000` and paste the https:// URL it gives you"
    );
  }

  const twilio = require("twilio")(TWILIO_SID, TWILIO_AUTH_TOKEN);

  // billImagePath is a local filesystem path — convert it to the public URL
  // served by the /bills static route in server.js
  const filename = billImagePath.split(/[\\/]/).pop(); // handles both Windows \ and Unix /
  const publicImageUrl = `${PUBLIC_BASE_URL}/bills/${filename}`;

  // India requires the customer's number in "whatsapp:+91XXXXXXXXXX" format
  let toNumber = phone.replace(/\D/g, "");
  if (!toNumber.startsWith("91") && toNumber.length === 10) {
    toNumber = "91" + toNumber; // assume Indian number if no country code given
  }

  console.log(`[TWILIO] Sending to whatsapp:+${toNumber} from whatsapp:${TWILIO_WHATSAPP_NUMBER}`);
  console.log(`[TWILIO] Image URL: ${publicImageUrl}`);

  let message;
  try {
    message = await twilio.messages.create({
      from: `whatsapp:${TWILIO_WHATSAPP_NUMBER}`,
      to: `whatsapp:+${toNumber}`,
      body: `${shopName} — Your bill total: ₹${totalAmount}. Scan the QR in the image to pay.`,
      mediaUrl: [publicImageUrl],
    });
  } catch (twilioErr) {
    console.error('[TWILIO ERROR] Code:', twilioErr.code);
    console.error('[TWILIO ERROR] Message:', twilioErr.message);
    console.error('[TWILIO ERROR] More info:', twilioErr.moreInfo);
    console.error('[TWILIO ERROR] Status:', twilioErr.status);
    throw twilioErr;
  }

  console.log(`[TWILIO] Message SID: ${message.sid}`);
  return { status: "sent", provider: "twilio", sid: message.sid };
}

/**
 * Validates the WhatsApp env config without sending anything, so a
 * misconfiguration surfaces when the server boots rather than after a
 * shopkeeper has recorded a sale and is waiting on "WhatsApp par Bhejein".
 * Returns an array of human-readable problems — empty means good to go.
 */
function checkWhatsAppConfig() {
  const provider = process.env.WHATSAPP_PROVIDER;
  if (!provider) return []; // stub mode is a deliberate, valid state

  if (provider === "gupshup" || provider === "meta") {
    return [`WHATSAPP_PROVIDER=${provider} is not implemented yet — sending will fail`];
  }
  if (provider !== "twilio") {
    return [`Unknown WHATSAPP_PROVIDER: ${provider}`];
  }

  const problems = [];
  const missing = [
    "TWILIO_SID",
    "TWILIO_AUTH_TOKEN",
    "TWILIO_WHATSAPP_NUMBER",
    "PUBLIC_BASE_URL",
  ].filter((key) => !process.env[key]);
  if (missing.length) {
    problems.push(`WHATSAPP_PROVIDER=twilio but these are unset in .env: ${missing.join(", ")}`);
  }
  try {
    require.resolve("twilio");
  } catch {
    problems.push("WHATSAPP_PROVIDER=twilio but the 'twilio' package is not installed — run: npm install twilio");
  }
  return problems;
}

module.exports = { sendBillOnWhatsApp, checkWhatsAppConfig };
