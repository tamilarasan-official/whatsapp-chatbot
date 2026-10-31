const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf8'));
}

const org = readJson('org.json');
const complaints = readJson('complaints.json');

function findComplaint(ref) {
  const key = String(ref || '').trim().toUpperCase();
  return complaints.find((c) => c.ref === key) || null;
}

module.exports = { DATA_DIR, org, complaints, findComplaint };
