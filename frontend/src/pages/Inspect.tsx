import { useState } from 'react';
import { Link } from 'react-router-dom';

import { Chip } from '../components/Verdict';
import { EchoSpinner } from '../components/Spinners';
import { inspectUrl } from '../lib/api';
import { quickUrlProblem } from '../lib/validate';
import type { UrlInspection } from '../lib/types';

const EXAMPLES = [
  'https://en.wikipedia.org/wiki/Speed_of_light',
  'https://github.com/psf/requests',
  'https://raw.githubusercontent.com/psf/requests/main/LICENSE',
  'https://alice.github.io/blog',
  'https://www.bbc.co.uk/news',
  'https://bit.ly/abc',
  'https://web.archive.org/web/2020/https://example.org',
];

export function Inspect() {
  const [url, setUrl] = useState('');
  const [result, setResult] = useState<UrlInspection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async (value: string) => {
    const text = value.trim();
    setError('');
    setResult(null);
    const quick = quickUrlProblem(text);
    if (quick) return setError(quick);
    setBusy(true);
    try {
      setResult(await inspectUrl(text));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container section" style={{ paddingTop: 44, maxWidth: 860 }}>
      <div className="eyebrow">Inspect URL</div>
      <h1 style={{ fontSize: 'clamp(2rem,4vw,3rem)' }}>Whose voice is this page?</h1>
      <p className="lead">
        Ask the contract what it makes of an address, without sending a transaction: whether it is acceptable
        as a source, which publisher it belongs to, and its document key. Two addresses with the same
        publisher can never count as two independent voices.
      </p>
      <form
        className="card stack"
        onSubmit={(event) => {
          event.preventDefault();
          void run(url);
        }}
      >
        <div className="field">
          <label htmlFor="u">Address</label>
          <input
            id="u"
            className="input"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            inputMode="url"
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        <div className="row">
          <button className="btn primary" type="submit" disabled={busy}>
            Inspect
          </button>
          {busy ? <EchoSpinner size={26} /> : null}
        </div>
        <div>
          <span className="hint">Try: </span>
          <span className="row" style={{ display: 'inline-flex', gap: 6 }}>
            {EXAMPLES.map((example) => (
              <button
                type="button"
                key={example}
                className="btn small ghost"
                onClick={() => {
                  setUrl(example);
                  void run(example);
                }}
              >
                {example.replace('https://', '').slice(0, 34)}
              </button>
            ))}
          </span>
        </div>
      </form>
      {error ? (
        <div className="notice tone-bad" role="alert" style={{ marginTop: 16 }}>
          {error}
        </div>
      ) : null}
      {result ? (
        <div className={`notice tone-${result.ok ? 'good' : 'bad'}`} style={{ marginTop: 16 }} role="status">
          <div className="row">
            <Chip tone={result.ok ? 'good' : 'bad'}>{result.ok ? 'accepted as a source' : 'refused'}</Chip>
          </div>
          {result.ok ? (
            <dl className="kv" style={{ marginTop: 12 }}>
              <dt>Publisher (origin)</dt>
              <dd>
                <code>{result.origin_key}</code>
              </dd>
              <dt>Document key</dt>
              <dd>
                <code>{result.source_key}</code>
              </dd>
              <dt>Stored address</dt>
              <dd className="url">{result.url}</dd>
            </dl>
          ) : (
            <p style={{ margin: '10px 0 0' }}>{result.reason}</p>
          )}
        </div>
      ) : null}
      <p className="hint" style={{ marginTop: 18 }}>
        How publishers are resolved: <Link to="/docs/publishers">documentation →</Link>
      </p>
    </div>
  );
}
