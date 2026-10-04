// Generates the dummy PDFs in public/assets. Run once: node scripts/make-assets.js
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'public', 'assets');

function escapePdf(s) {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function pageStream(title, lines, pageNo, pageCount) {
  const ops = ['BT', '/F2 20 Tf', '56 770 Td', `(${escapePdf(title)}) Tj`, 'ET'];
  ops.push('BT', '/F1 9 Tf', '56 750 Td', '(DEMO SAMPLE - NOT AN OFFICIAL ECI DOCUMENT. Official forms: voters.eci.gov.in) Tj', 'ET');
  let y = 710;
  for (const line of lines) {
    const bold = line.startsWith('# ');
    const text = bold ? line.slice(2) : line;
    ops.push('BT', `/${bold ? 'F2' : 'F1'} ${bold ? 13 : 11} Tf`, `56 ${y} Td`, `(${escapePdf(text)}) Tj`, 'ET');
    y -= bold ? 24 : 18;
  }
  ops.push('BT', '/F1 9 Tf', '56 40 Td', `(Page ${pageNo} of ${pageCount}) Tj`, 'ET');
  return ops.join('\n');
}

function buildPdf(title, pages) {
  const objects = [];
  const add = (body) => objects.push(body) && objects.length;

  const catalog = add('');
  const pagesObj = add('');
  const font1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const font2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  const kids = pages.map((lines, i) => {
    const content = pageStream(title, lines, i + 1, pages.length);
    const stream = add(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
    return add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font1} 0 R /F2 ${font2} 0 R >> >> /Contents ${stream} 0 R >>`);
  });
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objects[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return pdf;
}

const docs = {
  'voter-guide.pdf': ['Voter Guide (demo)', [
    ['# 1. Who can register', 'Indian citizens aged 18 or above on a qualifying date', '(1 January, 1 April, 1 July or 1 October), ordinarily resident', 'in the constituency.', '',
      '# 2. Documents for Form 6', '- Recent passport-size photograph', '- Proof of age (birth certificate, Class 10 marksheet, passport)', '- Proof of address (Aadhaar, passport, bank passbook, utility bill)'],
    ['# 3. Forms', 'Form 6  - New voter registration', 'Form 6A - Overseas (NRI) elector', 'Form 7  - Objection / deletion of a name',
      'Form 8  - Correction, shifting, replacement EPIC, PwD marking', '', '# 4. Apply and track', 'voters.eci.gov.in or the Voter Helpline App. Helpline: 1950.'],
    ['# 5. On polling day', 'Carry your EPIC or an ECI-approved alternative photo ID', '(Aadhaar, passport, driving licence, PAN card, MGNREGA job card, ...).',
      'Find your polling station on electoralsearch.eci.gov.in.', 'NOTA (None of the Above) is available on the EVM.'],
  ]],
  'form-6-sample.pdf': ['Form 6 - New Voter Registration (demo sample)', [
    ['# Part A - Applicant details', 'Name: ______________________________', 'Date of birth: _____________________',
      'Mobile: ____________________________', 'Ordinary residence address: __________________________'],
    ['# Part B - Declaration', 'I am a citizen of India and the information given is true.', '', 'Signature: ______________   Date: __________'],
  ]],
  'form-8-sample.pdf': ['Form 8 - Correction or Shifting (demo sample)', [
    ['# Select one', '[ ] Shifting of residence', '[ ] Correction of entries in the electoral roll', '[ ] Issue of replacement EPIC',
      '[ ] Marking as person with disability', '', 'EPIC number: ____________________', 'Details to change: __________________________'],
  ]],
};

fs.mkdirSync(OUT, { recursive: true });
for (const [file, [title, pages]] of Object.entries(docs)) {
  fs.writeFileSync(path.join(OUT, file), buildPdf(title, pages), 'latin1');
  console.log('wrote', file);
}
