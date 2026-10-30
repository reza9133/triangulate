import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { Address, ErrorBox } from '../components/Address';
import { LoadingBlock } from '../components/Spinners';
import { useTx } from '../components/Tx';
import { Chip, StanceChip, StatusChip, VerdictChip } from '../components/Verdict';
import { CLAIM_ID_RE, fetchClaim, inspectUrl } from '../lib/api';
import { formatDuration, formatTime, sameAddress, verdictMeta } from '../lib/format';
import { quickUrlProblem } from '../lib/validate';
import { DEFAULT_LIMITS, type ClaimRecord, type UrlInspection } from '../lib/types';
import { useAsync } from '../lib/useAsync';
import { useWallet } from '../wallet/WalletContext';
import { NotFound } from './NotFound';

export function Claim() {
  const { claimId = '' } = useParams();
  if (!CLAIM_ID_RE.test(claimId)) return <NotFound />;
  return <ClaimView claimId={claimId} />;
}

function cooldownLeft(claim: ClaimRecord, now: number): number {
  if (claim.dirty || claim.last_conclusive_at <= 0) return 0;
  return Math.max(0, claim.last_conclusive_at + DEFAULT_LIMITS.reexamine_cooldown_seconds - now);
}

function ClaimView({ claimId }: { claimId: string }) {
  const bundle = useAsync((signal) => fetchClaim(claimId, signal), [claimId]);
  const wallet = useWallet();
  const tx = useTx();
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 15000);
    return () => window.clearInterval(timer);
  }, []);

  if (bundle.loading && !bundle.data)
    return (
      <div className="container section">
        <LoadingBlock text={`Reading ${claimId}…`} />
      </div>
    );
  if (bundle.error)
    return (
      <div className="container section">
        <ErrorBox message={bundle.error} onRetry={bundle.reload} />
      </div>
    );
  if (!bundle.data) return <NotFound />;

  const { claim, examinations } = bundle.data;
  const isOwner = sameAddress(wallet.account, claim.owner);
  const open = claim.status === 'OPEN';
  const wait = cooldownLeft(claim, now);
  const canExamine = open && claim.sources.length >= DEFAULT_LIMITS.min_sources_to_examine && wait === 0;
  const mine = claim.sources.filter((item) => sameAddress(item.added_by, wallet.account)).length;
  const lastExam = claim.last_exam_id;

  const examine = async () => {
    const result = await tx.send(`Examine ${claim.claim_id}`, 'examine', [claim.claim_id]);
    if (result) bundle.reload();
  };
  const drop = async (sourceId: string) => {
    if (!window.confirm(`Drop ${sourceId}? The drop is logged on chain with its last stance.`)) return;
    const result = await tx.send(`Drop ${sourceId}`, 'drop_source', [claim.claim_id, sourceId]);
    if (result) bundle.reload();
  };
  const close = async () => {
    if (!window.confirm('Close this claim? It stays on chain, but can no longer change or be examined.'))
      return;
    const result = await tx.send(`Close ${claim.claim_id}`, 'close_claim', [claim.claim_id]);
    if (result) bundle.reload();
  };

  return (
    <div className="container section" style={{ paddingTop: 36 }}>
      <p className="hint">
        <Link to="/claims">← All claims</Link>
      </p>
      <div className="row" style={{ gap: 10 }}>
        <span className="claim-id">{claim.claim_id}</span>
        <StatusChip status={claim.status} />
        <VerdictChip verdict={claim.standing} />
        <Chip tone="muted" dot={false}>
          {claim.topic}
        </Chip>
      </div>
      <h1 style={{ fontSize: 'clamp(1.8rem,3.5vw,2.6rem)', marginTop: 10 }}>{claim.title}</h1>
      <blockquote className="excerpt" style={{ fontSize: '1.1rem', color: 'var(--ink)' }}>
        {claim.statement}
      </blockquote>

      <div className="grid c2" style={{ marginTop: 22, alignItems: 'start' }}>
        <div className="card">
          <h3>Standing</h3>
          <p className="muted">{verdictMeta(claim.standing).meaning}</p>
          <dl className="kv">
            <dt>Anchors</dt>
            <dd className="row" style={{ gap: 6 }}>
              {claim.anchors.map((group) => (
                <Chip
                  key={group.join('|')}
                  tone="info"
                  dot={false}
                  title="A supporting source must show one of these spellings"
                >
                  {group.join(' | ')}
                </Chip>
              ))}
            </dd>
            <dt>Owner</dt>
            <dd>
              <Address value={claim.owner} />
              {isOwner ? ' (you)' : ''}
            </dd>
            <dt>Opened</dt>
            <dd>{formatTime(claim.created_at)}</dd>
            <dt>Last conclusive</dt>
            <dd>{formatTime(claim.last_conclusive_at)}</dd>
            <dt>Verdict flips</dt>
            <dd>{claim.flips}</dd>
            <dt>Commitment</dt>
            <dd className="mono" style={{ fontSize: '0.78rem' }}>
              {claim.commitment}
            </dd>
            {claim.closed_at ? (
              <>
                <dt>Closed</dt>
                <dd>{formatTime(claim.closed_at)}</dd>
              </>
            ) : null}
          </dl>
        </div>

        <div className="card">
          <h3>Examine</h3>
          <p className="muted">
            Validators fetch every source, find the passages that bear on the claim, and the contract grades
            them. Anyone may ask; it can take a few minutes.
          </p>
          <div className="row">
            <button className="btn primary" disabled={!canExamine || tx.busy} onClick={() => void examine()}>
              {wallet.status === 'connected' ? 'Examine now' : 'Connect to examine'}
            </button>
            {lastExam ? (
              <Link className="btn" to={`/exam/${lastExam}`}>
                Latest examination →
              </Link>
            ) : null}
          </div>
          {!open ? (
            <p className="hint" style={{ marginTop: 10 }}>
              This claim is closed.
            </p>
          ) : null}
          {open && claim.sources.length < DEFAULT_LIMITS.min_sources_to_examine ? (
            <p className="hint" style={{ marginTop: 10 }}>
              Add at least {DEFAULT_LIMITS.min_sources_to_examine} sources first.
            </p>
          ) : null}
          {open && wait > 0 ? (
            <p className="hint" style={{ marginTop: 10 }}>
              Examined recently and sources unchanged. Try again in about{' '}
              {formatDuration(Math.ceil(wait / 60) * 60)}, or change the sources.
            </p>
          ) : null}
        </div>
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <div className="row spread">
          <h3 style={{ margin: 0 }}>
            Sources ({claim.sources.length}/{DEFAULT_LIMITS.max_sources})
          </h3>
          {isOwner && open ? (
            <button className="btn small danger" onClick={() => void close()} disabled={tx.busy}>
              Close claim
            </button>
          ) : null}
        </div>
        {claim.sources.length === 0 ? (
          <p className="muted" style={{ marginTop: 12 }}>
            No sources yet.
          </p>
        ) : null}
        <div style={{ marginTop: 8 }}>
          {claim.sources.map((source) => (
            <div className="source-row" key={source.source_id}>
              <span className="sid">{source.source_id}</span>
              <div>
                <a className="url" href={source.url} target="_blank" rel="noreferrer">
                  {source.url}
                </a>
                <div className="hint">
                  publisher <code>{source.origin_key}</code> · added by <Address value={source.added_by} />
                  {sameAddress(source.added_by, wallet.account) ? ' (you)' : ''}
                </div>
              </div>
              <div className="row" style={{ gap: 8 }}>
                {claim.last_stance[source.source_id] ? (
                  <StanceChip stance={claim.last_stance[source.source_id] ?? ''} />
                ) : null}
                {isOwner && open ? (
                  <button
                    className="btn small ghost danger"
                    disabled={tx.busy}
                    onClick={() => void drop(source.source_id)}
                  >
                    Drop
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
        {open && claim.sources.length < DEFAULT_LIMITS.max_sources ? (
          <AddSource claim={claim} mine={mine} onAdded={bundle.reload} />
        ) : null}
      </div>

      <div className="grid c2" style={{ marginTop: 18, alignItems: 'start' }}>
        <div className="card">
          <h3>Examinations</h3>
          {examinations.length === 0 ? <p className="muted">Not examined yet.</p> : null}
          <div className="timeline">
            {[...examinations].reverse().map((exam) => (
              <div key={exam.exam_id} className={`tone-${verdictMeta(exam.verdict).tone}`}>
                <div className="row spread">
                  <Link to={`/exam/${exam.exam_id}`} className="mono">
                    {exam.exam_id}
                  </Link>
                  <VerdictChip verdict={exam.verdict} />
                </div>
                <div className="hint">
                  {formatTime(exam.examined_at)} · {exam.tallies.origins} origin
                  {exam.tallies.origins === 1 ? '' : 's'} from {exam.tallies.sources} source
                  {exam.tallies.sources === 1 ? '' : 's'}
                  {exam.tallies.echoes
                    ? ` · ${exam.tallies.echoes} echo${exam.tallies.echoes === 1 ? '' : 'es'}`
                    : ''}
                  {exam.conclusive ? '' : ' · not conclusive'}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <h3>What changed over time</h3>
          {claim.drift.length === 0 && claim.dropped.length === 0 && claim.flips === 0 ? (
            <p className="muted">No stance drift, dropped sources or verdict flips recorded.</p>
          ) : null}
          {claim.drift.length > 0 ? (
            <>
              <div className="label">Sources that changed their stance</div>
              <ul>
                {claim.drift.map((entry, index) => (
                  <li key={index}>
                    <span className="sid">{entry.source_id}</span> {entry.was.toLowerCase()} →{' '}
                    {entry.now.toLowerCase()} <span className="hint">({entry.exam_id})</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {claim.dropped.length > 0 ? (
            <>
              <div className="label">Dropped by the owner</div>
              <ul>
                {claim.dropped.map((entry, index) => (
                  <li key={index}>
                    <span className="sid">{entry.source_id}</span> <span className="url">{entry.url}</span>
                    <div className="hint">
                      {formatTime(entry.dropped_at)} · last stance{' '}
                      {entry.last_stance ? entry.last_stance.toLowerCase() : 'none'}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {claim.verdict_history.length > 1 ? (
            <>
              <div className="label">Verdict history</div>
              <div className="row" style={{ marginTop: 6 }}>
                {claim.verdict_history.map((entry) => (
                  <VerdictChip key={entry.exam_id} verdict={entry.verdict} />
                ))}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function AddSource({ claim, mine, onAdded }: { claim: ClaimRecord; mine: number; onAdded: () => void }) {
  const wallet = useWallet();
  const tx = useTx();
  const [url, setUrl] = useState('');
  const [preview, setPreview] = useState<UrlInspection | null>(null);
  const [checking, setChecking] = useState(false);

  const trimmed = url.trim();
  const quick = trimmed === '' ? '' : quickUrlProblem(trimmed);

  useEffect(() => {
    setPreview(null);
    if (trimmed === '' || quick !== '') return;
    const controller = new AbortController();
    setChecking(true);
    const timer = window.setTimeout(() => {
      inspectUrl(trimmed, controller.signal)
        .then((value) => !controller.signal.aborted && setPreview(value))
        .catch(() => !controller.signal.aborted && setPreview(null))
        .finally(() => !controller.signal.aborted && setChecking(false));
    }, 450);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
      setChecking(false);
    };
  }, [trimmed, quick]);

  let problem = quick;
  if (!problem && preview) {
    if (!preview.ok) problem = preview.reason;
    else if (claim.sources.some((item) => item.source_key === preview.source_key))
      problem = 'This page is already a source of the claim.';
    else if (
      claim.sources.filter((item) => item.origin_key === preview.origin_key).length >=
      DEFAULT_LIMITS.max_sources_per_origin
    )
      problem = `The claim already has ${DEFAULT_LIMITS.max_sources_per_origin} sources from ${preview.origin_key}.`;
  }
  if (!problem && mine >= DEFAULT_LIMITS.max_sources_per_adder && wallet.status === 'connected')
    problem = `You have already added ${DEFAULT_LIMITS.max_sources_per_adder} sources to this claim.`;

  const ready = trimmed !== '' && !problem && preview?.ok === true && !checking;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    const result = await tx.send(`Add source to ${claim.claim_id}`, 'add_source', [claim.claim_id, trimmed]);
    if (result) {
      setUrl('');
      onAdded();
    }
  };

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="stack"
      style={{ marginTop: 18, paddingTop: 18, borderTop: '1px solid var(--line)' }}
    >
      <div className="field">
        <label htmlFor="src">Add a source</label>
        <input
          id="src"
          className={`input${problem ? ' bad' : ''}`}
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://example.org/page"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
        />
        {problem ? <span className="error-text">{problem}</span> : null}
        {!problem && checking ? (
          <span className="hint">Asking the contract which publisher this is…</span>
        ) : null}
        {!problem && preview?.ok ? (
          <span className="hint">
            Publisher resolved on chain: <code>{preview.origin_key}</code>
          </span>
        ) : null}
        <span className="hint">
          Public https pages only. At most {DEFAULT_LIMITS.max_sources_per_origin} per publisher and{' '}
          {DEFAULT_LIMITS.max_sources_per_adder} per person. URL shorteners, web archives and paste sites are
          refused.
        </span>
      </div>
      <button className="btn primary" type="submit" disabled={!ready || tx.busy}>
        {wallet.status === 'connected' ? 'Add source' : 'Connect to add'}
      </button>
    </form>
  );
}
