import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../App';
import { ThemeProvider } from '../components/Theme';
import { TxProvider } from '../components/Tx';
import { WalletProvider } from '../wallet/WalletContext';
import type { ClaimBundle, ClaimRecord, ExamBundle, ExamRecord } from '../lib/types';

const tallies = {
  sources: 3,
  origins: 2,
  echoes: 1,
  readable_origins: 2,
  support_origins: 2,
  contradict_origins: 0,
  qualify_origins: 0,
  silent_origins: 0,
  conflicted_origins: 0,
  unresolved_origins: 0,
  support_sources: 3,
};

const claim: ClaimRecord = {
  claim_id: 'CLM-0001',
  title: 'Speed of light',
  statement: 'The speed of light in vacuum is exactly 299,792,458 metres per second.',
  topic: 'science',
  anchors: [['speed of light'], ['299,792,458', '299792458']],
  commitment: '0xabc',
  owner: '0x40b1e9682689a4fe00ee793e494a40b6f43a3e60',
  status: 'OPEN',
  created_at: 1_700_000_000,
  closed_at: 0,
  sources: [
    {
      source_id: 'S1',
      url: 'https://en.wikipedia.org/wiki/Speed_of_light',
      source_key: 'k1',
      origin_key: 'wikipedia.org',
      added_by: '0x40b1e9682689a4fe00ee793e494a40b6f43a3e60',
      added_at: 1,
    },
    {
      source_id: 'S2',
      url: 'https://physics.nist.gov/cgi-bin/cuu/Value?c',
      source_key: 'k2',
      origin_key: 'nist.gov',
      added_by: '0x40b1e9682689a4fe00ee793e494a40b6f43a3e60',
      added_at: 2,
    },
  ],
  next_source: 3,
  dropped: [],
  exam_ids: ['EXM-0001'],
  last_exam_id: 'EXM-0001',
  standing: 'CORROBORATED',
  last_conclusive_at: 1_700_000_100,
  dirty: false,
  flips: 0,
  verdict_history: [{ exam_id: 'EXM-0001', verdict: 'CORROBORATED', at: 1_700_000_100 }],
  last_stance: { S1: 'SUPPORTS', S2: 'SUPPORTS' },
  drift: [],
};

const exam: ExamRecord = {
  exam_id: 'EXM-0001',
  claim_id: 'CLM-0001',
  requested_by: claim.owner,
  examined_at: 1_700_000_100,
  verdict: 'CORROBORATED',
  conclusive: true,
  tallies,
  origins: [
    { origin_id: 'O1', sources: ['S1', 'S2'], stance: 'SUPPORTS' },
    { origin_id: 'O2', sources: ['S3'], stance: 'SUPPORTS' },
  ],
  edges: [{ a: 'S1', b: 'S2', kind: 'CITES' }],
  findings: [
    {
      source_id: 'S1',
      url: claim.sources[0]!.url,
      origin_key: 'wikipedia.org',
      stance: 'SUPPORTS',
      excerpt: 'speed of light is 299,792,458 m/s',
      reason: 'states it',
      flag: '',
      claimed: '',
      seen: '',
    },
    {
      source_id: 'S2',
      url: claim.sources[1]!.url,
      origin_key: 'nist.gov',
      stance: 'UNVERIFIED',
      excerpt: '',
      reason: '',
      flag: 'excerpt_not_in_source',
      claimed: 'made up text',
      seen: '',
    },
    {
      source_id: 'S3',
      url: 'https://example.org/x',
      origin_key: 'example.org',
      stance: 'SUPPORTS',
      excerpt: 'it is exactly 299,792,458',
      reason: '',
      flag: '',
      claimed: '',
      seen: '',
    },
  ],
  sources: [
    ...claim.sources.map(({ source_id, url, source_key, origin_key }) => ({
      source_id,
      url,
      source_key,
      origin_key,
    })),
    { source_id: 'S3', url: 'https://example.org/x', source_key: 'k3', origin_key: 'example.org' },
  ],
  attestation: '0x1111',
};

const api = vi.hoisted(() => ({
  fetchStats: vi.fn(),
  fetchInfo: vi.fn(),
  fetchAllClaims: vi.fn(),
  fetchClaim: vi.fn(),
  fetchExam: vi.fn(),
  inspectUrl: vi.fn(),
  recomputeAttestation: vi.fn(),
  fetchClaims: vi.fn(),
}));
vi.mock('../lib/api', async (original) => ({ ...(await original<typeof import('../lib/api')>()), ...api }));
vi.mock('../three/Hero3D', () => ({ default: () => <div data-testid="hero3d" /> }));

function renderAt(path: string) {
  return render(
    <ThemeProvider>
      <WalletProvider>
        <TxProvider>
          <MemoryRouter initialEntries={[path]}>
            <App />
          </MemoryRouter>
        </TxProvider>
      </WalletProvider>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  api.fetchStats.mockResolvedValue({
    claims: 3,
    examinations: 5,
    sources_added: 12,
    conclusive: 4,
    verdict_flips: 1,
    stance_drifts: 0,
    verdicts: { TRIANGULATED: 2 },
  });
  api.fetchAllClaims.mockResolvedValue({
    total: 1,
    offset: 0,
    items: [
      {
        claim_id: 'CLM-0001',
        title: 'Speed of light',
        topic: 'science',
        owner: claim.owner,
        status: 'OPEN',
        standing: 'CORROBORATED',
        sources: 2,
        examinations: 1,
        flips: 0,
        created_at: 1_700_000_000,
        last_exam_id: 'EXM-0001',
      },
    ],
  });
  api.fetchClaim.mockResolvedValue({
    claim,
    examinations: [
      {
        exam_id: 'EXM-0001',
        claim_id: 'CLM-0001',
        verdict: 'CORROBORATED',
        conclusive: true,
        tallies,
        examined_at: 1_700_000_100,
        requested_by: claim.owner,
      },
    ],
  } satisfies ClaimBundle);
  api.fetchExam.mockResolvedValue({ examination: exam, claim } satisfies ExamBundle);
});

describe('pages', () => {
  it('home shows live numbers from the contract', async () => {
    renderAt('/');
    expect(await screen.findByText('Claims on record')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('12')).toBeInTheDocument());
    expect(await screen.findByTestId('hero3d')).toBeInTheDocument();
  });

  it('home shows an honest error when the chain cannot be read', async () => {
    api.fetchStats.mockRejectedValue(new Error('rpc down'));
    renderAt('/');
    expect(await screen.findByText(/rpc down/)).toBeInTheDocument();
  });

  it('claims list renders and filters', async () => {
    renderAt('/claims');
    expect(await screen.findByText('Speed of light')).toBeInTheDocument();
    expect(screen.getByText('1 of 1 claims shown')).toBeInTheDocument();
  });

  it('claim page shows sources, anchors and standing', async () => {
    renderAt('/claims/CLM-0001');
    expect(await screen.findByText('Sources (2/6)')).toBeInTheDocument();
    expect(screen.getByText('speed of light')).toBeInTheDocument();
    expect(screen.getAllByText('Corroborated').length).toBeGreaterThan(0);
  });

  it('claim page rejects a malformed id without calling the chain', async () => {
    renderAt('/claims/nonsense');
    expect(await screen.findByText(/no fix on this position/i)).toBeInTheDocument();
    expect(api.fetchClaim).not.toHaveBeenCalled();
  });

  it('unknown claim shows not-found', async () => {
    api.fetchClaim.mockResolvedValue(null);
    renderAt('/claims/CLM-0099');
    expect(await screen.findByText(/no fix on this position/i)).toBeInTheDocument();
  });

  it('examination page shows findings, flags and the echo graph', async () => {
    renderAt('/exam/EXM-0001');
    expect(await screen.findByText('What each source said')).toBeInTheDocument();
    expect(screen.getByText(/was not found on the page/i)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /echo graph with 3 sources in 2 origins/i })).toBeInTheDocument();
    expect(screen.getByText(/speed of light is 299,792,458 m\/s/)).toBeInTheDocument();
  });

  it('recomputes the attestation on chain and reports a match', async () => {
    api.recomputeAttestation.mockResolvedValue('0x1111');
    renderAt('/exam/EXM-0001');
    (await screen.findByRole('button', { name: /recompute on chain/i })).click();
    expect(await screen.findByText(/recomputed digest matches/i)).toBeInTheDocument();
  });

  it('reports a different attestation honestly', async () => {
    api.recomputeAttestation.mockResolvedValue('0x2222');
    renderAt('/exam/EXM-0001');
    (await screen.findByRole('button', { name: /recompute on chain/i })).click();
    expect(await screen.findByText(/digest differs/i)).toBeInTheDocument();
  });

  it('docs render every page and navigate', async () => {
    const { DOCS } = await import('../docs/content');
    api.fetchInfo.mockResolvedValue({
      limits: {
        min_sources_to_examine: 2,
        max_sources: 6,
        max_sources_per_adder: 3,
        max_sources_per_origin: 2,
        min_statement_chars: 20,
        max_statement_chars: 400,
        max_title_chars: 120,
        max_anchor_groups: 4,
        max_anchor_alternatives: 4,
        max_anchor_chars: 60,
        max_url_chars: 500,
        max_examinations_per_claim: 30,
        reexamine_cooldown_seconds: 3600,
        window_chars: 2800,
      },
      publishers: {
        path_tenant_hosts: { 'github.com': ['github', 1] },
        tenant_suffixes: ['github.io'],
        refused_hosts: ['bit.ly'],
      },
    });
    for (const doc of DOCS) {
      const view = renderAt(doc.slug === 'overview' ? '/docs' : `/docs/${doc.slug}`);
      expect(await screen.findByRole('heading', { level: 1, name: doc.title })).toBeInTheDocument();
      view.unmount();
    }
    expect(DOCS.length).toBeGreaterThanOrEqual(12);
  });

  it('inspect page asks the contract', async () => {
    api.inspectUrl.mockResolvedValue({
      ok: true,
      url: 'https://github.com/psf/requests',
      origin_key: 'github:psf',
      source_key: 'github.com/psf/requests',
      reason: '',
    });
    renderAt('/inspect');
    const input = await screen.findByLabelText('Address');
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.change(input, { target: { value: 'https://github.com/psf/requests' } });
    fireEvent.click(screen.getByRole('button', { name: 'Inspect' }));
    expect(await screen.findByText('github:psf')).toBeInTheDocument();
  });

  it('new claim form blocks an invalid claim before any signing', async () => {
    renderAt('/new');
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.click(await screen.findByRole('button', { name: /connect wallet & open/i }));
    expect(await screen.findByText(/fix the highlighted fields/i)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
