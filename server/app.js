import express from 'express';
import cors from 'cors';
import Database from 'better-sqlite3';
import { mkdirSync, existsSync, copyFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const bundledDb = join(__dirname, 'data', 'rsvp.sqlite');

function resolveDbPath() {
  if (process.env.VERCEL === '1') {
    const dir = join('/tmp', 'convite-thales');
    mkdirSync(dir, { recursive: true });
    const tmpDb = join(dir, 'rsvp.sqlite');
    if (!existsSync(tmpDb) && existsSync(bundledDb)) {
      copyFileSync(bundledDb, tmpDb);
    }
    return tmpDb;
  }
  const dataDir = join(__dirname, 'data');
  mkdirSync(dataDir, { recursive: true });
  return join(dataDir, 'rsvp.sqlite');
}

const DB_PATH = resolveDbPath();
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      event_title TEXT NOT NULL DEFAULT 'Aniversário',
      event_date TEXT NOT NULL DEFAULT '',
      organizer_email TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS families (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      responsible TEXT NOT NULL DEFAULT '',
      responded_at TEXT
    );
    CREATE TABLE IF NOT EXISTS family_members (
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'yes', 'no'))
    );
    CREATE INDEX IF NOT EXISTS idx_members_family ON family_members(family_id);
  `);
  const row = db.prepare('SELECT COUNT(*) as c FROM settings WHERE id = 1').get();
  if (row.c === 0) {
    db.prepare('INSERT INTO settings (id) VALUES (1)').run();
  }
}

initSchema();

function migrateSchema() {
  const cols = db.prepare('PRAGMA table_info(families)').all();
  if (!cols.some((c) => c.name === 'rsvp_note')) {
    db.exec(`ALTER TABLE families ADD COLUMN rsvp_note TEXT NOT NULL DEFAULT ''`);
  }
}

migrateSchema();

function slugify(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'familia';
}

function getSettings() {
  return db.prepare('SELECT event_title as eventTitle, event_date as eventDate, organizer_email as organizerEmail FROM settings WHERE id = 1').get();
}

function setSettings({ eventTitle, eventDate, organizerEmail }) {
  db.prepare(
    `UPDATE settings SET event_title = ?, event_date = ?, organizer_email = ? WHERE id = 1`
  ).run(eventTitle ?? 'Aniversário', eventDate ?? '', organizerEmail ?? '');
}

function listFamilies() {
  const families = db
    .prepare('SELECT id, slug, name, responsible, responded_at as respondedAt, rsvp_note as rsvpNote FROM families ORDER BY name')
    .all();
  const membersStmt = db.prepare(
    'SELECT id, name, status FROM family_members WHERE family_id = ? ORDER BY sort_order, name'
  );
  return families.map((f) => ({
    ...f,
    members: membersStmt.all(f.id),
  }));
}

function buildRsvpBlock({ slug, familyName, choices, eventTitle, message }) {
  const lines = [
    'RSVP_V1',
    'SLUG:' + slug,
    'FAMILIA:' + familyName,
    'DATA_ISO:' + new Date().toISOString(),
    'EVENTO:' + (eventTitle || ''),
    '---',
  ];
  for (const c of choices) {
    lines.push(c.id + ':' + (c.status === 'yes' ? 'SIM' : 'NAO'));
  }
  if (message && String(message).trim()) {
    const rec = String(message)
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 2000);
    lines.push('RECADO:' + rec);
  }
  lines.push('---FIM---');
  return lines.join('\n');
}

function parseRsvpText(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines[0] !== 'RSVP_V1') {
    throw new Error('Cabeçalho inválido. Cole o bloco completo começando com RSVP_V1.');
  }
  let slug = null;
  let famName = null;
  const map = {};
  for (const line of lines) {
    if (line.startsWith('SLUG:')) slug = line.slice(5).trim();
    else if (line.startsWith('FAMILIA:')) famName = line.slice(8).trim();
    else if (/^([^:]+):(SIM|NAO)$/i.test(line)) {
      const colon = line.indexOf(':');
      const id = line.slice(0, colon);
      const st = line.slice(colon + 1);
      map[id] = st.toUpperCase() === 'SIM' ? 'yes' : 'no';
    }
  }
  if (!slug) throw new Error('Slug não encontrado no texto.');
  return { slug, famName, map };
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/api/settings', (_req, res) => {
  res.json(getSettings());
});

app.put('/api/settings', (req, res) => {
  try {
    const { eventTitle, eventDate, organizerEmail } = req.body || {};
    setSettings({
      eventTitle: String(eventTitle ?? '').trim() || 'Aniversário',
      eventDate: String(eventDate ?? '').trim(),
      organizerEmail: String(organizerEmail ?? '').trim(),
    });
    res.json(getSettings());
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.get('/api/families', (_req, res) => {
  res.json(listFamilies());
});

app.post('/api/families', (req, res) => {
  try {
    const { name, responsible, memberNames } = req.body || {};
    const n = String(name || '').trim();
    if (!n) return res.status(400).json({ error: 'Nome da família é obrigatório.' });
    const names = Array.isArray(memberNames)
      ? memberNames.map((x) => String(x).trim()).filter(Boolean)
      : String(memberNames || '')
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean);
    if (!names.length) return res.status(400).json({ error: 'Informe ao menos um membro.' });

    const id = randomUUID();
    const slug = slugify(n) + '-' + randomUUID().slice(0, 4);
    const tx = db.transaction(() => {
      db.prepare('INSERT INTO families (id, slug, name, responsible) VALUES (?,?,?,?)').run(
        id,
        slug,
        n,
        String(responsible || '').trim()
      );
      const ins = db.prepare(
        'INSERT INTO family_members (id, family_id, name, sort_order, status) VALUES (?,?,?,?,?)'
      );
      names.forEach((memName, i) => {
        ins.run(randomUUID(), id, memName, i, 'pending');
      });
    });
    tx();
    const families = listFamilies();
    const created = families.find((f) => f.id === id);
    res.status(201).json(created);
  } catch (e) {
    if (String(e.message || '').includes('UNIQUE')) {
      return res.status(409).json({ error: 'Slug em conflito; tente de novo.' });
    }
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.patch('/api/families/:id', (req, res) => {
  try {
    const { id } = req.params;
    const row = db.prepare('SELECT id FROM families WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: 'Família não encontrada.' });

    const { name, responsible, members } = req.body || {};
    const n = name !== undefined ? String(name).trim() : null;
    const r = responsible !== undefined ? String(responsible).trim() : null;

    if (Array.isArray(members) && members.length === 0) {
      return res.status(400).json({ error: 'Informe ao menos um membro.' });
    }

    const tx = db.transaction(() => {
      if (n !== null && n !== '') {
        db.prepare('UPDATE families SET name = ? WHERE id = ?').run(n, id);
      }
      if (r !== null) {
        db.prepare('UPDATE families SET responsible = ? WHERE id = ?').run(r, id);
      }
      if (Array.isArray(members)) {
        const existing = db.prepare('SELECT id, status FROM family_members WHERE family_id = ?').all(id);
        const existingById = new Map(existing.map((m) => [m.id, m.status]));
        db.prepare('DELETE FROM family_members WHERE family_id = ?').run(id);
        const ins = db.prepare(
          'INSERT INTO family_members (id, family_id, name, sort_order, status) VALUES (?,?,?,?,?)'
        );
        members.forEach((m, i) => {
          const memName = String(m.name || '').trim();
          if (!memName) return;
          const mid = String(m.id || '').trim() || randomUUID();
          const st = existingById.has(mid) ? existingById.get(mid) : 'pending';
          ins.run(mid, id, memName, i, st);
        });
        db.prepare('UPDATE families SET responded_at = NULL WHERE id = ?').run(id);
      }
    });
    tx();
    const families = listFamilies();
    res.json(families.find((f) => f.id === id));
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.delete('/api/families/:id', (req, res) => {
  const { id } = req.params;
  const r = db.prepare('DELETE FROM families WHERE id = ?').run(id);
  if (r.changes === 0) return res.status(404).json({ error: 'Não encontrado.' });
  res.status(204).end();
});

app.get('/api/public/families/:slug', (req, res) => {
  const { slug } = req.params;
  const fam = db.prepare('SELECT slug, name, responsible FROM families WHERE slug = ?').get(slug);
  if (!fam) return res.status(404).json({ error: 'Link inválido ou família não encontrada.' });
  const settings = getSettings();
  const members = db
    .prepare('SELECT id, name, status FROM family_members WHERE family_id = (SELECT id FROM families WHERE slug = ?) ORDER BY sort_order, name')
    .all(slug);
  res.json({
    eventTitle: settings.eventTitle,
    eventDate: settings.eventDate,
    organizerEmail: settings.organizerEmail,
    family: fam,
    members,
  });
});

app.post('/api/public/families/:slug/rsvp', (req, res) => {
  try {
    const { slug } = req.params;
    const { responses, message, justification } = req.body || {};
    if (!responses || typeof responses !== 'object') {
      return res.status(400).json({ error: 'Envie responses: { [memberId]: "yes" | "no" }' });
    }
    const rawNote = typeof message === 'string' ? message : typeof justification === 'string' ? justification : '';
    const note =
      typeof rawNote === 'string'
        ? rawNote
            .trim()
            .replace(/\s+/g, ' ')
            .slice(0, 2000)
        : '';
    const fam = db
      .prepare('SELECT id, slug, name FROM families WHERE slug = ?')
      .get(slug);
    if (!fam) return res.status(404).json({ error: 'Família não encontrada.' });

    const members = db
      .prepare('SELECT id, name FROM family_members WHERE family_id = ?')
      .all(fam.id);
    for (const m of members) {
      const st = responses[m.id];
      if (st !== 'yes' && st !== 'no') {
        return res.status(400).json({ error: 'Resposta obrigatória (yes/no) para: ' + m.name });
      }
    }

    const settings = getSettings();
    const tx = db.transaction(() => {
      const upd = db.prepare('UPDATE family_members SET status = ? WHERE id = ? AND family_id = ?');
      for (const m of members) {
        upd.run(responses[m.id], m.id, fam.id);
      }
      db.prepare('UPDATE families SET responded_at = ?, rsvp_note = ? WHERE id = ?').run(
        new Date().toISOString(),
        note,
        fam.id
      );
    });
    tx();

    const choices = members.map((m) => ({
      id: m.id,
      name: m.name,
      status: responses[m.id],
    }));
    const block = buildRsvpBlock({
      slug: fam.slug,
      familyName: fam.name,
      choices,
      eventTitle: settings.eventTitle,
      message: note,
    });
    res.json({
      block,
      familyName: fam.name,
      responsible: db.prepare('SELECT responsible FROM families WHERE id = ?').get(fam.id).responsible,
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.post('/api/rsvp-import', (req, res) => {
  try {
    const text = String((req.body || {}).text || '').trim();
    if (!text) return res.status(400).json({ error: 'Texto vazio.' });
    const { slug, famName, map } = parseRsvpText(text);
    const fam = db.prepare('SELECT id, name FROM families WHERE slug = ?').get(slug);
    if (!fam) return res.status(400).json({ error: 'Nenhuma família cadastrada com o slug: ' + slug });

    const mems = db.prepare('SELECT id FROM family_members WHERE family_id = ?').all(fam.id);
    let changed = 0;
    const tx = db.transaction(() => {
      const upd = db.prepare('UPDATE family_members SET status = ? WHERE id = ? AND family_id = ?');
      for (const m of mems) {
        if (map[m.id] !== undefined) {
          const cur = db.prepare('SELECT status FROM family_members WHERE id = ?').get(m.id);
          if (cur && cur.status !== map[m.id]) changed++;
          upd.run(map[m.id], m.id, fam.id);
        }
      }
      db.prepare('UPDATE families SET responded_at = ? WHERE id = ?').run(new Date().toISOString(), fam.id);
    });
    tx();
    res.json({ changed, famName: famName || fam.name });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.get('/api/export', (_req, res) => {
  const settings = getSettings();
  const families = listFamilies();
  res.json({
    v: 1,
    eventTitle: settings.eventTitle,
    eventDate: settings.eventDate,
    organizerEmail: settings.organizerEmail,
    families,
  });
});

app.post('/api/import-backup', (req, res) => {
  try {
    const data = req.body;
    if (!data || data.v !== 1 || !Array.isArray(data.families)) {
      return res.status(400).json({ error: 'JSON inválido: esperado { v:1, families: [...] }' });
    }
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM family_members').run();
      db.prepare('DELETE FROM families').run();
      setSettings({
        eventTitle: data.eventTitle,
        eventDate: data.eventDate,
        organizerEmail: data.organizerEmail,
      });
      const insF = db.prepare(
        'INSERT INTO families (id, slug, name, responsible, responded_at, rsvp_note) VALUES (?,?,?,?,?,?)'
      );
      const insM = db.prepare(
        'INSERT INTO family_members (id, family_id, name, sort_order, status) VALUES (?,?,?,?,?)'
      );
      for (const f of data.families) {
        insF.run(
          f.id,
          f.slug,
          f.name,
          f.responsible || '',
          f.respondedAt || null,
          f.rsvpNote || ''
        );
        (f.members || []).forEach((m, i) => {
          insM.run(m.id, f.id, m.name, i, m.status === 'yes' || m.status === 'no' ? m.status : 'pending');
        });
      }
    });
    tx();
    res.json({ ok: true, families: listFamilies().length });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

export default app;
