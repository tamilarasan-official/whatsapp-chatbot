// Generates the dummy PDFs in public/assets. Run once: node scripts/make-assets.js
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'public', 'assets');

function escapePdf(s) {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function pageStream(title, lines, pageNo, pageCount) {
  const ops = ['BT', '/F2 20 Tf', '56 770 Td', `(${escapePdf(title)}) Tj`, 'ET'];
  ops.push('BT', '/F1 9 Tf', '56 750 Td', '(Sample Institute - DUMMY DOCUMENT FOR DEMO PURPOSES ONLY) Tj', 'ET');
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
  'sample.pdf': ['Application Guidelines', [
    ['# 1. Eligibility', 'Applicants must be 18 years or older and have completed Class 12', 'or equivalent from a recognised board.', '',
      '# 2. Documents required', '- Identity proof', '- Address proof', '- A recent passport-size photograph'],
    ['# 3. How to apply', '1. Fill in the online application form on the portal.', '2. Upload your documents.', '3. Pay the fee online (UPI, card or net banking).',
      '4. Note your reference number, e.g. REF-2026-XXXXX.', '', '# 4. Last date', 'Applications close on 31 October 2026.'],
    ['# 5. Tracking and support', 'Send your reference number to the WhatsApp helpdesk to see your status.', 'Help desk: Monday to Friday, 9:30 AM to 5:30 PM.',
      'Grievances are answered within 3 working days.'],
  ]],
  'application-form.pdf': ['Application Form', [
    ['# Section A - Applicant details', 'Full name: ______________________________', 'Date of birth: ___________________________',
      'Mobile: _________________________________', 'Email: __________________________________'],
    ['# Section B - Declaration', 'I confirm the information above is correct.', '', 'Signature: ______________   Date: __________'],
  ]],
  'fee-structure.pdf': ['Fee Structure', [
    ['# Payment methods', 'UPI, debit card, credit card and net banking. Cash is not accepted.', '',
      '# Fee table', 'This is a dummy document. Fee amounts are intentionally not listed', 'in this demo.'],
  ]],
};

fs.mkdirSync(OUT, { recursive: true });
for (const [file, [title, pages]] of Object.entries(docs)) {
  fs.writeFileSync(path.join(OUT, file), buildPdf(title, pages), 'latin1');
  console.log('wrote', file);
}
