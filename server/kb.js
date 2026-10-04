const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf8'));
}

const org = readJson('org.json');
const faqs = readJson('faqs.json');
const applications = readJson('applications.json');

function findApplication(ref) {
  const key = String(ref || '').trim().toUpperCase();
  return applications.find((a) => a.ref === key) || null;
}

function faqIds() {
  return new Set(faqs.map((f) => f.id));
}

module.exports = { DATA_DIR, org, faqs, applications, findApplication, faqIds };
