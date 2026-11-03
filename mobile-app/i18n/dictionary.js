// Merges the per-screen string files into one dictionary per language.
// To add a screen: create i18n/strings/<name>.js ({ en, hi }) and list it here.
import common from './strings/common';
import home from './strings/home';
import handsfree from './strings/handsfree';
import shop from './strings/shop';
import products from './strings/products';
import customers from './strings/customers';
import reports from './strings/reports';
import voiceEnroll from './strings/voiceEnroll';
import calibrate from './strings/calibrate';

const parts = [common, home, handsfree, shop, products, customers, reports, voiceEnroll, calibrate];

const dictionary = { en: {}, hi: {} };
for (const p of parts) {
  Object.assign(dictionary.en, p.en);
  Object.assign(dictionary.hi, p.hi);
}

export default dictionary;
