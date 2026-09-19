// Converts spoken Hindi number-words (as transcribed by Sarvam, e.g.
// "तीन सौ" = "three hundred" = 300) into actual digits, so our regex
// parser can find them. This is what makes voice input work WITHOUT
// needing a paid LLM API — Sarvam already transcribes accurately, we
// just need to translate its number-words into digits ourselves.

const UNITS = {
    "एक": 1, "ek": 1,
    "दो": 2, "do": 2,
    "तीन": 3, "teen": 3,
    "चार": 4, "char": 4,
    "पांच": 5, "पाँच": 5, "panch": 5, "paanch": 5,
    "छह": 6, "छः": 6, "chhah": 6, "cheh": 6,
    "सात": 7, "saat": 7,
    "आठ": 8, "aath": 8,
    "नौ": 9, "nau": 9,
};

const TEENS = {
    "दस": 10, "das": 10,
    "ग्यारह": 11, "gyarah": 11,
    "बारह": 12, "baarah": 12,
    "तेरह": 13, "terah": 13,
    "चौदह": 14, "chaudah": 14,
    "पंद्रह": 15, "pandrah": 15,
    "सोलह": 16, "solah": 16,
    "सत्रह": 17, "satrah": 17,
    "अठारह": 18, "atharah": 18,
    "उन्नीस": 19, "unnees": 19,
};

const TENS = {
    "बीस": 20, "bees": 20,
    "तीस": 30, "tees": 30,
    "चालीस": 40, "chaalees": 40,
    "पचास": 50, "pachaas": 50,
    "साठ": 60, "saath": 60,
    "सत्तर": 70, "sattar": 70,
    "अस्सी": 80, "assee": 80,
    "नब्बे": 90, "nabbe": 90,
};

const MULTIPLIERS = {
    "सौ": 100, "sau": 100,
    "हज़ार": 1000, "हजार": 1000, "hazaar": 1000,
    "लाख": 100000, "laakh": 100000,
};

const COMPOUNDS = {
    "इक्कीस": 21, "बाईस": 22, "तेईस": 23, "चौबीस": 24, "पच्चीस": 25,
    "छब्बीस": 26, "सत्ताईस": 27, "अट्ठाईस": 28, "उनतीस": 29,
    "इकतीस": 31, "बत्तीस": 32, "तैंतीस": 33, "चौंतीस": 34, "पैंतीस": 35,
    "छत्तीस": 36, "सैंतीस": 37, "अड़तीस": 38, "उनतालीस": 39,
    "इकतालीस": 41, "बयालीस": 42, "तैंतालीस": 43, "चवालीस": 44, "पैंतालीस": 45,
    "छियालीस": 46, "सैंतालीस": 47, "अड़तालीस": 48, "उनचास": 49,
    "इक्यावन": 51, "बावन": 52, "तिरेपन": 53, "चौवन": 54, "पचपन": 55,
    "छप्पन": 56, "सत्तावन": 57, "अट्ठावन": 58, "उनसठ": 59,
    "इकसठ": 61, "बासठ": 62, "तिरेसठ": 63, "चौंसठ": 64, "पैंसठ": 65,
    "छियासठ": 66, "सड़सठ": 67, "अड़सठ": 68, "उनहत्तर": 69,
    "इकहत्तर": 71, "बहत्तर": 72, "तिहत्तर": 73, "चौहत्तर": 74, "पचहत्तर": 75,
    "छिहत्तर": 76, "सतहत्तर": 77, "अठहत्तर": 78, "उन्यासी": 79,
    "इक्यासी": 81, "बयासी": 82, "तिरासी": 83, "चौरासी": 84, "पचासी": 85,
    "छियासी": 86, "सत्तासी": 87, "अट्ठासी": 88, "नवासी": 89,
    "इक्यानवे": 91, "बानवे": 92, "तिरानवे": 93, "चौरानवे": 94, "पंचानवे": 95,
    "छियानवे": 96, "सत्तानवे": 97, "अट्ठानवे": 98, "निन्यानवे": 99,
};

const ALL_WORDS = { ...UNITS, ...TEENS, ...TENS, ...COMPOUNDS, ...MULTIPLIERS };

function combineWords(words) {
    let total = 0;
    let current = 0;
    for (const w of words) {
        const val = ALL_WORDS[w];
        if (val >= 100) {
            current = (current || 1) * val;
            if (val >= 1000) {
                total += current;
                current = 0;
            }
        } else {
            current += val;
        }
    }
    return total + current;
}

function convertHindiNumbersToDigits(text) {
    const tokens = text.split(/(\s+)/);
    const result = [];
    let buffer = [];

    function flushBuffer() {
        if (buffer.length > 0) {
            result.push(String(combineWords(buffer)));
            buffer = [];
        }
    }

    let pendingSpace = false;

    for (const token of tokens) {
        const clean = token.trim();
        if (!clean) {
            if (buffer.length === 0) {
                result.push(token);
            } else {
                pendingSpace = true;
            }
            continue;
        }
        if (ALL_WORDS[clean] !== undefined) {
            buffer.push(clean);
        } else {
            flushBuffer();
            if (pendingSpace) {
                result.push(" ");
                pendingSpace = false;
            }
            result.push(token);
        }
    }
    flushBuffer();

    return result.join("").replace(/\s+/g, " ").trim();
}

module.exports = { convertHindiNumbersToDigits };