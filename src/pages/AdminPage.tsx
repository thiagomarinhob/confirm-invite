import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from '../api';
import type { Family, Member, Settings } from '../types';

type Tab = 'families' | 'list' | 'import';
type ListFilter = 'all' | 'yes' | 'no' | 'pending';

function familyResponded(f: Family): boolean {
  return f.members.length > 0 && f.members.every((m) => m.status === 'yes' || m.status === 'no');
}

function metrics(families: Family[]) {
  let yes = 0;
  let no = 0;
  let pend = 0;
  let total = 0;
  for (const f of families) {
    for (const m of f.members) {
      total++;
      if (m.status === 'yes') yes++;
      else if (m.status === 'no') no++;
      else pend++;
    }
  }
  return { yes, no, pend, total };
}

function copyText(text: string) {
  navigator.clipboard.writeText(text).then(
    () => alert('Copiado.'),
    () => {
      window.prompt('Copie:', text);
    }
  );
}

function publicRsvpUrl(slug: string) {
  return `${window.location.origin}/rsvp/${encodeURIComponent(slug)}`;
}

interface FamilyModalProps {
  open: boolean;
  mode: 'add' | 'edit';
  initial?: Family | null;
  onClose: () => void;
  onSave: (payload: { name: string; responsible: string; memberNames: string[] }) => Promise<void>;
}

function FamilyModal({ open, mode, initial, onClose, onSave }: FamilyModalProps) {
  const [name, setName] = useState('');
  const [responsible, setResponsible] = useState('');
  const [membersText, setMembersText] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setErr(null);
    if (mode === 'edit' && initial) {
      setName(initial.name);
      setResponsible(initial.responsible || '');
      setMembersText(initial.members.map((m) => m.name).join('\n'));
    } else {
      setName('');
      setResponsible('');
      setMembersText('Pessoa 1\nPessoa 2');
    }
  }, [open, mode, initial]);

  if (!open) return null;

  const submit = async () => {
    setErr(null);
    const memberNames = membersText
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!name.trim()) {
      setErr('Informe o nome da família.');
      return;
    }
    if (!memberNames.length) {
      setErr('Informe ao menos um membro (um por linha).');
      return;
    }
    setSaving(true);
    try {
      await onSave({ name: name.trim(), responsible: responsible.trim(), memberNames });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div className="modal" role="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>{mode === 'add' ? 'Nova família' : 'Editar família'}</h3>
        {err && <div className="error-banner">{err}</div>}
        <label className="field-label">Nome da família</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Família Silva" />
        <label className="field-label">Responsável</label>
        <input type="text" value={responsible} onChange={(e) => setResponsible(e.target.value)} placeholder="Nome de quem recebe o link" />
        <label className="field-label">Membros (um por linha)</label>
        <textarea value={membersText} onChange={(e) => setMembersText(e.target.value)} rows={6} />
        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button type="button" className="btn-primary" style={{ width: 'auto' }} onClick={() => void submit()} disabled={saving}>
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function AdminPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [families, setFamilies] = useState<Family[]>([]);
  const [tab, setTab] = useState<Tab>('families');
  const [listFilter, setListFilter] = useState<ListFilter>('all');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [importText, setImportText] = useState('');
  const [modal, setModal] = useState<{ mode: 'add' | 'edit'; family?: Family } | null>(null);

  const draft = useMemo(
    () => ({
      eventTitle: settings?.eventTitle ?? '',
      eventDate: settings?.eventDate ?? '',
      organizerEmail: settings?.organizerEmail ?? '',
    }),
    [settings]
  );

  const [metaDraft, setMetaDraft] = useState(draft);

  useEffect(() => {
    setMetaDraft(draft);
  }, [draft.eventTitle, draft.eventDate, draft.organizerEmail]);

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const [s, f] = await Promise.all([apiGet<Settings>('/settings'), apiGet<Family[]>('/families')]);
      setSettings(s);
      setFamilies(f);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const m = useMemo(() => metrics(families), [families]);

  const saveMeta = async () => {
    try {
      const s = await apiPut<Settings>('/settings', {
        eventTitle: metaDraft.eventTitle.trim() || '1 aninho do Thales',
        eventDate: metaDraft.eventDate.trim(),
        organizerEmail: metaDraft.organizerEmail.trim(),
      });
      setSettings(s);
      alert('Salvo.');
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  const exportJson = async () => {
    try {
      const data = await apiGet<unknown>('/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'backup-convite-rsvp.json';
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  const importBackupFile = (file: File) => {
    const r = new FileReader();
    r.onload = () => {
      void (async () => {
        try {
          const data = JSON.parse(String(r.result));
          await apiPost('/import-backup', data);
          await refresh();
          alert('Importado.');
        } catch (e) {
          alert(e instanceof Error ? e.message : String(e));
        }
      })();
    };
    r.readAsText(file);
  };

  const applyRsvpImport = async () => {
    const text = importText.trim();
    if (!text) return;
    try {
      const r = await apiPost<{ changed: number; famName: string }>('/rsvp-import', { text });
      await refresh();
      alert(`Importação aplicada: ${r.famName} (${r.changed} alterações).`);
      setImportText('');
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  const onModalSave = async (payload: { name: string; responsible: string; memberNames: string[] }) => {
    if (modal?.mode === 'add') {
      await apiPost<Family>('/families', payload);
    } else if (modal?.family) {
      const old = modal.family.members;
      const used = new Set<string>();
      const members: { id: string; name: string }[] = payload.memberNames.map((n) => {
        const prev = old.find((x) => x.name === n && !used.has(x.id));
        if (prev) {
          used.add(prev.id);
          return { id: prev.id, name: n };
        }
        return { id: globalThis.crypto.randomUUID(), name: n };
      });
      await apiPatch<Family>(`/families/${modal.family.id}`, {
        name: payload.name,
        responsible: payload.responsible,
        members,
      });
    }
    await refresh();
  };

  const deleteFamily = async (id: string) => {
    if (!confirm('Excluir esta família?')) return;
    try {
      await apiDelete(`/families/${id}`);
      await refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  const filteredRows: { family: Family; member: Member }[] = [];
  for (const f of families) {
    for (const member of f.members) {
      if (listFilter === 'yes' && member.status !== 'yes') continue;
      if (listFilter === 'no' && member.status !== 'no') continue;
      if (listFilter === 'pending' && (member.status === 'yes' || member.status === 'no')) continue;
      filteredRows.push({ family: f, member });
    }
  }

  if (loadError && !settings) {
    return (
      <div className="container">
        <div className="error-banner">Não foi possível carregar os dados. O servidor está rodando? ({loadError})</div>
        <p className="section-sub">Execute na pasta do projeto: npm run dev</p>
        <button type="button" className="btn-secondary" onClick={() => void refresh()}>
          Tentar de novo
        </button>
      </div>
    );
  }

  return (
    <div className="container">
      <FamilyModal
        open={!!modal}
        mode={modal?.mode ?? 'add'}
        initial={modal?.mode === 'edit' ? modal?.family : null}
        onClose={() => setModal(null)}
        onSave={onModalSave}
      />

      <p className="section-title">Painel do organizador</p>
      <p className="section-sub">
        1 aninho do Thales. Famílias, links públicos e confirmações. Os dados são salvos no servidor (SQLite em <code>server/data/</code>).
      </p>

      {loadError && <div className="error-banner">Aviso: {loadError}</div>}

      <div className="card" style={{ marginBottom: '1rem' }}>
        <label className="field-label">Nome do evento</label>
        <input
          type="text"
          value={metaDraft.eventTitle}
          onChange={(e) => setMetaDraft((d) => ({ ...d, eventTitle: e.target.value }))}
          placeholder="Ex.: Aniversário da Ana"
        />
        <label className="field-label">Data / detalhe (texto livre)</label>
        <input
          type="text"
          value={metaDraft.eventDate}
          onChange={(e) => setMetaDraft((d) => ({ ...d, eventDate: e.target.value }))}
          placeholder="Ex.: 14 de junho · sábado às 16h"
        />
        <label className="field-label">E-mail do organizador (opcional, para mailto no envio)</label>
        <input
          type="email"
          value={metaDraft.organizerEmail}
          onChange={(e) => setMetaDraft((d) => ({ ...d, organizerEmail: e.target.value }))}
          placeholder="voce@email.com"
        />
        <div className="row-actions" style={{ marginTop: 12 }}>
          <button type="button" className="btn-secondary" onClick={() => void saveMeta()}>
            Salvar dados do evento
          </button>
          <button type="button" className="btn-secondary" onClick={() => void exportJson()}>
            Exportar backup JSON
          </button>
          <label className="btn-secondary" style={{ cursor: 'pointer', margin: 0 }}>
            Importar backup
            <input
              type="file"
              accept="application/json"
              className="hidden"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importBackupFile(f);
                e.target.value = '';
              }}
            />
          </label>
        </div>
      </div>

      <div className="metrics-row">
        <div className="metric">
          <div className="metric-num" style={{ color: 'var(--success-text)' }}>
            {m.yes}
          </div>
          <div className="metric-label">Confirmados</div>
        </div>
        <div className="metric">
          <div className="metric-num" style={{ color: 'var(--danger-text)' }}>
            {m.no}
          </div>
          <div className="metric-label">Não vão</div>
        </div>
        <div className="metric">
          <div className="metric-num">{m.pend}</div>
          <div className="metric-label">Aguardando</div>
        </div>
        <div className="metric">
          <div className="metric-num">{m.total}</div>
          <div className="metric-label">Total</div>
        </div>
      </div>

      <div className="nav-tabs">
        <button type="button" className={`tab ${tab === 'families' ? 'active' : ''}`} onClick={() => setTab('families')}>
          Famílias
        </button>
        <button type="button" className={`tab ${tab === 'list' ? 'active' : ''}`} onClick={() => setTab('list')}>
          Todos os convidados
        </button>
        <button type="button" className={`tab ${tab === 'import' ? 'active' : ''}`} onClick={() => setTab('import')}>
          Importar RSVP
        </button>
      </div>

      {tab === 'families' && (
        <div>
          {families.map((f) => {
            const responded = familyResponded(f);
            const cy = f.members.filter((x) => x.status === 'yes').length;
            const cn = f.members.filter((x) => x.status === 'no').length;
            const cp = f.members.filter((x) => x.status !== 'yes' && x.status !== 'no').length;
            const url = publicRsvpUrl(f.slug);
            return (
              <div key={f.id} className="family-admin-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>{f.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>Responsável: {f.responsible || '—'}</div>
                  </div>
                  <span className={`badge ${responded ? 'badge-confirm' : 'badge-pending'}`}>{responded ? 'Respondido' : 'Aguardando'}</span>
                </div>
                <div className="link-box">{url}</div>
                <div className="row-actions">
                  <button type="button" className="btn-secondary" onClick={() => copyText(url)}>
                    Copiar link
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => setModal({ mode: 'edit', family: f })}>
                    Editar
                  </button>
                  <button type="button" className="btn-secondary" style={{ color: 'var(--danger-text)' }} onClick={() => void deleteFamily(f.id)}>
                    Excluir
                  </button>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8 }}>
                  {responded ? (
                    <>
                      <span style={{ color: 'var(--success-text)' }}>{cy} confirmados</span>
                      <span> · </span>
                      <span style={{ color: 'var(--danger-text)' }}>{cn} não vão</span>
                      <span> · </span>
                      <span>{f.members.length} no total</span>
                    </>
                  ) : (
                    <>
                      {cp} aguardando resposta · {f.members.length} no total
                    </>
                  )}
                </div>
                {f.rsvpNote?.trim() ? (
                  <div className="family-note-box">
                    <span className="family-note-label">Justificativa / recado</span>
                    <p className="family-note-text">{f.rsvpNote.trim()}</p>
                  </div>
                ) : null}
              </div>
            );
          })}
          <button type="button" className="btn-primary" style={{ marginTop: 8 }} onClick={() => setModal({ mode: 'add' })}>
            + Adicionar família
          </button>
        </div>
      )}

      {tab === 'list' && (
        <div>
          <div className="pill-nav">
            {(['all', 'yes', 'no', 'pending'] as const).map((f) => (
              <button key={f} type="button" className={`pill ${listFilter === f ? 'active' : ''}`} onClick={() => setListFilter(f)}>
                {f === 'all' ? 'Todos' : f === 'yes' ? 'Confirmados' : f === 'no' ? 'Não vão' : 'Aguardando'}
              </button>
            ))}
          </div>
          <div className="card">
            {filteredRows.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Nenhum convidado neste filtro.</div>
            ) : (
              filteredRows.map(({ family: fam, member: m }) => (
                <div key={m.id} className="member-row">
                  <div>
                    <div className="member-name">{m.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{fam.name}</div>
                  </div>
                  {m.status === 'yes' && <span className="badge badge-confirm">Confirmado</span>}
                  {m.status === 'no' && <span className="badge badge-decline">Não confirmado</span>}
                  {m.status === 'pending' && <span className="badge badge-pending">Aguardando</span>}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {tab === 'import' && (
        <div>
          <p className="section-sub" style={{ marginTop: 0 }}>
            Cole o bloco de texto RSVP_V1 (útil para migrar respostas do protótipo antigo ou correções manuais). Quem confirma pelo link público já grava direto no
            servidor.
          </p>
          <textarea value={importText} onChange={(e) => setImportText(e.target.value)} placeholder="Linhas começando com RSVP_V1..." />
          <button type="button" className="btn-primary" style={{ marginTop: 10 }} onClick={() => void applyRsvpImport()}>
            Aplicar importação
          </button>
          <p className="hint">O formato é o mesmo gerado na tela de confirmação do convidado.</p>
        </div>
      )}

      <p className="hint" style={{ marginTop: '2rem', textAlign: 'center' }}>
        <Link to="/" className="admin-link">
          Recarregar painel
        </Link>
      </p>
    </div>
  );
}
