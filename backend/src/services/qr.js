// Generates a UPI payment QR code as a PNG buffer.
// No payment gateway account needed — just a UPI ID (VPA), e.g. "shopname@upi".
// Scanning this with any UPI app (GPay/PhonePe/Paytm) pre-fills the amount & payee.

const QRCode = require("qrcode");

async function generateUpiQrBuffer({ upiId, payeeName, amount }) {
  const upiUrl = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(
    payeeName
  )}&am=${amount}&cu=INR`;

  return QRCode.toBuffer(upiUrl, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 400,
  });
}

module.exports = { generateUpiQrBuffer };
