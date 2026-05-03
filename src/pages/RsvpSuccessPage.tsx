import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

interface Stored {
  block: string;
  summary: { id: string; name: string; status: 'yes' | 'no' }[];
  responsible: string;
  organizerEmail: string;
  familyName: string;
}

export function RsvpSuccessPage() {
  const { slug } = useParams<{ slug: string }>();
  const [phase, setPhase] = useState<'loading' | 'ok' | 'missing'>('loading');
  const [stored, setStored] = useState<Stored | null>(null);

  useEffect(() => {
    if (!slug) {
      setPhase('missing');
      return;
    }
    const raw = sessionStorage.getItem(`rsvpOk:${slug}`);
    if (!raw) {
      setPhase('missing');
      return;
    }
    try {
      setStored(JSON.parse(raw) as Stored);
      setPhase('ok');
    } catch {
      setPhase('missing');
    }
  }, [slug]);

  const copyBlock = () => {
    if (!stored) return;
    void navigator.clipboard.writeText(stored.block).then(
      () => alert('Copiado.'),
      () => window.prompt('Copie:', stored.block)
    );
  };

  const mailto = () => {
    if (!stored?.organizerEmail?.trim()) return;
    const sub = encodeURIComponent('RSVP: ' + stored.familyName);
    const body = encodeURIComponent(stored.block);
    window.location.href = `mailto:${stored.organizerEmail.trim()}?subject=${sub}&body=${body}`;
  };

  if (phase === 'loading') {
    return (
      <div className="container">
        <p className="section-sub">Carregando…</p>
      </div>
    );
  }

  if (phase === 'missing' || !stored) {
    return (
      <div className="container" style={{ textAlign: 'center', padding: '2rem 0' }}>
        <p className="section-title">Nada para mostrar</p>
        <p className="section-sub">Abra novamente o link da família para enviar a confirmação.</p>
        <Link to={slug ? `/rsvp/${encodeURIComponent(slug)}` : '/'} className="btn-secondary admin-link" style={{ display: 'inline-block', marginTop: 12 }}>
          Voltar para confirmação
        </Link>
      </div>
    );
  }

  return (
    <div className="container">
      <div style={{ textAlign: 'center', padding: '2rem 0' }}>
        <div className="check-icon">✓</div>
        <p className="section-title">Confirmação enviada</p>
        <p className="section-sub" style={{ marginTop: 6 }}>
          Obrigado{stored.responsible ? `, ${stored.responsible}` : ''}. Sua resposta para o 1 aninho do Thales foi recebida.
        </p>

        <div className="card" style={{ textAlign: 'left', marginTop: '1.5rem' }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 10 }}>Resumo — {stored.familyName}</div>
          {stored.summary.map((row) => (
            <div
              key={row.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 13,
                padding: '6px 0',
                borderBottom: '0.5px solid var(--border)',
              }}
            >
              <span>{row.name}</span>
              {row.status === 'yes' ? (
                <span className="badge badge-confirm">Confirmado</span>
              ) : (
                <span className="badge badge-decline">Não confirmado</span>
              )}
            </div>
          ))}
        </div>

        <p className="hint" style={{ marginTop: '1rem' }}>
          Você ainda pode copiar o texto abaixo para enviar por WhatsApp ou guardar registro.
        </p>

        <div className="row-actions" style={{ justifyContent: 'center', marginTop: '1rem' }}>
          <button type="button" className="btn-primary" style={{ width: 'auto', padding: '10px 20px' }} onClick={copyBlock}>
            Copiar texto do RSVP
          </button>
          {stored.organizerEmail?.trim() ? (
            <button type="button" className="btn-secondary" onClick={mailto}>
              Abrir e-mail
            </button>
          ) : null}
        </div>

        <pre className="link-box" style={{ textAlign: 'left', whiteSpace: 'pre-wrap', marginTop: '1rem', maxHeight: 200, overflow: 'auto' }}>
          {stored.block}
        </pre>

        <p style={{ marginTop: '1.25rem', textAlign: 'center' }}>
          <Link to={slug ? `/rsvp/${encodeURIComponent(slug)}` : '/'} className="btn-secondary admin-link" style={{ display: 'inline-block', padding: '7px 16px' }}>
            Voltar para confirmação
          </Link>
        </p>
      </div>
    </div>
  );
}
