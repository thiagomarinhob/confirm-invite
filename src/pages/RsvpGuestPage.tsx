import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiGet, apiPost } from '../api';
import type { PublicFamilyPayload } from '../types';

type Choice = 'yes' | 'no';

export function RsvpGuestPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<PublicFamilyPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice | null>>({});
  const [recado, setRecado] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!slug) return;
    setError(null);
    try {
      const d = await apiGet<PublicFamilyPayload>(`/public/families/${encodeURIComponent(slug)}`);
      setData(d);
      const init: Record<string, Choice | null> = {};
      for (const m of d.members) {
        if (m.status === 'yes' || m.status === 'no') init[m.id] = m.status;
        else init[m.id] = null;
      }
      setChoices(init);
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    document.body.classList.add('rsvp-guest-page');
    return () => document.body.classList.remove('rsvp-guest-page');
  }, []);

  const allAnswered = useMemo(() => {
    if (!data) return false;
    return data.members.every((m) => choices[m.id] === 'yes' || choices[m.id] === 'no');
  }, [data, choices]);

  const setChoice = (id: string, c: Choice) => {
    setChoices((prev) => ({ ...prev, [id]: c }));
  };

  const submit = async () => {
    if (!slug || !data || !allAnswered) return;
    setSubmitting(true);
    setError(null);
    try {
      const responses: Record<string, Choice> = {};
      for (const m of data.members) {
        const ch = choices[m.id];
        if (ch === 'yes' || ch === 'no') responses[m.id] = ch;
      }
      const r = await apiPost<{ block: string; familyName: string; responsible: string }>(
        `/public/families/${encodeURIComponent(slug)}/rsvp`,
        {
          responses,
          message: recado.trim() || undefined,
          justification: recado.trim() || undefined,
        }
      );
      const summary = data.members.map((m) => ({
        id: m.id,
        name: m.name,
        status: responses[m.id],
      }));
      const key = `rsvpOk:${slug}`;
      sessionStorage.setItem(
        key,
        JSON.stringify({
          block: r.block,
          summary,
          responsible: r.responsible,
          organizerEmail: data.organizerEmail,
          familyName: r.familyName,
        })
      );
      navigate(`/rsvp/${encodeURIComponent(slug)}/enviado`, { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  if (error && !data) {
    return (
      <div className="rsvp-guest-screen">
        <div className="rsvp-guest-bg" aria-hidden />
        <div className="rsvp-guest-inner container rsvp-guest-main">
          <div className="error-banner">{error}</div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rsvp-guest-screen">
        <div className="rsvp-guest-bg" aria-hidden />
        <div className="rsvp-guest-inner container rsvp-guest-main" aria-busy="true">
          <span className="sr-only">Carregando</span>
        </div>
      </div>
    );
  }

  return (
    <div className="rsvp-guest-screen">
      <div className="rsvp-guest-bg" aria-hidden />
      <div className="rsvp-guest-inner container rsvp-guest-main">
        {error ? <div className="error-banner">{error}</div> : null}

        <div className="rsvp-guest-cluster">
        <div className="card card-glass">
          {data.members.map((m) => {
            const ch = choices[m.id];
            return (
              <div key={m.id} className="member-row">
                <span className="member-name">{m.name}</span>
                <div className="btn-group">
                  <button
                    type="button"
                    className={`btn-rsvp ${ch === 'yes' ? 'selected-yes' : ''}`}
                    onClick={() => setChoice(m.id, 'yes')}
                  >
                    Confirmado
                  </button>
                  <button
                    type="button"
                    className={`btn-rsvp ${ch === 'no' ? 'selected-no' : ''}`}
                    onClick={() => setChoice(m.id, 'no')}
                  >
                    Não confirmado
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <label className="rsvp-guest-recado">
          <span className="rsvp-guest-recado-label">Recado (opcional)</span>
          <textarea
            value={recado}
            onChange={(e) => setRecado(e.target.value)}
            placeholder="Deixe uma mensagem para os anfitriões…"
            rows={3}
            maxLength={2000}
            autoComplete="off"
          />
        </label>

        <div className="rsvp-guest-submit-wrap">
          <button type="button" className="btn-primary rsvp-guest-btn-send" disabled={!allAnswered || submitting} onClick={() => void submit()}>
            {submitting ? 'Enviando…' : 'Enviar confirmação'}
          </button>
        </div>
        </div>
      </div>
    </div>
  );
}
