// Converts a recorded audio file into text using Sarvam AI's Speech-to-Text
// API — chosen specifically because it's trained on Hindi/Hinglish
// code-mixed speech (exactly what shopkeepers speak), unlike generic
// STT engines.
//
// Setup: get a free API key at https://www.sarvam.ai, then in .env:
//   SARVAM_API_KEY=your_key_here

const fs = require("fs");
const FormData = require("form-data");
const axios = require("axios");

async function transcribeAudio(audioFilePath) {
  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) {
    throw new Error("SARVAM_API_KEY not set in .env — get one free at sarvam.ai");
  }

  const form = new FormData();
  form.append("file", fs.createReadStream(audioFilePath));
  form.append("model", "saarika:v2.5"); // Sarvam's speech-to-text model
  form.append("language_code", "hi-IN"); // handles Hinglish code-mixing well

  const response = await axios.post(
    "https://api.sarvam.ai/speech-to-text",
    form,
    {
      headers: {
        ...form.getHeaders(),
        "api-subscription-key": apiKey,
      },
      // Upstream deadline, shorter than the app's own request timeout so the
      // backend answers with a clear error instead of the app giving up first.
      timeout: Number(process.env.SARVAM_TIMEOUT_MS) || 15000,
      maxBodyLength: 6 * 1024 * 1024,
    }
  );

  const transcript = response.data?.transcript;
  if (!transcript) throw new Error("Sarvam API did not return a transcript");

  return transcript;
}

module.exports = { transcribeAudio };
