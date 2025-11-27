// server.js — SIMS + LLM chat using Groq, loading key from .env

const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const fse = require('fs-extra');
const morgan = require('morgan');
const axios = require('axios');

// === MANUAL .env LOADER ==============================================
// We avoid dotenv and parse .env ourselves, trying UTF-8 and UTF-16LE.
// This fixes Windows/Notepad encoding issues.
function loadEnvFile() {
  const envPath = path.join(__dirname, '.env');

  if (!fs.existsSync(envPath)) {
    console.log('.env not found at', envPath);
    return;
  }

  const encodings = ['utf8', 'utf16le'];
  for (const enc of encodings) {
    try {
      const raw = fs.readFileSync(envPath, enc);
      let count = 0;

      raw
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'))
        .forEach((line) => {
          // Strip BOM if present
          const clean = line.replace(/^\uFEFF/, '');
          const idx = clean.indexOf('=');
          if (idx === -1) return;

          const key = clean.slice(0, idx).trim();
          const value = clean.slice(idx + 1).trim();

          if (key) {
            process.env[key] = value;
            count++;
          }
        });

      if (count > 0) {
        console.log(`Loaded ${count} env var(s) from .env using encoding ${enc}`);
        return; // stop after first encoding that works
      }
    } catch (e) {
      console.log(`Failed to read .env with encoding ${enc}:`, e.message);
    }
  }

  console.log('Could not load any variables from .env');
}

loadEnvFile();

// === LLM CONFIG (Groq) ================================================

const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const LLM_MODEL = process.env.LLM_MODEL || 'llama-3.3-70b-versatile';

console.log(
  'DEBUG LLM CONFIG:',
  'hasKey ->',
  !!GROQ_API_KEY,
  'model ->',
  LLM_MODEL
);

// =====================================================================

const app = express();

// IMPORTANT: Render provides PORT via env; fall back to 3000 for local dev
const PORT = process.env.PORT || 3000;

// DATA paths
// DATA_DIR can be overridden via env (e.g. /data on Render if you ever add a disk)
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'students.json');

// THIS is the seed data bundled with the project (your real JSON file)
const SEED_STUDENTS = require(path.join(__dirname, 'data', 'students.json'));

// --- middleware -------------------------------------------------------

app.use(
  cors({
    origin: [
      'http://127.0.0.1:5500',
      'https://aquaduskplant.github.io/ITE-18-MIDTERM-PROJECT/',
    ],
    methods: ['GET', 'POST', 'DELETE'],
  })
);

app.use(express.json({ limit: '2mb' }));
app.use(morgan('dev'));

// Serve static frontend from /public (works locally and on Render)
app.use(express.static(path.join(__dirname, 'public')));

// --- data helpers -----------------------------------------------------
// Seed from SEED_STUDENTS if students.json does not exist or is totally empty.
async function ensureDataFile() {
  await fse.ensureDir(DATA_DIR);

  const exists = await fse.pathExists(DATA_FILE);

  if (!exists) {
    // No file yet → seed from bundled JSON
    await fse.writeJson(DATA_FILE, SEED_STUDENTS, { spaces: 2 });
    console.log('Seeded students.json from bundled data/students.json (no file).');
    return;
  }

  // If file exists but is an empty array, optionally reseed
  try {
    const current = await fse.readJson(DATA_FILE);
    if (Array.isArray(current) && current.length === 0) {
      await fse.writeJson(DATA_FILE, SEED_STUDENTS, { spaces: 2 });
      console.log('Reseeded students.json because it was empty.');
    }
  } catch (e) {
    console.log('Failed to read existing DATA_FILE, reseeding:', e.message);
    await fse.writeJson(DATA_FILE, SEED_STUDENTS, { spaces: 2 });
  }
}

async function readStudents() {
  await ensureDataFile();
  return fse.readJson(DATA_FILE);
}

async function writeStudents(students) {
  await fse.writeJson(DATA_FILE, students, { spaces: 2 });
}

// --- routes -----------------------------------------------------------

// health
app.get('/health', (req, res) => res.json({ ok: true }));

// GET /students → return all students
app.get('/students', async (req, res) => {
  try {
    const students = await readStudents();
    res.json(students);
  } catch {
    res.status(500).json({ error: 'Failed to read students.' });
  }
});

// POST /students → add a student
app.post('/students', async (req, res) => {
  try {
    const payload = req.body;

    // Basic validation (server-side)
    const required = [
      'studentId',
      'fullName',
      'gender',
      'gmail',
      'program',
      'yearLevel',
      'university',
    ];
    for (const k of required) {
      if (!payload[k] || String(payload[k]).trim() === '') {
        return res.status(400).json({ error: `Missing field: ${k}` });
      }
    }

    if (!/^[A-Za-z0-9._%+-]+@gmail\.com$/i.test(payload.gmail)) {
      return res.status(400).json({ error: 'Email must be a valid Gmail address.' });
    }

    const isOrdinal = /^\d(st|nd|rd|th)\s+Year$/i.test(payload.yearLevel);
    const isNumYear = /^\d+$/.test(String(payload.yearLevel));
    if (!isOrdinal && !isNumYear) {
      return res
        .status(400)
        .json({ error: 'Year Level must be like "1st Year" or a number.' });
    }

    if (!/^[A-Z]{1,4}-\d{3}-\d{5}$/.test(payload.studentId)) {
      return res
        .status(400)
        .json({ error: 'Student ID format invalid (e.g., BP-113-00001).' });
    }

    const students = await readStudents();

    if (students.some((s) => s.studentId === payload.studentId)) {
      return res.status(409).json({ error: 'Student ID already exists.' });
    }

    students.push(payload);
    await writeStudents(students);
    res.status(201).json(payload);
  } catch {
    res.status(500).json({ error: 'Failed to add student.' });
  }
});

// DELETE /students/:id → delete a student
app.delete('/students/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const students = await readStudents();
    const idx = students.findIndex((s) => s.studentId === id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });

    const [removed] = students.splice(idx, 1);
    await writeStudents(students);
    res.json(removed);
  } catch {
    res.status(500).json({ error: 'Failed to delete student.' });
  }
});

// --- LLM CHAT: POST /chat (Groq) --------------------------------------
app.post('/chat', async (req, res) => {
  const { message } = req.body || {};

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Message is required.' });
  }

  try {
    const students = await readStudents();

    if (!Array.isArray(students) || students.length === 0) {
      return res.status(400).json({ error: 'No student data available.' });
    }

    if (!GROQ_API_KEY) {
      return res
        .status(500)
        .json({ error: 'LLM API key not configured on the server.' });
    }

    const systemPrompt =
      'You are an assistant for a Student Information Management System. ' +
      'You receive a JSON array of student records and a user question. ' +
      'Answer ONLY using the data in the array. If the answer is not in the data, say you cannot answer. ' +
      'When asked for counts, compute them correctly. When asked for lists, clearly list students.';

    const userPrompt =
      'Student data (JSON array):\n' +
      JSON.stringify(students) +
      '\n\nUser question:\n' +
      message;

    const llmRes = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: LLM_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.2,
      },
      {
        headers: {
          Authorization: `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );

    const reply = llmRes.data?.choices?.[0]?.message?.content?.trim();
    if (!reply) {
      return res.status(500).json({ error: 'Empty reply from LLM.' });
    }

    res.json({ reply });
  } catch (err) {
    console.error('LLM error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to contact LLM API.' });
  }
});

// Single-page app fallback (serves your UI)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- start ------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`SIMS server running on http://localhost:${PORT}`);
  console.log(`Data file: ${DATA_FILE}`);
});
