/**
 * Usage:
 *   node tools/paste-to-json.js "BP-113-00001 | Chelsea Greer | Female | chelseagreer@gmail.com | BS Physics | 5th Year | Caraga State University - Cabadbaran Campus
 *   BM-113-00002 | Nicolas Medina | Male | nicolasmedina@gmail.com | BS Mathematics | 5th Year | Caraga State University - Main Campus"
 */
const fse = require('fs-extra');
const path = require('path');

(async () => {
  const DATA_FILE = path.join(__dirname, '..', 'data', 'students.json');
  await fse.ensureFile(DATA_FILE);
  const exists = await fse.pathExists(DATA_FILE);
  if (!exists) await fse.writeJson(DATA_FILE, []);

  const current = await fse.readJson(DATA_FILE);

  const arg = process.argv.slice(2).join('\n');
  if (!arg.trim()) {
    console.error('Paste pipe-separated rows as argument.');
    process.exit(1);
  }
  const lines = arg.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  const rows = [];
  for (const line of lines) {
    const parts = line.split('|').map(s => s.trim());
    if (parts.length !== 7) { console.warn('Skip invalid:', line); continue; }
    const [studentId, fullName, gender, gmail, program, yearLevel, university] = parts;
    rows.push({ studentId, fullName, gender, gmail, program, yearLevel, university });
  }

  // de-dup by studentId
  const ids = new Set(current.map(s => s.studentId));
  for (const r of rows) if (!ids.has(r.studentId)) current.push(r);

  await fse.writeJson(DATA_FILE, current, { spaces: 2 });
  console.log(`Added ${rows.length} rows. New total: ${current.length}`);
})();
