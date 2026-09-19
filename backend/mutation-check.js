// Mutation testing: deliberately sabotage the modules under test and confirm the
// suite NOTICES. A test that still passes against broken code proves nothing.
//
// Run with: node mutation-check.js   (from backend/)
// Always restores every file it touched, including on crash.
//
// NOT named test-*.js on purpose: `node --test` globs test-*.js as well as
// test/**, so a name like test-mutations.js makes this file run itself inside
// every suite it launches — which reported the same six failures for every
// mutation and told us nothing.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const FILES = {
  parser: path.join(__dirname, "src", "services", "parser.js"),
  phone: path.join(__dirname, "src", "services", "phoneNumber.js"),
  utterance: path.join(__dirname, "src", "services", "utterance.js"),
};

const originals = {};
for (const [key, file] of Object.entries(FILES)) {
  originals[key] = fs.readFileSync(file, "utf8");
}

const MUTATIONS = [
  {
    file: "parser",
    name: "unit list forgets 'kilo'",
    find: 'kilo: ["kilo", "kilos", "kg", "kgs", "kilogram", "kilograms"],',
    replace: 'kilo: ["kilos", "kg", "kgs", "kilogram", "kilograms"],',
    expectFail: "the unit of measure is its own field",
  },
  {
    file: "parser",
    name: "WORTH_OF_END lookahead removed (\\b would behave like this)",
    find: 'const WORTH_OF_END = "(?=\\\\s|$)";',
    replace: 'const WORTH_OF_END = "";',
    expectFail: "products that merely start like a postposition",
  },
  {
    file: "parser",
    // "5 साड़ी ₹300" is NOT discriminating here: with the marker gone the chunk
    // falls through to the positional path and happens to land on the same
    // answer. "aam ₹60 2 kilo" does discriminate — positionally the 60 reads as
    // the quantity and the 2 as the price.
    name: "PRICE_MARKED stops recognising the ₹ marker",
    find: '"₹\\\\s*(\\\\d+(?:\\\\.\\\\d+)?)" +',
    replace: '"(?!)(\\\\d+(?:\\\\.\\\\d+)?)" +',
    expectFail: "parse the same in any order",
  },
  {
    file: "phone",
    // The one rule standing between "any 10-digit number auto-sends a bill" and
    // a bill going out because someone read an order id aloud.
    name: "phone detector accepts any 10-digit run, not just 6-9 first digit",
    find: "const isMobile = (s) => s.length === 10 && /^[6-9]/.test(s);",
    replace: "const isMobile = (s) => s.length === 10;",
    expectFail: "10-digit run that can't be an Indian mobile",
  },
  {
    file: "phone",
    // Zero was the gap that made spoken numbers unusable before this module
    // existed — hindiNumbers.js has no शून्य at all.
    name: "digit table loses spoken zero",
    find: '"शून्य": "0", ',
    replace: "",
    expectFail: "zero is recognised in all the ways",
  },
  {
    file: "utterance",
    // Without the null check every repeat of a product name overwrites an
    // existing price instead of becoming its own line — two real sales of the
    // same item would silently collapse into one.
    name: "price-fill stops checking that the existing price is missing",
    find: "item && item.price == null && !claimed.has(index)",
    replace: "item && true && !claimed.has(index)",
    expectFail: "genuine second line",
  },
];

function runSuite() {
  try {
    execFileSync("npm", ["test"], {
      cwd: __dirname,
      encoding: "utf8",
      stdio: "pipe",
      shell: true,
    });
    return { passed: true, output: "" };
  } catch (err) {
    return { passed: false, output: `${err.stdout || ""}${err.stderr || ""}` };
  }
}

let allGood = true;
try {
  for (const m of MUTATIONS) {
    const source = originals[m.file];
    if (!source.includes(m.find)) {
      console.log(
        `SKIPPED  ${m.name}\n         anchor not found in ${m.file} — mutation would be a silent no-op`
      );
      allGood = false;
      continue;
    }
    fs.writeFileSync(FILES[m.file], source.replace(m.find, m.replace));

    const { passed, output } = runSuite();
    fs.writeFileSync(FILES[m.file], source); // restore before reporting

    if (passed) {
      console.log(`NOT CAUGHT  ${m.name}\n            suite still passes — coverage is vacuous`);
      allGood = false;
      continue;
    }

    const failedTests = [...output.matchAll(/^not ok \d+ - (.+)$/gm)].map((x) => x[1].trim());
    const hit = failedTests.some((t) => t.includes(m.expectFail));
    console.log(
      `CAUGHT      ${m.name}\n` +
        `            ${failedTests.length} test(s) failed: ${failedTests.join(" | ")}\n` +
        `            expected "${m.expectFail}…" among them: ${hit ? "yes" : "NO"}`
    );
    if (!hit) allGood = false;
  }
} finally {
  for (const [key, file] of Object.entries(FILES)) {
    fs.writeFileSync(file, originals[key]);
  }
  console.log("\nAll mutated files restored.");
}

console.log(allGood ? "\nAll mutations caught by the intended tests." : "\nSome mutations were NOT caught.");
process.exit(allGood ? 0 : 1);
