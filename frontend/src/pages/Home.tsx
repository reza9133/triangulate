import { lazy, Suspense } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';

import { Address, ErrorBox } from '../components/Address';
import { Skeleton } from '../components/Spinners';
import { Tilt } from '../components/Tilt';
import { verdictMeta } from '../lib/format';
import { VERDICTS } from '../lib/types';
import { fetchStats } from '../lib/api';
import { CONTRACT_ADDRESS, GITHUB_URL, explorerAddress } from '../lib/config';
import { useAsync } from '../lib/useAsync';
import { Chip, VerdictChip } from '../components/Verdict';

const Hero3D = lazy(() => import('../three/Hero3D'));

const STEPS = [
  {
    n: '01',
    title: 'State a claim',
    text: 'Write the claim in a sentence or two and name its anchors: the numbers, names or dates a source must actually show.',
  },
  {
    n: '02',
    title: 'Offer sources',
    text: 'Anyone adds public https pages. The contract works out each publisher on chain and refuses pages that hide it.',
  },
  {
    n: '03',
    title: 'Validators read',
    text: 'Every validator fetches every page and classifies it: supports, contradicts, qualifies or silent, with a verbatim excerpt.',
  },
  {
    n: '04',
    title: 'Echoes collapse',
    text: 'Pages that are really the same voice merge into one origin. The verdict is computed from origins, never written by a model.',
  },
];

const RULES = [
  {
    kind: 'SAME_ORIGIN',
    title: 'Same publisher',
    text: 'One registrable domain, or one tenant of a shared host such as github.com/psf.',
  },
  {
    kind: 'CITES',
    title: 'Links to',
    text: 'The page contains the exact address of the other page: it relays it.',
  },
  {
    kind: 'NEAR_COPY',
    title: 'Near copy',
    text: 'Most of the smaller page appears in the larger: syndication, mirrors.',
  },
  {
    kind: 'SHARED_PASSAGE',
    title: 'Shared passage',
    text: 'Both carry the same claim-relevant sentence, word for word.',
  },
];

export function Home() {
  const stats = useAsync((signal) => fetchStats(signal), []);
  const s = stats.data;
  return (
    <>
      <section className="hero">
        <div className="glow-orb" />
        <div className="glow-orb b" />
        <div className="container hero-grid">
          <div className="reveal">
            <div className="eyebrow">Intelligent Contract · GenLayer Studionet</div>
            <h1>
              How many <span className="grad">independent voices</span> really stand behind a claim?
            </h1>
            <p className="lead">
              Ten web pages can repeat one sentence and still be one source. Triangulate makes validators read
              every page, collapses the echoes, and only then counts: origins, not links.
            </p>
            <div className="row" style={{ marginTop: 26 }}>
              <Link className="btn primary" to="/new">
                Open a claim
              </Link>
              <Link className="btn" to="/claims">
                Browse claims
              </Link>
              <Link className="btn ghost" to="/docs">
                Read the docs →
              </Link>
            </div>
            <p className="hint" style={{ marginTop: 18 }}>
              Contract <Address value={CONTRACT_ADDRESS} /> · live on Studionet, gasless, no funds needed.
            </p>
          </div>
          <Suspense fallback={<div className="hero-canvas skeleton" />}>
            <Hero3D />
          </Suspense>
        </div>
      </section>

      <section className="container" aria-label="Live statistics" style={{ marginTop: 28 }}>
        {stats.error ? (
          <ErrorBox message={stats.error} onRetry={stats.reload} />
        ) : (
          <div className="grid c4">
            {[
              ['Claims on record', s?.claims],
              ['Examinations', s?.examinations],
              ['Sources offered', s?.sources_added],
              ['Verdict flips recorded', s?.verdict_flips],
            ].map(([label, value]) => (
              <div className="card stat" key={String(label)}>
                {s ? <b>{String(value)}</b> : <Skeleton height={40} width={80} />}
                <span>{String(label)}</span>
              </div>
            ))}
          </div>
        )}
        <p className="hint" style={{ marginTop: 10 }}>
          Numbers are read live from the contract.
        </p>
      </section>

      <section className="section container">
        <div className="eyebrow">How it works</div>
        <h2>From a sentence to a verdict nobody wrote</h2>
        <div className="grid c4" style={{ marginTop: 28, perspective: 1000 }}>
          {STEPS.map((step, index) => (
            <motion.div
              key={step.n}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ delay: index * 0.08 }}
            >
              <Tilt className="card" style={{ height: '100%' }}>
                <div className="mono" style={{ color: 'var(--accent)', fontWeight: 700 }}>
                  {step.n}
                </div>
                <h3 style={{ marginTop: 6 }}>{step.title}</h3>
                <p className="muted" style={{ marginBottom: 0 }}>
                  {step.text}
                </p>
              </Tilt>
            </motion.div>
          ))}
        </div>
      </section>

      <section className="section container" style={{ paddingTop: 0 }}>
        <div className="eyebrow">Independence is computed</div>
        <h2>Four ways two pages turn out to be one voice</h2>
        <p className="lead">
          The echo graph depends only on addresses and fetched text, never on what a model said, so a prompt
          cannot steer it. Origins are the connected groups of that graph.
        </p>
        <div className="grid c4" style={{ marginTop: 24 }}>
          {RULES.map((rule) => (
            <Tilt key={rule.kind} className="card flat">
              <Chip tone="info" dot={false}>
                {rule.kind.toLowerCase().replace('_', ' ')}
              </Chip>
              <h3 style={{ marginTop: 12 }}>{rule.title}</h3>
              <p className="muted" style={{ marginBottom: 0 }}>
                {rule.text}
              </p>
            </Tilt>
          ))}
        </div>
      </section>

      <section className="section container" style={{ paddingTop: 0 }}>
        <div className="eyebrow">Verdicts</div>
        <h2>Nine possible outcomes, strictest evidence first</h2>
        <div className="ladder" style={{ marginTop: 24 }}>
          {VERDICTS.map((verdict) => {
            const meta = verdictMeta(verdict);
            const count = s?.verdicts[verdict];
            return (
              <div key={verdict} className={`ladder-row tone-${meta.tone}`}>
                <div className="row">
                  <VerdictChip verdict={verdict} />
                  {count ? <span className="hint">×{count}</span> : null}
                </div>
                <div className="muted">{meta.meaning}</div>
              </div>
            );
          })}
        </div>
        <p className="hint" style={{ marginTop: 10 }}>
          It reports corroboration, not truth: many independent sources can be wrong together.
        </p>
      </section>

      <section className="section container" style={{ paddingTop: 0 }}>
        <div
          className="card"
          style={{
            display: 'grid',
            gap: 12,
            background:
              'linear-gradient(135deg, color-mix(in srgb, var(--accent) 14%, var(--surface)), var(--surface))',
          }}
        >
          <h2 style={{ marginBottom: 0 }}>Verified on Studionet</h2>
          <p className="muted" style={{ margin: 0, maxWidth: '70ch' }}>
            The deployed contract passed its live end-to-end run: publisher-resolution views, every refusal
            proof with state unchanged, and live scenarios (a defined constant triangulated across three
            publishers, a popular myth refuted, an unreachable page that blocks a clean bill).
          </p>
          <div className="row">
            <a className="btn" href={explorerAddress(CONTRACT_ADDRESS)} target="_blank" rel="noreferrer">
              Open in explorer ↗
            </a>
            <a className="btn" href={`${GITHUB_URL}/tree/main/reports`} target="_blank" rel="noreferrer">
              Read the report ↗
            </a>
            <Link className="btn ghost" to="/docs/testing">
              How it is tested →
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
