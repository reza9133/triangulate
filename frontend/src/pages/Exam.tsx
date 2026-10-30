import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { Address, ErrorBox } from '../components/Address';
import { EchoGraph } from '../components/EchoGraph';
import { EchoSpinner, LoadingBlock } from '../components/Spinners';
import { Chip, StanceChip, VerdictChip } from '../components/Verdict';
import { EXAM_ID_RE, fetchExam, recomputeAttestation } from '../lib/api';
import { EDGE_EXPLAIN, EDGE_LABEL, FLAG_EXPLAIN, formatTime, hostOf, verdictMeta } from '../lib/format';
import { useAsync } from '../lib/useAsync';
import { NotFound } from './NotFound';

export function Exam() {
  const { examId = '' } = useParams();
  if (!EXAM_ID_RE.test(examId)) return <NotFound />;
  return <ExamView examId={examId} />;
}

type Check =
  | { state: 'idle' }
  | { state: 'running' }
  | { state: 'match'; value: string }
  | { state: 'differs'; value: string }
  | { state: 'error'; message: string };

function ExamView({ examId }: { examId: string }) {
  const bundle = useAsync((signal) => fetchExam(examId, signal), [examId]);
  const [check, setCheck] = useState<Check>({ state: 'idle' });

  if (bundle.loading && !bundle.data)
    return (
      <div className="container section">
        <LoadingBlock text={`Reading ${examId}…`} />
      </div>
    );
  if (bundle.error)
    return (
      <div className="container section">
        <ErrorBox message={bundle.error} onRetry={bundle.reload} />
      </div>
    );
  if (!bundle.data) return <NotFound />;

  const { examination: exam, claim } = bundle.data;
  const meta = verdictMeta(exam.verdict);
  const t = exam.tallies;
  const findingOf = new Map(exam.findings.map((finding) => [finding.source_id, finding]));

  const recompute = async () => {
    setCheck({ state: 'running' });
    try {
      const value = (await recomputeAttestation(examId)).trim();
      setCheck(
        value.toLowerCase() === exam.attestation.toLowerCase()
          ? { state: 'match', value }
          : { state: 'differs', value },
      );
    } catch (error) {
      setCheck({ state: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  };

  return (
    <div className="container section" style={{ paddingTop: 36 }}>
      <p className="hint">
        <Link to={`/claims/${claim.claim_id}`}>
          ← {claim.claim_id}: {claim.title}
        </Link>
      </p>
      <div className="row">
        <span className="claim-id">{exam.exam_id}</span>
        <VerdictChip verdict={exam.verdict} />
        {!exam.conclusive ? <Chip tone="warn">not conclusive</Chip> : null}
      </div>
      <h1 style={{ fontSize: 'clamp(1.8rem,3.5vw,2.6rem)', marginTop: 10 }}>{meta.label}</h1>
      <p className="lead">{meta.meaning}</p>
      <blockquote className="excerpt" style={{ color: 'var(--ink)' }}>
        {claim.statement}
      </blockquote>
      <p className="hint">
        Examined {formatTime(exam.examined_at)} · requested by <Address value={exam.requested_by} />
      </p>

      <div className="grid c4" style={{ marginTop: 20 }}>
        {[
          ['Sources read', t.sources],
          ['Independent origins', t.origins],
          ['Echoes collapsed', t.echoes],
          ['Origins supporting', t.support_origins + t.conflicted_origins],
          ['Origins contradicting', t.contradict_origins + t.conflicted_origins],
          ['Origins qualifying', t.qualify_origins],
          ['Origins silent', t.silent_origins],
          ['Unresolved origins', t.unresolved_origins],
        ].map(([label, value]) => (
          <div className="card stat" key={String(label)}>
            <b>{String(value)}</b>
            <span>{String(label)}</span>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginTop: 22 }}>
        <h3>Echo graph</h3>
        <p className="muted">
          Sources are circles, origins are the dashed bubbles. Edges are echoes computed from addresses and
          fetched text, never from a model.
        </p>
        <EchoGraph origins={exam.origins} edges={exam.edges} findings={exam.findings} />
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <h3>What each source said</h3>
        {exam.sources.map((source) => {
          const finding = findingOf.get(source.source_id);
          const origin = exam.origins.find((item) => item.sources.includes(source.source_id));
          return (
            <div className="source-row" key={source.source_id}>
              <span className="sid">{source.source_id}</span>
              <div>
                <a className="url" href={source.url} target="_blank" rel="noreferrer">
                  {hostOf(source.url)}
                  <span className="muted">
                    {source.url.slice(source.url.indexOf(hostOf(source.url)) + hostOf(source.url).length)}
                  </span>
                </a>
                <div className="hint">
                  publisher <code>{source.origin_key}</code> · {origin?.origin_id}
                </div>
                {finding?.excerpt ? <blockquote className="excerpt">“{finding.excerpt}”</blockquote> : null}
                {finding?.reason ? (
                  <div className="hint" style={{ marginTop: 6 }}>
                    Reader’s note: {finding.reason}
                  </div>
                ) : null}
                {finding?.flag ? (
                  <div className="hint" style={{ color: 'var(--warn)' }}>
                    {FLAG_EXPLAIN[finding.flag] ?? finding.flag}
                  </div>
                ) : null}
                {finding?.claimed ? <div className="hint">Model claimed: “{finding.claimed}”</div> : null}
                {finding?.seen ? (
                  <div className="hint">Validator’s copy near the first anchor: “{finding.seen}”</div>
                ) : null}
              </div>
              {finding ? <StanceChip stance={finding.stance} /> : null}
            </div>
          );
        })}
      </div>

      <div className="grid c2" style={{ marginTop: 18, alignItems: 'start' }}>
        <div className="card">
          <h3>Origins</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Origin</th>
                  <th>Sources</th>
                  <th>Stance</th>
                </tr>
              </thead>
              <tbody>
                {exam.origins.map((origin) => (
                  <tr key={origin.origin_id}>
                    <td className="mono">{origin.origin_id}</td>
                    <td>{origin.sources.join(', ')}</td>
                    <td>
                      <StanceChip stance={origin.stance} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <h3>Echo edges</h3>
          {exam.edges.length === 0 ? (
            <p className="muted">None: every source is its own voice.</p>
          ) : (
            <ul style={{ paddingLeft: 18 }}>
              {exam.edges.map((edge, index) => (
                <li key={index} title={EDGE_EXPLAIN[edge.kind]}>
                  <span className="sid">{edge.a}</span> {edge.kind === 'CITES' ? '→' : '↔'}{' '}
                  <span className="sid">{edge.b}</span> {EDGE_LABEL[edge.kind]}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <h3>Attestation</h3>
        <p className="muted">
          A digest of this examination’s canonical record. Anyone can have the contract recompute it from
          public state, so nobody has to trust a copy of it.
        </p>
        <div className="mono" style={{ wordBreak: 'break-all', fontSize: '0.82rem' }}>
          {exam.attestation}
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn" onClick={() => void recompute()} disabled={check.state === 'running'}>
            {check.state === 'running' ? 'Asking the contract…' : 'Recompute on chain'}
          </button>
          {check.state === 'running' ? <EchoSpinner size={26} /> : null}
          {check.state === 'match' ? <Chip tone="good">recomputed digest matches</Chip> : null}
          {check.state === 'differs' ? (
            <Chip tone="bad">digest differs: {check.value.slice(0, 12)}…</Chip>
          ) : null}
          {check.state === 'error' ? <span className="error-text">{check.message}</span> : null}
        </div>
      </div>
    </div>
  );
}
