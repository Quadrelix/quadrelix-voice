// Generates a UPI payment QR code as a PNG buffer.
// No payment gateway account needed — just a UPI ID (VPA), e.g. "shopname@upi".
// Scanning this with any UPI app (GPay/PhonePe/Paytm) pre-fills the amount & payee.

const QRCode = require("qrcode");

// `size` should match the size the QR will actually be drawn at. Generating it
// at the final size keeps the module edges crisp — scaling a 400px QR down to
// fit a smaller box resamples it and blurs the boundaries scanners look for.
async function generateUpiQrBuffer({ upiId, payeeName, amount, size = 400 }) {
  const upiUrl = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(
    payeeName
  )}&am=${amount}&cu=INR`;

  return QRCode.toBuffer(upiUrl, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: size,
  });
}

module.exports = { generateUpiQrBuffer };
