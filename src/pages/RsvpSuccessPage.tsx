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

  useEffect(() => {
    document.body.classList.add('rsvp-guest-page');
    return () => document.body.classList.remove('rsvp-guest-page');
  }, []);

  if (phase === 'loading') {
    return (
      <div className="rsvp-guest-screen">
        <div className="rsvp-guest-bg" aria-hidden />
        <div className="rsvp-guest-inner container rsvp-guest-main">
          <p className="section-sub">Carregando…</p>
        </div>
      </div>
    );
  }

  if (phase === 'missing' || !stored) {
    return (
      <div className="rsvp-guest-screen">
        <div className="rsvp-guest-bg" aria-hidden />
        <div className="rsvp-guest-inner container rsvp-guest-main">
          <div className="card card-glass" style={{ textAlign: 'center', padding: '2rem 1rem' }}>
            <p className="section-title">Nada para mostrar</p>
            <p className="section-sub">Abra novamente o link da família para enviar a confirmação.</p>
            <Link to={slug ? `/rsvp/${encodeURIComponent(slug)}` : '/'} className="btn-secondary admin-link" style={{ display: 'inline-block', marginTop: 12 }}>
              Voltar para confirmação
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rsvp-guest-screen">
      <div className="rsvp-guest-bg" aria-hidden />
      <div className="rsvp-guest-inner container rsvp-guest-main">
        <div className="rsvp-guest-cluster">
          <div className="card card-glass" style={{ textAlign: 'center', padding: '1.5rem 1rem' }}>
            <div className="check-icon">✓</div>
            <p className="section-title">Confirmação enviada</p>
            <p className="section-sub" style={{ marginTop: 6 }}>
              Obrigado{stored.responsible ? `, ${stored.responsible}` : ''}. Sua resposta para o 1 aninho do Thales foi recebida.
            </p>

            <div style={{ textAlign: 'left', marginTop: '1.25rem' }}>
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

            <p style={{ marginTop: '1.5rem', textAlign: 'center' }}>
              <Link to={slug ? `/rsvp/${encodeURIComponent(slug)}` : '/'} className="btn-secondary admin-link" style={{ display: 'inline-block', padding: '7px 16px' }}>
                Voltar para confirmação
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
