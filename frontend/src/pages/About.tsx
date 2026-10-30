import { Address } from '../components/Address';
import { GenLayerMark, LogoMark } from '../components/Logo';
import {
  CHAIN_ID,
  CHAIN_NAME,
  CONTRACT_ADDRESS,
  EXPLORER_URL,
  GENLAYER_DOCS_URL,
  GENLAYER_URL,
  GITHUB_URL,
  X_HANDLE,
  X_URL,
  explorerAddress,
} from '../lib/config';
import { fetchInfo } from '../lib/api';
import { useAsync } from '../lib/useAsync';

export function About() {
  const info = useAsync((signal) => fetchInfo(signal), []);
  return (
    <div className="container section" style={{ paddingTop: 44, maxWidth: 900 }}>
      <div className="row" style={{ gap: 20 }}>
        <LogoMark size={84} />
        <div>
          <div className="eyebrow">About</div>
          <h1 style={{ fontSize: 'clamp(2rem,4vw,3rem)', marginBottom: 0 }}>Triangulate</h1>
        </div>
      </div>
      <p className="lead" style={{ marginTop: 18 }}>
        A fix on a position needs bearings from several independent places. A claim is the same: one voice
        repeated ten times is one bearing. Triangulate counts the bearings.
      </p>

      <div className="grid c2" style={{ marginTop: 24, alignItems: 'start' }}>
        <div className="card">
          <h3>The logo</h3>
          <p className="muted" style={{ marginBottom: 0 }}>
            Three sources at the corners of a triangle, and the point where their lines meet: one position
            fixed by several independent bearings. The gradient runs from the signal teal of a verified fix to
            the amber of a position still being measured.
          </p>
        </div>
        <div className="card">
          <h3>Built on GenLayer</h3>
          <p className="muted">
            <GenLayerMark size={20} /> GenLayer lets contracts read the web and reason with validators’
            language models, with consensus over non-deterministic results. Triangulate depends on exactly
            that: every validator fetches every page and must agree on what it says.
          </p>
          <div className="row">
            <a className="btn small" href={GENLAYER_URL} target="_blank" rel="noreferrer">
              genlayer.com ↗
            </a>
            <a className="btn small" href={GENLAYER_DOCS_URL} target="_blank" rel="noreferrer">
              GenLayer docs ↗
            </a>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <h3>Deployment</h3>
        <dl className="kv">
          <dt>Network</dt>
          <dd>
            {CHAIN_NAME} (chain id {CHAIN_ID})
          </dd>
          <dt>Contract</dt>
          <dd>
            <Address value={CONTRACT_ADDRESS} /> ·{' '}
            <a href={explorerAddress(CONTRACT_ADDRESS)} target="_blank" rel="noreferrer">
              explorer ↗
            </a>
          </dd>
          <dt>Full address</dt>
          <dd className="mono" style={{ wordBreak: 'break-all', fontSize: '0.82rem' }}>
            {CONTRACT_ADDRESS}
          </dd>
          <dt>Version</dt>
          <dd>
            {info.data
              ? `${info.data.name} ${info.data.version}`
              : info.error
                ? 'unreachable right now'
                : 'reading…'}
          </dd>
          <dt>Runner</dt>
          <dd className="mono" style={{ wordBreak: 'break-all', fontSize: '0.78rem' }}>
            {info.data?.runner ?? '—'}
          </dd>
          <dt>Explorer</dt>
          <dd>
            <a href={EXPLORER_URL} target="_blank" rel="noreferrer">
              {EXPLORER_URL} ↗
            </a>
          </dd>
        </dl>
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <h3>Honest limits</h3>
        <ul>
          <li>
            <strong>Origin is not authorship.</strong> Two publishers can be controlled by one person; the
            contract cannot see who owns them.
          </li>
          <li>
            <strong>It reports corroboration, not truth.</strong> Many independent sources can be wrong
            together.
          </li>
          <li>
            <strong>Negation detection is English.</strong>
          </li>
          <li>
            <strong>Live consensus can be noisy.</strong> A borderline page can end an examination
            undetermined.
          </li>
        </ul>
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <h3>Author & source</h3>
        <div className="row">
          <a className="btn" href={GITHUB_URL} target="_blank" rel="noreferrer">
            GitHub repository ↗
          </a>
          <a className="btn" href={X_URL} target="_blank" rel="noreferrer">
            {X_HANDLE} on X ↗
          </a>
        </div>
        <p className="hint" style={{ marginTop: 14, marginBottom: 0 }}>
          MIT licence. Issues and pull requests are welcome.
        </p>
      </div>
    </div>
  );
}
