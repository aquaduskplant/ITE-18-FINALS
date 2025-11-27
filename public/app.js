// app.js — auto-detect BASE
// - On local Live Server (127.0.0.1:5500): calls API on http://127.0.0.1:3000
// - On Render (same origin): calls the same host (no CORS)
const ORIGIN = window.location.origin;
const isLiveServer =
  ORIGIN.includes('127.0.0.1:5500') ||
  ORIGIN.includes('localhost:5500');

const BASE = isLiveServer ? 'http://127.0.0.1:3000' : ORIGIN;

const API = {
  list: async () => (await fetch(`${BASE}/students`)).json(),
  add: async (data) => {
    const res = await fetch(`${BASE}/students`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const out = await res.json();
    if (!res.ok) throw new Error(out.error || 'Failed to add');
    return out;
  },
  remove: async (id) => {
    const res = await fetch(`${BASE}/students/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    const out = await res.json();
    if (!res.ok) throw new Error(out.error || 'Failed to delete');
    return out;
  },
};

const el = (q, root = document) => root.querySelector(q);
const els = (q, root = document) => [...root.querySelectorAll(q)];

const form = el('#studentForm');
const tableBody = el('#studentsTable tbody');
const count = el('#count');
const q = el('#q');
const fltGender = el('#fltGender');
const fltProgram = el('#fltProgram');
const fltYear = el('#fltYear');
const resetFilters = el('#resetFilters');
const bulkText = el('#bulkText');
const bulkAddBtn = el('#bulkAddBtn');

// chat DOM
const chatForm = el('#chatForm');
const chatInput = el('#chatInput');
const chatLog = el('#chatLog');
const chatStatus = el('#chatStatus');

let allStudents = [];
let viewStudents = [];

init();

async function init() {
  await reload();
  wireForm();
  wireFilters();
  wireBulk();
  wireChat(); // new
}

async function reload() {
  allStudents = await API.list();
  render(allStudents);
}

function render(rows) {
  viewStudents = rows;
  if (count) count.textContent = rows.length;
  if (!tableBody) return;

  tableBody.innerHTML = rows
    .map(
      (s) => `
    <tr>
      <td><code>${escapeHtml(s.studentId)}</code></td>
      <td>${escapeHtml(s.fullName)}</td>
      <td><span class="badge">${escapeHtml(s.gender)}</span></td>
      <td>${escapeHtml(s.gmail)}</td>
      <td>${escapeHtml(s.program)}</td>
      <td>${escapeHtml(s.yearLevel)}</td>
      <td>${escapeHtml(s.university)}</td>
      <td><button class="del" data-id="${escapeAttr(s.studentId)}">Delete</button></td>
    </tr>
  `
    )
    .join('');

  // bind deletes
  els('.del').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this student?')) return;
      try {
        await API.remove(btn.dataset.id);
        await reload();
      } catch (e) {
        alert(e.message);
      }
    });
  });
}

function wireForm() {
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());

    // client-side validation
    const errors = [];
    if (!/^[A-Z]{1,4}-\d{3}-\d{5}$/.test(data.studentId)) {
      errors.push('Student ID must look like BP-113-00001.');
    }
    if (!/^[A-Za-z ]{2,}$/.test(data.fullName)) {
      errors.push('Full Name must be letters/spaces.');
    }
    if (!/^[A-Za-z0-9._%+-]+@gmail\.com$/i.test(data.gmail)) {
      errors.push('Gmail must be a valid @gmail.com email.');
    }
    if (!data.program.trim()) errors.push('Program is required.');
    if (!data.university.trim()) errors.push('University is required.');

    // year: accept "5th Year" or "5"
    const yl = String(data.yearLevel).trim();
    if (!/^\d+$/.test(yl) && !/^\d(st|nd|rd|th)\s+Year$/i.test(yl)) {
      errors.push('Year Level must be like "5th Year" or a number 1..6.');
    }

    if (errors.length) {
      alert(errors.join('\n'));
      return;
    }

    try {
      await API.add(data);
      form.reset();
      await reload();
    } catch (e2) {
      alert(e2.message);
    }
  });
}

function wireFilters() {
  if (!q || !fltGender || !fltProgram || !fltYear) return;

  const update = () => {
    const kw = q.value.trim().toLowerCase();
    const g = fltGender.value;
    const p = fltProgram.value.trim().toLowerCase();
    const y = fltYear.value;

    const filtered = allStudents.filter((s) => {
      const hay = `${s.fullName} ${s.program} ${s.university}`.toLowerCase();
      if (kw && !hay.includes(kw)) return false;
      if (g && s.gender !== g) return false;
      if (p && !s.program.toLowerCase().includes(p)) return false;
      if (y) {
        const num = getYearNumber(s.yearLevel);
        if (String(num) !== y) return false;
      }
      return true;
    });

    render(filtered);
  };

  [q, fltGender, fltProgram, fltYear].forEach((inp) => {
    inp.addEventListener('input', update);
    inp.addEventListener('change', update);
  });

  if (resetFilters) {
    resetFilters.addEventListener('click', () => {
      q.value = '';
      fltGender.value = '';
      fltProgram.value = '';
      fltYear.value = '';
      render(allStudents);
    });
  }
}

function wireBulk() {
  if (!bulkAddBtn || !bulkText) return;

  bulkAddBtn.addEventListener('click', async () => {
    const text = bulkText.value.trim();
    if (!text) return alert('Paste rows first.');

    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    let ok = 0,
      fail = 0,
      msgs = [];
    for (const line of lines) {
      const parts = line.split('|').map((s) => s.trim());
      if (parts.length !== 7) {
        fail++;
        msgs.push(`Invalid: ${line}`);
        continue;
      }
      const [studentId, fullName, gender, gmail, program, yearLevel, university] =
        parts;
      try {
        await API.add({
          studentId,
          fullName,
          gender,
          gmail,
          program,
          yearLevel,
          university,
        });
        ok++;
      } catch (e) {
        fail++;
        msgs.push(`${studentId || '(no id)'} → ${e.message}`);
      }
    }
    bulkText.value = '';
    await reload();
    alert(
      `Bulk add done. Success: ${ok}, Failed: ${fail}${
        msgs.length ? '\n\nDetails:\n' + msgs.join('\n') : ''
      }`
    );
  });
}

// ---- LLM chat wiring ----
function wireChat() {
  if (!chatForm || !chatInput) return;

  chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text) return;
    appendMsg('user', text);
    chatInput.value = '';
    if (chatStatus) chatStatus.textContent = 'Asking LLM...';

    try {
      const res = await fetch(`${BASE}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error || 'Chat failed.');
      appendMsg('bot', out.reply);
    } catch (err) {
      appendMsg('system', 'Error: ' + err.message);
    } finally {
      if (chatStatus) chatStatus.textContent = '';
    }
  });
}

function appendMsg(role, text) {
  if (!chatLog) return;
  const div = document.createElement('div');
  div.className = 'msg ' + role;
  div.textContent = text;
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
}

// ---- helpers ----
function getYearNumber(yl) {
  const m = String(yl).match(/^(\d+)/);
  return m ? Number(m[1]) : NaN;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
function escapeAttr(s) {
  return String(s).replaceAll('"', '&quot;');
}



// --- Floating chat widget open/close ---
const chatWidget = document.getElementById('chatWidget');
const chatFab = document.getElementById('chatFab');
const chatCloseBtn = document.getElementById('chatCloseBtn');

if (chatWidget && chatFab && chatCloseBtn) {
  // start with widget hidden, fab visible
  chatWidget.classList.remove('open');

  chatFab.addEventListener('click', () => {
    chatWidget.classList.add('open');
    chatFab.classList.add('hidden');
  });

  chatCloseBtn.addEventListener('click', () => {
    chatWidget.classList.remove('open');
    chatFab.classList.remove('hidden');
  });
}

