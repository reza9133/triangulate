import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useTx } from '../components/Tx';
import { fetchStats } from '../lib/api';
import { findIdInReceipt } from '../lib/receipt';
import { suggestAnchors } from '../lib/suggest';
import { checkClaim, type AnchorDraft } from '../lib/validate';
import { DEFAULT_LIMITS, TOPICS } from '../lib/types';
import { useWallet } from '../wallet/WalletContext';

let rowCounter = 0;
const newRow = (spellings: string[] = ['']): AnchorDraft => ({ id: `a${(rowCounter += 1)}`, spellings });

const EXAMPLE = {
  title: 'Speed of light in vacuum',
  statement: 'The speed of light in vacuum is exactly 299,792,458 metres per second.',
  topic: 'science',
  anchors: [['speed of light'], ['299,792,458', '299 792 458', '299792458']],
};

export function NewClaim() {
  const wallet = useWallet();
  const tx = useTx();
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [statement, setStatement] = useState('');
  const [topic, setTopic] = useState('other');
  const [anchors, setAnchors] = useState<AnchorDraft[]>([newRow()]);
  const [touched, setTouched] = useState(false);

  const check = useMemo(
    () => checkClaim({ title, statement, topic, anchors }, TOPICS),
    [title, statement, topic, anchors],
  );
  const suggestions = useMemo(
    () =>
      suggestAnchors(statement).filter(
        (s) => !anchors.some((row) => row.spellings[0]?.trim().toLowerCase() === s.toLowerCase()),
      ),
    [statement, anchors],
  );
  const L = DEFAULT_LIMITS;

  const fillExample = () => {
    setTitle(EXAMPLE.title);
    setStatement(EXAMPLE.statement);
    setTopic(EXAMPLE.topic);
    setAnchors(EXAMPLE.anchors.map((spellings) => newRow(spellings)));
  };

  const setSpelling = (id: string, index: number, value: string) =>
    setAnchors((rows) =>
      rows.map((row) =>
        row.id === id ? { ...row, spellings: row.spellings.map((s, i) => (i === index ? value : s)) } : row,
      ),
    );

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!check.ok) return;
    const result = await tx.send('Open claim', 'open_claim', [
      check.title,
      check.statement,
      topic,
      check.anchorsJson,
    ]);
    if (!result) return;
    let id = findIdInReceipt(result.transaction, 'CLM');
    if (!id) {
      try {
        id = `CLM-${String((await fetchStats()).claims).padStart(4, '0')}`;
      } catch {
        id = null;
      }
    }
    navigate(id ? `/claims/${id}` : '/claims');
  };

  const showErrors = touched;
  return (
    <div className="container section" style={{ paddingTop: 44, maxWidth: 860 }}>
      <div className="eyebrow">New claim</div>
      <h1 style={{ fontSize: 'clamp(2rem,4vw,3rem)' }}>Put a claim on record</h1>
      <p className="lead">
        Write the claim, then name its <strong>anchors</strong>: the specifics a source must actually show
        before it can be said to support the claim. The same statement can only be opened once, so sources
        gather in one place.
      </p>
      <p>
        <button type="button" className="btn small" onClick={fillExample}>
          Fill with an example
        </button>
      </p>

      <form className="card stack" onSubmit={(event) => void submit(event)} noValidate>
        <div className="field">
          <label htmlFor="title">Title</label>
          <input
            id="title"
            className={`input${showErrors && check.errors.title ? ' bad' : ''}`}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={L.max_title_chars + 40}
          />
          {showErrors && check.errors.title ? <span className="error-text">{check.errors.title}</span> : null}
        </div>

        <div className="field">
          <label htmlFor="statement">Statement</label>
          <textarea
            id="statement"
            className={`textarea${showErrors && check.errors.statement ? ' bad' : ''}`}
            value={statement}
            onChange={(e) => setStatement(e.target.value)}
          />
          <div className="row spread">
            <span className="hint">
              One or two sentences with at least three distinctive words or numbers.
            </span>
            <span className="counter">
              {check.statement.length}/{L.max_statement_chars}
            </span>
          </div>
          {showErrors && check.errors.statement ? (
            <span className="error-text">{check.errors.statement}</span>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="topic">Topic</label>
          <select id="topic" className="select" value={topic} onChange={(e) => setTopic(e.target.value)}>
            {TOPICS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <span className="label">
            Anchors ({anchors.length}/{L.max_anchor_groups})
          </span>
          <span className="hint">
            Each anchor is a specific that a supporting excerpt must show. The first spelling must occur in
            the statement exactly; extra spellings are alternatives (any one satisfies the anchor).
          </span>
          {anchors.map((row, rowIndex) => (
            <div className="anchor-row" key={row.id}>
              <div className="pill-input">
                {row.spellings.map((spelling, index) => (
                  <input
                    key={index}
                    className={`input${showErrors && check.errors.anchorRows[row.id] ? ' bad' : ''}`}
                    value={spelling}
                    aria-label={`Anchor ${rowIndex + 1}, spelling ${index + 1}`}
                    placeholder={index === 0 ? 'as written in the statement' : 'alternative spelling'}
                    onChange={(e) => setSpelling(row.id, index, e.target.value)}
                  />
                ))}
              </div>
              <div className="row">
                {row.spellings.length < L.max_anchor_alternatives ? (
                  <button
                    type="button"
                    className="btn small ghost"
                    onClick={() =>
                      setAnchors((rows) =>
                        rows.map((r) => (r.id === row.id ? { ...r, spellings: [...r.spellings, ''] } : r)),
                      )
                    }
                  >
                    + alternative spelling
                  </button>
                ) : null}
                {anchors.length > 1 ? (
                  <button
                    type="button"
                    className="btn small ghost danger"
                    onClick={() => setAnchors((rows) => rows.filter((r) => r.id !== row.id))}
                  >
                    Remove anchor
                  </button>
                ) : null}
              </div>
              {showErrors && check.errors.anchorRows[row.id] ? (
                <span className="error-text">{check.errors.anchorRows[row.id]}</span>
              ) : null}
            </div>
          ))}
          {showErrors && check.errors.anchors ? (
            <span className="error-text">{check.errors.anchors}</span>
          ) : null}
          <div className="row">
            {anchors.length < L.max_anchor_groups ? (
              <button
                type="button"
                className="btn small"
                onClick={() => setAnchors((rows) => [...rows, newRow()])}
              >
                + Add anchor
              </button>
            ) : null}
          </div>
          {suggestions.length > 0 ? (
            <div>
              <span className="hint">Found in your statement, click to use: </span>
              <span className="row" style={{ gap: 6, display: 'inline-flex' }}>
                {suggestions.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className="btn small ghost"
                    onClick={() =>
                      setAnchors((rows) => {
                        const empty = rows.findIndex((r) => r.spellings.every((s) => s.trim() === ''));
                        if (empty >= 0)
                          return rows.map((r, i) => (i === empty ? { ...r, spellings: [value] } : r));
                        return rows.length < L.max_anchor_groups ? [...rows, newRow([value])] : rows;
                      })
                    }
                  >
                    {value}
                  </button>
                ))}
              </span>
            </div>
          ) : null}
        </div>

        <hr className="divider" />
        <div className="row spread">
          <span className="hint">
            Opening a claim is a transaction signed in your wallet. Studionet is gasless.
          </span>
          <button className="btn primary" type="submit" disabled={tx.busy}>
            {wallet.status === 'connected' ? 'Open claim' : 'Connect wallet & open'}
          </button>
        </div>
        {showErrors && !check.ok ? (
          <div className="notice tone-bad" role="alert">
            <strong>Fix the highlighted fields first.</strong> The contract would refuse this claim.
          </div>
        ) : null}
      </form>
      <p className="hint" style={{ marginTop: 16 }}>
        New to anchors? <Link to="/docs/anchors">Read how they work →</Link>
      </p>
    </div>
  );
}
