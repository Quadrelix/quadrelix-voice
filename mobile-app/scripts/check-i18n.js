// Checks the translation files.   node scripts/check-i18n.js
//  1. every key exists in BOTH English and Hindi
//  2. every literal t('some.key') used in screens/components/App.js exists
//  3. flags Hindi strings that contain no Devanagari (likely untranslated)
const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');

const root = path.resolve(__dirname, '..');
const stringsDir = path.join(root, 'i18n', 'strings');

function keysOf(file) {
  const ast = parser.parse(fs.readFileSync(file, 'utf8'), { sourceType: 'module', plugins: ['jsx'] });
  const decl = ast.program.body.find((n) => n.type === 'ExportDefaultDeclaration');
  const out = { en: {}, hi: {} };
  for (const lang of ['en', 'hi']) {
    const prop = decl.declaration.properties.find((p) => (p.key.name || p.key.value) === lang);
    for (const p of prop.value.properties) out[lang][p.key.value ?? p.key.name] = p.value.value ?? '';
  }
  return out;
}

const all = { en: {}, hi: {} };
let problems = 0;
for (const f of fs.readdirSync(stringsDir).filter((n) => n.endsWith('.js'))) {
  const k = keysOf(path.join(stringsDir, f));
  for (const key of Object.keys(k.en)) if (!(key in k.hi)) { console.log(`MISSING hi  ${f}: ${key}`); problems++; }
  for (const key of Object.keys(k.hi)) if (!(key in k.en)) { console.log(`MISSING en  ${f}: ${key}`); problems++; }
  for (const [key, v] of Object.entries(k.hi)) {
    if (v && !/[ऀ-ॿ]/.test(v) && /[A-Za-z]{4,}/.test(v) && !/^(WhatsApp|UPI|OTP|PIN|EN|BizMate|[₹\d\s{}.,:-]+)/i.test(v)) {
      console.log(`CHECK hi has no Devanagari  ${f}: ${key} = ${v}`);
    }
  }
  for (const key of Object.keys(k.en)) {
    if (key in all.en) { console.log(`DUPLICATE key across files: ${key}`); problems++; }
  }
  Object.assign(all.en, k.en); Object.assign(all.hi, k.hi);
}

const used = new Set();
const targets = ['App.js'];
for (const dir of ['screens', 'components']) {
  for (const n of fs.readdirSync(path.join(root, dir))) if (n.endsWith('.js')) targets.push(path.join(dir, n));
}
for (const rel of targets) {
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  for (const m of src.matchAll(/\bt\(\s*'([^']+)'/g)) {
    used.add(m[1]);
    if (!(m[1] in all.en)) { console.log(`UNDEFINED key used in ${rel}: ${m[1]}`); problems++; }
  }
}
console.log(`${Object.keys(all.en).length} keys, ${used.size} distinct literal keys used, ${problems} problem(s)`);
process.exit(problems ? 1 : 0);
