// Converts a spoken/typed shopkeeper sentence into one or more sale items.
//
// Examples:
//
// "5 white shirt 500 rupaye"
//
// -> {
//      items: [
//        {
//          quantity: 5,
//          product: "White Shirt",
//          price: 500
//        }
//      ]
//    }
//
// "5 white shirts 500 rupaye aur 2 jeans 1200 rupaye"
//
// -> {
//      items: [
//        {
//          quantity: 5,
//          product: "White Shirts",
//          price: 500
//        },
//        {
//          quantity: 2,
//          product: "Jeans",
//          price: 1200
//        }
//      ]
//    }
//
// Two modes:
//
// 1. parseWithRegex()
//    - Offline
//    - No API key required
//    - Good for simple MVP testing
//
// 2. parseWithLLM()
//    - Uses Claude
//    - Better for natural Hindi / English / Hinglish
//    - Requires ANTHROPIC_API_KEY in .env
//
// parseSaleText()
//    - Tries Claude first when API key is available
//    - Falls back to regex parser if Claude fails

function titleCase(text) {
  return String(text)
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function normalizeItem(item) {
  if (!item || typeof item !== "object") {
    throw new Error("Invalid parsed item");
  }

  const quantity = Number(item.quantity);
  const price = Number(item.price);
  const product = String(item.product ?? "").trim();

  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error("Invalid quantity");
  }

  if (!Number.isFinite(price) || price < 0) {
    throw new Error("Invalid price");
  }

  return {
    quantity,
    product: product || "Item",
    price,
  };
}

/**
 * Offline parser for simple shopkeeper sentences.
 *
 * Supported examples:
 *
 * 5 white shirt 500
 * 5 white shirts 500 rupaye
 * 5 white shirts 500 aur 2 jeans 1200
 * 5 Peter England white shirts 800
 */
function parseWithRegex(text) {
  if (!text || !String(text).trim()) {
    throw new Error("Sale text is required");
  }

  const cleaned = String(text)
    .toLowerCase()
    .replace(/rupaye|rupees|rs\.?|₹/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  /*
   * Split multiple products on common connectors.
   *
   * Examples:
   * "5 shirt 500 aur 2 jeans 1200"
   * "5 shirt 500 and 2 jeans 1200"
   */
  const segments = cleaned
    .split(/\s+(?:aur|and)\s+/i)
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length === 0) {
    throw new Error("No sale items found");
  }

  const items = [];

  for (const segment of segments) {
    /*
     * For each item we expect at least:
     *
     * first number  = quantity
     * last number   = price
     */
    const numbers = segment.match(/\d+(?:\.\d+)?/g);

    if (!numbers || numbers.length < 2) {
      throw new Error(
        `Couldn't find quantity and price in: "${segment}". Try: "5 shirt 500"`
      );
    }

    const quantity = Number(numbers[0]);
    const price = Number(numbers[numbers.length - 1]);

    /*
     * Product name is everything between:
     * quantity and price.
     */
    const firstNumIndex = segment.indexOf(numbers[0]);
    const lastNumIndex = segment.lastIndexOf(numbers[numbers.length - 1]);

    let product = segment
      .slice(firstNumIndex + numbers[0].length, lastNumIndex)
      .trim();

    /*
     * Remove optional filler words.
     *
     * "5 of white shirts 500"
     * "5 x white shirts 500"
     */
    product = product.replace(/^(of|x)\s+/i, "").trim();

    if (!product) {
      product = "item";
    }

    items.push(
      normalizeItem({
        quantity,
        product: titleCase(product),
        price,
      })
    );
  }

  return {
    items,
  };
}

/**
 * LLM parser.
 *
 * Claude should return ALL products in an items array.
 */
async function parseWithLLM(text) {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY not set");
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",

    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },

    body: JSON.stringify({
      model: "claude-sonnet-4-6",

      max_tokens: 500,

      messages: [
        {
          role: "user",

          content: `Extract ALL sale items from this Indian shopkeeper's sentence.

The sentence may be in:
- Hindi
- English
- Hinglish
- Mixed Hindi and English

For every product extract:

1. quantity
2. product
3. price in INR

Return ONLY valid JSON.

The JSON must have exactly this structure:

{
  "items": [
    {
      "quantity": number,
      "product": string,
      "price": number
    }
  ]
}

Do not return markdown.
Do not return explanations.
Do not return any extra text.

Examples:

Input:
"5 white shirts 500 rupaye"

Output:
{
  "items": [
    {
      "quantity": 5,
      "product": "White Shirt",
      "price": 500
    }
  ]
}

Input:
"5 white shirts 500 rupaye aur 2 jeans 1200 rupaye"

Output:
{
  "items": [
    {
      "quantity": 5,
      "product": "White Shirts",
      "price": 500
    },
    {
      "quantity": 2,
      "product": "Jeans",
      "price": 1200
    }
  ]
}

Input:
"5 Peter England white shirts 800 rupaye"

Output:
{
  "items": [
    {
      "quantity": 5,
      "product": "Peter England White Shirts",
      "price": 800
    }
  ]
}

Now parse this sentence:

"${text}"`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();

    throw new Error(
      `Anthropic API error ${response.status}: ${errorText}`
    );
  }

  const data = await response.json();

  const textBlock = data.content?.find(
    (block) => block.type === "text"
  );

  if (!textBlock) {
    throw new Error("LLM did not return text");
  }

  /*
   * Claude should return pure JSON, but this also protects us
   * if it accidentally wraps the JSON in extra text.
   */
  const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);

  if (!jsonMatch) {
    throw new Error("Could not find JSON in LLM response");
  }

  const parsed = JSON.parse(jsonMatch[0]);

  if (!parsed || !Array.isArray(parsed.items)) {
    throw new Error("LLM response must contain an items array");
  }

  if (parsed.items.length === 0) {
    throw new Error("LLM returned no sale items");
  }

  return {
    items: parsed.items.map(normalizeItem),
  };
}

/**
 * Main parser.
 *
 * If Claude API key is configured:
 *     Claude -> if fails -> regex fallback
 *
 * If Claude key is not configured:
 *     regex parser
 */
async function parseSaleText(text) {
  if (!text || !String(text).trim()) {
    throw new Error("Sale text is required");
  }

  if (process.env.ANTHROPIC_API_KEY) {
    try {
      return await parseWithLLM(text);
    } catch (err) {
      console.warn(
        "LLM parse failed, falling back to regex parser:",
        err.message
      );
    }
  }

  return parseWithRegex(text);
}

module.exports = {
  parseSaleText,
  parseWithRegex,
  parseWithLLM,
};