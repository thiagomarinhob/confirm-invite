import express from 'express';
import cors from 'cors';
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dirname, 'data', 'rsvp.json');
/** Na Vercel o pacote é só leitura: alterações vão no Git (server/data/rsvp.json). */
const READONLY = process.env.VERCEL === '1';

function loadStore() {
  const raw = readFileSync(DATA_PATH, 'utf8');
  const data = JSON.parse(raw);
  if (data.v !== 1 || !Array.isArray(data.families)) {
    throw new Error('rsvp.json inválido: esperado v: 1 e families (array).');
  }
  return {
    eventTitle: String(data.eventTitle ?? 'Aniversário').trim() || 'Aniversário',
    eventDate: String(data.eventDate ?? '').trim(),
    organizerEmail: String(data.organizerEmail ?? '').trim(),
    families: data.families.map((f) => ({
      id: String(f.id),
      slug: String(f.slug),
      name: String(f.name ?? ''),
      responsible: String(f.responsible || ''),
      respondedAt: f.respondedAt != null ? String(f.respondedAt) : null,
      rsvpNote: String(f.rsvpNote || ''),
      members: (f.members || []).map((m, i) => ({
        id: String(m.id),
        name: String(m.name ?? ''),
        sortOrder: typeof m.sortOrder === 'number' ? m.sortOrder : i,
        status: m.status === 'yes' || m.status === 'no' ? m.status : 'pending',
      })),
    })),
  };
}

function saveStore(store) {
  if (READONLY) {
    const e = new Error('READONLY');
    e.code = 'READONLY';
    throw e;
  }
  const payload = {
    v: 1,
    exportedAt: new Date().toISOString(),
    eventTitle: store.eventTitle,
    eventDate: store.eventDate,
    organizerEmail: store.organizerEmail,
    families: store.families.map((f) => ({
      id: f.id,
      slug: f.slug,
      name: f.name,
      responsible: f.responsible,
      respondedAt: f.respondedAt,
      rsvpNote: f.rsvpNote,
      members: [...f.members]
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'pt'))
        .map((m) => ({
          id: m.id,
          name: m.name,
          status: m.status,
        })),
    })),
  };
  writeFileSync(DATA_PATH, JSON.stringify(payload, null, 2), 'utf8');
}

function readonlyMessage() {
  return {
    error:
      'Neste deploy os dados são só leitura (JSON versionado no Git). Para alterar configurações, famílias ou RSVPs, edite server/data/rsvp.json no repositório, faça commit e redeploy. Em desenvolvimento local (npm run dev) as alterações pela admin gravam no ficheiro.',
  };
}

function slugify(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'familia';
}

function getSettings(store) {
  return {
    eventTitle: store.eventTitle,
    eventDate: store.eventDate,
    organizerEmail: store.organizerEmail,
  };
}

function setSettings(store, { eventTitle, eventDate, organizerEmail }) {
  store.eventTitle = String(eventTitle ?? '').trim() || 'Aniversário';
  store.eventDate = String(eventDate ?? '').trim();
  store.organizerEmail = String(organizerEmail ?? '').trim();
}

function listFamilies(store) {
  return [...store.families]
    .sort((a, b) => a.name.localeCompare(b.name, 'pt'))
    .map((f) => ({
      id: f.id,
      slug: f.slug,
      name: f.name,
      responsible: f.responsible,
      respondedAt: f.respondedAt,
      rsvpNote: f.rsvpNote,
      members: [...f.members]
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'pt'))
        .map((m) => ({ id: m.id, name: m.name, status: m.status })),
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
app.use(express.json({ limit: '12mb' }));

app.get('/api/settings', (_req, res) => {
  try {
    res.json(getSettings(loadStore()));
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.put('/api/settings', (req, res) => {
  if (READONLY) return res.status(503).json(readonlyMessage());
  try {
    const store = loadStore();
    const { eventTitle, eventDate, organizerEmail } = req.body || {};
    setSettings(store, {
      eventTitle: String(eventTitle ?? '').trim() || 'Aniversário',
      eventDate: String(eventDate ?? '').trim(),
      organizerEmail: String(organizerEmail ?? '').trim(),
    });
    saveStore(store);
    res.json(getSettings(store));
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.get('/api/families', (_req, res) => {
  try {
    res.json(listFamilies(loadStore()));
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.post('/api/families', (req, res) => {
  if (READONLY) return res.status(503).json(readonlyMessage());
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

    const store = loadStore();
    const id = randomUUID();
    let slug = slugify(n) + '-' + randomUUID().slice(0, 4);
    if (store.families.some((f) => f.slug === slug)) {
      return res.status(409).json({ error: 'Slug em conflito; tente de novo.' });
    }
    store.families.push({
      id,
      slug,
      name: n,
      responsible: String(responsible || '').trim(),
      respondedAt: null,
      rsvpNote: '',
      members: names.map((memName, i) => ({
        id: randomUUID(),
        name: memName,
        sortOrder: i,
        status: 'pending',
      })),
    });
    saveStore(store);
    const created = listFamilies(store).find((f) => f.id === id);
    res.status(201).json(created);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.patch('/api/families/:id', (req, res) => {
  if (READONLY) return res.status(503).json(readonlyMessage());
  try {
    const { id } = req.params;
    const store = loadStore();
    const fam = store.families.find((f) => f.id === id);
    if (!fam) return res.status(404).json({ error: 'Família não encontrada.' });

    const { name, responsible, members } = req.body || {};
    const n = name !== undefined ? String(name).trim() : null;
    const r = responsible !== undefined ? String(responsible).trim() : null;

    if (Array.isArray(members) && members.length === 0) {
      return res.status(400).json({ error: 'Informe ao menos um membro.' });
    }

    if (n !== null && n !== '') fam.name = n;
    if (r !== null) fam.responsible = r;

    if (Array.isArray(members)) {
      const existingById = new Map(fam.members.map((m) => [m.id, m.status]));
      fam.members = [];
      members.forEach((m, i) => {
        const memName = String(m.name || '').trim();
        if (!memName) return;
        const mid = String(m.id || '').trim() || randomUUID();
        const st = existingById.has(mid) ? existingById.get(mid) : 'pending';
        fam.members.push({
          id: mid,
          name: memName,
          sortOrder: i,
          status: st,
        });
      });
      fam.respondedAt = null;
    }
    saveStore(store);
    res.json(listFamilies(store).find((f) => f.id === id));
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.delete('/api/families/:id', (req, res) => {
  if (READONLY) return res.status(503).json(readonlyMessage());
  try {
    const { id } = req.params;
    const store = loadStore();
    const i = store.families.findIndex((f) => f.id === id);
    if (i === -1) return res.status(404).json({ error: 'Não encontrado.' });
    store.families.splice(i, 1);
    saveStore(store);
    res.status(204).end();
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get('/api/public/families/:slug', (req, res) => {
  try {
    const { slug } = req.params;
    const store = loadStore();
    const fam = store.families.find((f) => f.slug === slug);
    if (!fam) return res.status(404).json({ error: 'Link inválido ou família não encontrada.' });
    const members = [...fam.members]
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'pt'))
      .map((m) => ({ id: m.id, name: m.name, status: m.status }));
    res.json({
      eventTitle: store.eventTitle,
      eventDate: store.eventDate,
      organizerEmail: store.organizerEmail,
      family: { slug: fam.slug, name: fam.name, responsible: fam.responsible },
      members,
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.post('/api/public/families/:slug/rsvp', (req, res) => {
  if (READONLY) return res.status(503).json(readonlyMessage());
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

    const store = loadStore();
    const fam = store.families.find((f) => f.slug === slug);
    if (!fam) return res.status(404).json({ error: 'Família não encontrada.' });

    for (const m of fam.members) {
      const st = responses[m.id];
      if (st !== 'yes' && st !== 'no') {
        return res.status(400).json({ error: 'Resposta obrigatória (yes/no) para: ' + m.name });
      }
    }

    for (const m of fam.members) {
      m.status = responses[m.id];
    }
    fam.respondedAt = new Date().toISOString();
    fam.rsvpNote = note;
    saveStore(store);

    const choices = fam.members.map((m) => ({
      id: m.id,
      name: m.name,
      status: responses[m.id],
    }));
    const block = buildRsvpBlock({
      slug: fam.slug,
      familyName: fam.name,
      choices,
      eventTitle: store.eventTitle,
      message: note,
    });
    res.json({
      block,
      familyName: fam.name,
      responsible: fam.responsible,
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.post('/api/rsvp-import', (req, res) => {
  if (READONLY) return res.status(503).json(readonlyMessage());
  try {
    const text = String((req.body || {}).text || '').trim();
    if (!text) return res.status(400).json({ error: 'Texto vazio.' });
    const { slug, famName, map } = parseRsvpText(text);
    const store = loadStore();
    const fam = store.families.find((f) => f.slug === slug);
    if (!fam) return res.status(400).json({ error: 'Nenhuma família cadastrada com o slug: ' + slug });

    let changed = 0;
    for (const m of fam.members) {
      if (map[m.id] !== undefined && m.status !== map[m.id]) changed++;
      if (map[m.id] !== undefined) m.status = map[m.id];
    }
    fam.respondedAt = new Date().toISOString();
    saveStore(store);
    res.json({ changed, famName: famName || fam.name });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.get('/api/export', (_req, res) => {
  try {
    const store = loadStore();
    const exportedAt = new Date().toISOString();
    const payload = {
      v: 1,
      exportedAt,
      eventTitle: store.eventTitle,
      eventDate: store.eventDate,
      organizerEmail: store.organizerEmail,
      families: listFamilies(store),
    };
    const day = exportedAt.slice(0, 10);
    const filename = `backup-convite-rsvp-${day}.json`;
    const body = JSON.stringify(payload, null, 2);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.send(body);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

const MAX_BACKUP_FAMILIES = 8000;
const MAX_BACKUP_MEMBERS_PER_FAMILY = 400;

app.post('/api/import-backup', (req, res) => {
  if (READONLY) return res.status(503).json(readonlyMessage());
  const started = Date.now();
  try {
    const data = req.body;
    if (!data || data.v !== 1 || !Array.isArray(data.families)) {
      return res.status(400).json({
        error:
          'JSON inválido: esperado v: 1 e families (array). Use o arquivo gerado por "Exportar backup JSON" ou GET /api/export.',
      });
    }
    if (data.families.length > MAX_BACKUP_FAMILIES) {
      return res.status(400).json({
        error: `Backup com muitas famílias (${data.families.length}). Limite suportado: ${MAX_BACKUP_FAMILIES}.`,
      });
    }
    for (let i = 0; i < data.families.length; i++) {
      const f = data.families[i];
      const n = (f.members || []).length;
      if (n > MAX_BACKUP_MEMBERS_PER_FAMILY) {
        return res.status(400).json({
          error: `Família na posição ${i + 1} tem ${n} membros; limite por família: ${MAX_BACKUP_MEMBERS_PER_FAMILY}.`,
        });
      }
    }

    const store = {
      eventTitle: String(data.eventTitle ?? 'Aniversário').trim() || 'Aniversário',
      eventDate: String(data.eventDate ?? '').trim(),
      organizerEmail: String(data.organizerEmail ?? '').trim(),
      families: data.families.map((f) => ({
        id: String(f.id),
        slug: String(f.slug),
        name: String(f.name ?? ''),
        responsible: String(f.responsible || ''),
        respondedAt: f.respondedAt != null ? String(f.respondedAt) : null,
        rsvpNote: String(f.rsvpNote || ''),
        members: (f.members || []).map((m, i) => ({
          id: String(m.id),
          name: String(m.name ?? ''),
          sortOrder: i,
          status: m.status === 'yes' || m.status === 'no' ? m.status : 'pending',
        })),
      })),
    };
    saveStore(store);
    const familyCount = store.families.length;
    console.log('[import-backup] ok', { ms: Date.now() - started, familyCount });
    res.json({ ok: true, families: familyCount });
  } catch (e) {
    console.error('[import-backup] fail', { ms: Date.now() - started, err: String(e.message || e) });
    res.status(400).json({ error: String(e.message || e) });
  }
});

export default app;
