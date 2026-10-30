import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { ErrorBox } from '../components/Address';
import { LoadingBlock } from '../components/Spinners';
import { Tilt } from '../components/Tilt';
import { StatusChip, VerdictChip } from '../components/Verdict';
import { fetchAllClaims } from '../lib/api';
import { formatTime, shortAddress } from '../lib/format';
import { TOPICS, VERDICTS } from '../lib/types';
import { useAsync } from '../lib/useAsync';

export function Claims() {
  const list = useAsync((signal) => fetchAllClaims(signal), []);
  const [query, setQuery] = useState('');
  const [verdict, setVerdict] = useState('');
  const [topic, setTopic] = useState('');
  const [status, setStatus] = useState('');

  const items = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (list.data?.items ?? []).filter(
      (item) =>
        (!needle ||
          item.title.toLowerCase().includes(needle) ||
          item.claim_id.toLowerCase().includes(needle)) &&
        (!verdict || item.standing === verdict) &&
        (!topic || item.topic === topic) &&
        (!status || item.status === status),
    );
  }, [list.data, query, verdict, topic, status]);

  return (
    <div className="container section" style={{ paddingTop: 44 }}>
      <div className="row spread">
        <div>
          <div className="eyebrow">Claims</div>
          <h1 style={{ fontSize: 'clamp(2rem,4vw,3rem)' }}>Every claim on record</h1>
        </div>
        <Link className="btn primary" to="/new">
          Open a claim
        </Link>
      </div>

      <div className="card flat grid c4" style={{ margin: '22px 0' }}>
        <div className="field">
          <label htmlFor="q">Search</label>
          <input
            id="q"
            className="input"
            value={query}
            placeholder="title or CLM-0001"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="v">Standing</label>
          <select
            id="v"
            className="select"
            value={verdict}
            onChange={(event) => setVerdict(event.target.value)}
          >
            <option value="">Any</option>
            <option value="UNEXAMINED">Unexamined</option>
            {VERDICTS.map((item) => (
              <option key={item} value={item}>
                {item.toLowerCase().replace('_', ' ')}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="t">Topic</label>
          <select id="t" className="select" value={topic} onChange={(event) => setTopic(event.target.value)}>
            <option value="">Any</option>
            {TOPICS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="s">Status</label>
          <select
            id="s"
            className="select"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">Any</option>
            <option value="OPEN">Open</option>
            <option value="CLOSED">Closed</option>
          </select>
        </div>
      </div>

      {list.loading && !list.data ? <LoadingBlock text="Reading claims from the contract…" /> : null}
      {list.error ? <ErrorBox message={list.error} onRetry={list.reload} /> : null}
      {list.data ? (
        <>
          <p className="hint">
            {items.length} of {list.data.total} claims shown
          </p>
          {items.length === 0 ? (
            <div className="empty">
              {list.data.total === 0
                ? 'No claim has been opened yet. Be the first.'
                : 'No claim matches these filters.'}
              {list.data.total === 0 ? (
                <div style={{ marginTop: 14 }}>
                  <Link className="btn primary" to="/new">
                    Open a claim
                  </Link>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="grid c3">
              {items.map((item) => (
                <Tilt key={item.claim_id} className="card">
                  <Link to={`/claims/${item.claim_id}`} className="claim-card">
                    <div className="row spread">
                      <span className="claim-id">{item.claim_id}</span>
                      <StatusChip status={item.status} />
                    </div>
                    <h3>{item.title}</h3>
                    <div className="row">
                      <VerdictChip verdict={item.standing} />
                      <span className="chip nodot tone-muted">{item.topic}</span>
                    </div>
                    <div className="hint">
                      {item.sources} source{item.sources === 1 ? '' : 's'} · {item.examinations} examination
                      {item.examinations === 1 ? '' : 's'}
                      {item.flips ? ` · ${item.flips} flip${item.flips === 1 ? '' : 's'}` : ''}
                    </div>
                    <div className="hint">
                      opened {formatTime(item.created_at)} by{' '}
                      <span className="mono">{shortAddress(item.owner)}</span>
                    </div>
                  </Link>
                </Tilt>
              ))}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
