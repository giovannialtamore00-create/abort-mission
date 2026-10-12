// Merge the Google Form answers (CSV exported from the linked sheet) into learned-lines.json.
// Usage: node tools/import-lines.js responses.csv   (prints what was added; review the JSON before committing)
const fs = require('fs'), path = require('path');
const file = process.argv[2];
if (!file) { console.error('usage: node tools/import-lines.js responses.csv'); process.exit(1); }

function parseCsv(text) { // quoted fields, "" = quote, newlines allowed inside quotes
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

// reject spam, links, and text that tries to give instructions to the AI
const BAD = /https?:|www\.|\.com\b|ignore (all|previous|your)|system prompt|instruction|ignora (le|tutte|le tue)|\bprompt\b|<|>|\{(?!name\})|[^\s]{30,}/i;
const out = path.join(__dirname, '..', 'learned-lines.json');
let db = { openers: { en: [], it: [] }, questions: { en: [], it: [] } };
try { db = { ...db, ...JSON.parse(fs.readFileSync(out, 'utf8')) }; } catch {}
let added = 0, rejected = 0;
for (const row of parseCsv(fs.readFileSync(file, 'utf8'))) {
  let data = null;
  for (const cell of row) { try { const j = JSON.parse(cell); if (j && j.v === 1) data = j; } catch {} }
  if (!data) continue;
  const lang = data.lang === 'it' ? 'it' : 'en';
  for (const kind of ['openers', 'questions']) for (let x of data[kind] || []) {
    x = String(x).trim().replace(/\s+/g, ' ');
    const list = (db[kind][lang] = db[kind][lang] || []);
    if (x.length < 3 || x.length > 120 || BAD.test(x)) { rejected++; console.log('REJECT', kind, lang, x.slice(0, 60)); continue; }
    if (list.some((y) => y.toLowerCase() === x.toLowerCase())) continue;
    list.push(x); added++; console.log('ADD   ', kind, lang, x);
  }
}
fs.writeFileSync(out, JSON.stringify(db, null, 2) + '\n');
console.log(`added ${added}, rejected ${rejected} -> ${out}`);
