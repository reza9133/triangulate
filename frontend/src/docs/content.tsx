import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { fetchInfo } from '../lib/api';
import {
  CHAIN_ID,
  CHAIN_NAME,
  CONTRACT_ADDRESS,
  EXPLORER_URL,
  GITHUB_URL,
  RPC_URL,
  explorerAddress,
} from '../lib/config';
import { formatDuration, verdictMeta } from '../lib/format';
import { useAsync } from '../lib/useAsync';
import { VERDICTS } from '../lib/types';
import { VerdictChip } from '../components/Verdict';
import { LoadingBlock } from '../components/Spinners';

export interface DocPage {
  slug: string;
  title: string;
  group: string;
  summary: string;
  body: () => ReactNode;
}

const Table = ({ head, rows }: { head: string[]; rows: ReactNode[][] }) => (
  <div className="table-wrap">
    <table>
      <thead>
        <tr>
          {head.map((h) => (
            <th key={h}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {row.map((cell, j) => (
              <td key={j}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

function LiveLimits() {
  const info = useAsync((signal) => fetchInfo(signal), []);
  if (!info.data)
    return info.error ? (
      <p className="error-text">Could not read the live limits: {info.error}</p>
    ) : (
      <LoadingBlock text="Reading limits from the contract…" />
    );
  const l = info.data.limits;
  return (
    <Table
      head={['Limit', 'Value (read live from the contract)']}
      rows={[
        ['Sources per claim', `${l.min_sources_to_examine} to examine, ${l.max_sources} at most`],
        ['Sources per person per claim', l.max_sources_per_adder],
        ['Sources per publisher per claim', l.max_sources_per_origin],
        ['Statement length', `${l.min_statement_chars}–${l.max_statement_chars} characters`],
        ['Title length', `3–${l.max_title_chars} characters`],
        [
          'Anchors',
          `${l.max_anchor_groups} per claim, ${l.max_anchor_alternatives} spellings each, ${l.max_anchor_chars} characters per spelling`,
        ],
        ['Address length', `${l.max_url_chars} characters`],
        ['Examinations per claim', l.max_examinations_per_claim],
        [
          'Re-examination cooldown',
          `${formatDuration(l.reexamine_cooldown_seconds)} (unless the sources changed)`,
        ],
        ['Text window shown to the model', `${l.window_chars} characters per source`],
      ]}
    />
  );
}

function LivePublishers() {
  const info = useAsync((signal) => fetchInfo(signal), []);
  if (!info.data)
    return info.error ? (
      <p className="error-text">{info.error}</p>
    ) : (
      <LoadingBlock text="Reading publisher tables from the contract…" />
    );
  const p = info.data.publishers;
  return (
    <>
      <h3>Hosts named by a path segment</h3>
      <p>
        On these hosts the publisher is the tenant in the path. The family prefix makes{' '}
        <code>github.com/alice</code>, <code>raw.githubusercontent.com/alice</code> and{' '}
        <code>gist.github.com/alice</code> one origin.
      </p>
      <Table
        head={['Host', 'Family', 'Path segments']}
        rows={Object.entries(p.path_tenant_hosts).map(([host, [family, depth]]) => [
          <code key={host}>{host}</code>,
          family,
          depth,
        ])}
      />
      <h3>Hosts named by a subdomain</h3>
      <p>
        Under these suffixes the subdomain is the tenant: <code>tenant.pages.dev</code> is its own publisher.
      </p>
      <p>
        {p.tenant_suffixes.map((s) => (
          <code key={s} style={{ marginRight: 6, display: 'inline-block', marginBottom: 6 }}>
            {s}
          </code>
        ))}
      </p>
      <h3>Refused hosts</h3>
      <p>
        These hide or fabricate a publisher (shorteners, web archives, paste sites, shared document hosts), so
        a source on one is refused on chain.
      </p>
      <p>
        {p.refused_hosts.map((s) => (
          <code key={s} style={{ marginRight: 6, display: 'inline-block', marginBottom: 6 }}>
            {s}
          </code>
        ))}
      </p>
    </>
  );
}

export const DOCS: DocPage[] = [
  {
    slug: 'overview',
    title: 'Overview',
    group: 'Start here',
    summary: 'What Triangulate is, and what it deliberately is not.',
    body: () => (
      <>
        <p className="lead">
          Ten web pages can repeat one sentence and still be one source. A wire story is syndicated, a blog
          quotes the press release, a mirror copies an encyclopedia. Counting links is not counting evidence.
        </p>
        <p>
          Triangulate is a GenLayer Intelligent Contract. It keeps a <strong>claim</strong> on chain together
          with the pages offered as <strong>sources</strong>, makes the validators read every page, and then
          collapses sources that are really the same voice before it counts anything.
        </p>
        <div className="notice tone-info">
          <strong>It does not decide whether a claim is true.</strong> It decides how well the claim is{' '}
          <em>corroborated</em>: how many independent origins support it, how many contradict it, and how many
          of the pages that seem to agree are only echoes of each other.
        </div>
        <h2 id="lifecycle">Lifecycle</h2>
        <ol>
          <li>
            <strong>Open a claim.</strong> State it in one or two sentences and name its anchors.
          </li>
          <li>
            <strong>Add sources.</strong> Anyone adds public https pages. The contract works out each page’s
            publisher without any network access, and refuses pages that hide it.
          </li>
          <li>
            <strong>Examine.</strong> Validators fetch every source and classify it as <code>SUPPORTS</code>,{' '}
            <code>CONTRADICTS</code>, <code>QUALIFIES</code> or <code>SILENT</code> with a verbatim excerpt.
            The contract verifies every excerpt against the page and merges echoes into one origin. The
            verdict is computed from the surviving origins. A model never writes it.
          </li>
          <li>
            <strong>Examine again.</strong> Pages change. Every examination is kept; verdict flips and sources
            that quietly changed their stance are recorded permanently.
          </li>
        </ol>
        <h2 id="rules">Design rules enforced on chain</h2>
        <ul>
          <li>
            <strong>The claim is data, not instructions.</strong> Claim and page text are fenced as untrusted
            inside the prompt and can only influence the outcome through a fixed stance vocabulary plus
            verbatim excerpts the contract re-verifies.
          </li>
          <li>
            <strong>Independence is computed, never asserted.</strong>
          </li>
          <li>
            <strong>Support must show the anchors.</strong>
          </li>
          <li>
            <strong>Fail closed.</strong> An unreadable page or unverifiable answer never counts as evidence,
            and a clean bill is never issued while a source is unresolved.
          </li>
          <li>
            <strong>The owner curates, the record remembers.</strong> A dropped source is logged with the
            stance it last had.
          </li>
        </ul>
        <p>The contract holds no value and moves no value. It is a record-keeper and adjudicator.</p>
        <p>
          Next: <Link to="/docs/getting-started">Getting started →</Link>
        </p>
      </>
    ),
  },
  {
    slug: 'getting-started',
    title: 'Getting started',
    group: 'Start here',
    summary: 'Connect a wallet, open a claim, add sources, examine.',
    body: () => (
      <>
        <p>
          You do not need a wallet to <em>read</em> anything: claims, examinations and statistics come
          straight from the contract. A wallet is needed to write.
        </p>
        <h2 id="connect">1. Connect a wallet</h2>
        <p>
          Press <strong>Connect wallet</strong>. The app lists every wallet installed in your browser (
          <Link to="/docs/wallet">EIP-6963</Link>). Pick one and approve the connection. If your wallet is on
          another network the app shows a banner with a <strong>Switch to {CHAIN_NAME}</strong> button; the
          network is added to your wallet automatically if it is missing.
        </p>
        <p>Studionet is gasless, so no funds are needed.</p>
        <h2 id="open">2. Open a claim</h2>
        <p>
          Go to <Link to="/new">New claim</Link>. Write a title, the statement, a topic and the anchors (see{' '}
          <Link to="/docs/anchors">Anchors</Link>). The form checks every rule the contract checks, so you
          find problems before you sign.
        </p>
        <h2 id="sources">3. Add sources</h2>
        <p>
          On the claim page, paste the address of a public page. The app asks the contract which publisher it
          is before you send anything. Two to six sources are needed; add pages from <em>different</em>{' '}
          publishers if you want independence to show.
        </p>
        <h2 id="examine">4. Examine</h2>
        <p>
          Press <strong>Examine now</strong>. Every validator fetches every page and calls a language model,
          so this takes minutes, not seconds. A progress card shows the transaction status. The result is the
          examination page: the verdict, the echo graph, and what each source said.
        </p>
        <h2 id="after">5. Come back later</h2>
        <p>
          Pages change. After {formatDuration(3600)} (or as soon as the sources change) the claim can be
          examined again. Flips and drifts are kept forever.
        </p>
      </>
    ),
  },
  {
    slug: 'concepts',
    title: 'Origins & the echo graph',
    group: 'Concepts',
    summary: 'How pages are merged into independent voices.',
    body: () => (
      <>
        <p>
          The unit of evidence is an <strong>origin</strong>, not a page. Sources are the nodes of a graph; an
          edge means “these two are the same voice”. Origins are the connected groups of that graph.
        </p>
        <Table
          head={['Edge', 'Rule', 'Why']}
          rows={[
            [
              <code key="a">SAME_ORIGIN</code>,
              'same publisher key: registrable domain, or the tenant on a shared host',
              'one publisher, one voice',
            ],
            [
              <code key="b">CITES</code>,
              'the markup of one page contains the exact address of the other',
              'a page that points at its source relays it',
            ],
            [
              <code key="c">NEAR_COPY</code>,
              'at least 30 shared 6-word shingles and at least half of the smaller page’s shingles are in the larger',
              'syndication and mirrors',
            ],
            [
              <code key="d">SHARED_PASSAGE</code>,
              'both pages carry the same claim-relevant sentence of 10 to 80 words',
              'a quoted press release, a copied paragraph',
            ],
          ]}
        />
        <p>
          The partition depends on addresses and fetched text only. A prompt cannot move it, and validators
          agree on it whenever they fetch the same pages.
        </p>
        <h3>Why connected components?</h3>
        <p>
          For the common case of fan-out syndication they give the right answer, and they never overstate
          independence. The price is the bridging attack described in the{' '}
          <Link to="/docs/threat-model">threat model</Link>.
        </p>
        <h3>Reading the graph in the app</h3>
        <p>
          On an examination page, circles are sources, dashed bubbles are origins, and each edge style is one
          rule. The ring colour of a circle is that source’s stance.
        </p>
      </>
    ),
  },
  {
    slug: 'anchors',
    title: 'Anchors',
    group: 'Concepts',
    summary: 'The specifics a supporting source has to show.',
    body: () => (
      <>
        <p>
          A claim names the specifics a supporting source must show. They are checked by the contract, not
          requested from a model: an excerpt that lacks any anchor group cannot count as <code>SUPPORTS</code>
          .
        </p>
        <ul>
          <li>
            An anchor is a string, or a list of <strong>alternative spellings</strong> (any one satisfies it):{' '}
            <code>["speed of light", ["299,792,458", "299 792 458", "299792458"]]</code>.
          </li>
          <li>
            The <strong>first spelling</strong> of every anchor must occur in the statement, so an anchor is
            always a specific of <em>this</em> claim.
          </li>
          <li>
            Matching is token-aware: <code>8,848.86</code> is not found inside <code>18,848.86</code>, but is
            found in <code>8,848.86m</code>.
          </li>
          <li>
            Anchors are matched exactly: <code>1,280</code> and <code>1.280</code> stay different numbers.
          </li>
          <li>Too-generic words (“the”, “of”, a single letter) are refused.</li>
        </ul>
        <h3>What anchors change</h3>
        <ul>
          <li>
            <code>SUPPORTS</code> without the anchors is downgraded to <code>QUALIFIES</code>.
          </li>
          <li>
            <code>CONTRADICTS</code> needs an on-topic excerpt and a real sign of disagreement: a missing
            anchor, or an explicit negation (English).
          </li>
        </ul>
        <p>
          Choosing good anchors is the most important thing you do when opening a claim. Pick the numbers,
          names and dates that a careless source would get wrong.
        </p>
      </>
    ),
  },
  {
    slug: 'publishers',
    title: 'Publishers',
    group: 'Concepts',
    summary: 'How the contract decides who published a page.',
    body: () => (
      <>
        <p>
          A hostname is not a publisher. <code>www.nasa.gov</code> and <code>science.nasa.gov</code> are one
          publisher; two blogs on <code>github.io</code> are not. The origin of a page is its registrable
          domain, except on hosts that serve many unrelated tenants, where it is the tenant.
        </p>
        <p>
          This is resolved on chain, from the address alone, with no network access. Try any address on the{' '}
          <Link to="/inspect">Inspect URL</Link> page. The tables below are read live from the contract.
        </p>
        <LivePublishers />
        <h3>Address rules</h3>
        <p>
          An address must be absolute <code>https</code>, with a public DNS host. Refused: other schemes,
          whitespace, credentials, fragments, explicit ports, IP literals (including hex, octal and short
          spellings), single-label hosts, private suffixes, dot segments and encoded dots or slashes.
        </p>
        <p>
          Spellings that servers commonly serve as one page count as one source: a leading <code>www.</code>,
          letter case, trailing slashes, index documents, tracking parameters and query order.
        </p>
      </>
    ),
  },
  {
    slug: 'verdicts',
    title: 'Verdicts',
    group: 'Concepts',
    summary: 'The nine outcomes and the table that produces them.',
    body: () => (
      <>
        <p>
          The verdict is a pure function of origin counts, strictest evidence first. An origin that argues
          both sides counts on both sides, so it can only make a verdict more cautious. A clean bill needs
          zero unresolved origins.
        </p>
        <Table
          head={['Verdict', 'Meaning']}
          rows={VERDICTS.map((v) => [<VerdictChip key={v} verdict={v} />, verdictMeta(v).meaning])}
        />
        <h3>Stances of a single source</h3>
        <Table
          head={['Stance', 'Meaning']}
          rows={[
            [<code key="1">SUPPORTS</code>, 'states the claim or the very same fact, with its anchors'],
            [
              <code key="2">CONTRADICTS</code>,
              'states something that cannot be true together with the claim',
            ],
            [
              <code key="3">QUALIFIES</code>,
              'addresses the claim only partly, with different scope or hedging',
            ],
            [<code key="4">SILENT</code>, 'does not address the claim'],
            [
              <code key="5">UNVERIFIED</code>,
              'the model’s answer could not be verified against the page: counts as no evidence',
            ],
            [
              <code key="6">UNREADABLE</code>,
              'the page could not be read: counts as no evidence and blocks a clean bill',
            ],
          ]}
        />
        <div className="notice tone-warn">
          <strong>Corroboration is not truth.</strong> Independent sources can be wrong together, and
          independent publishers can share an owner.
        </div>
      </>
    ),
  },
  {
    slug: 'examination',
    title: 'How an examination works',
    group: 'Concepts',
    summary: 'Fetching, the model, excerpts and consensus.',
    body: () => (
      <>
        <ol>
          <li>
            <strong>Fetch.</strong> Each validator fetches every source itself. Expected failures
            (unreachable, 4xx, 5xx, empty) are returned as values, so validators can agree on them.
          </li>
          <li>
            <strong>Reduce.</strong> HTML becomes text in one linear pass of a hand-written scanner. Hostile
            markup cannot stall validators.
          </li>
          <li>
            <strong>Window.</strong> The model sees a bounded window per page: the sentences that bear most on
            the claim, plus their neighbours, with <code>[...]</code> where text is not shown.
          </li>
          <li>
            <strong>Judge.</strong> The model chooses a stance and quotes a passage. The contract re-verifies
            the quote on the page, word for word (punctuation, table separators and footnote marks are
            ignored; a changed word is not), and applies the anchor rules.
          </li>
          <li>
            <strong>Collapse and grade.</strong> The echo graph is built from addresses and text. Origins and
            tallies follow, then the verdict.
          </li>
        </ol>
        <h3>Equivalence rule</h3>
        <p>
          Validators repeat every fetch and the model call independently and must agree on the verdict, the
          tallies, the echo graph, the origin partition and the stance of <em>every</em> source. Free-text
          reasons and the choice of excerpt may differ. Every excerpt the leader cited must exist in the
          validator’s own copy of the page and pass the contract’s rules again.
        </p>
        <p>
          A borderline page can therefore end an examination in <code>UNDETERMINED</code>: nothing is written,
          and the app tells you so. Try again, or drop the offending page.
        </p>
        <h3>The permanent record</h3>
        <p>
          Every examination stores its own snapshot of the sources it read and a recomputable{' '}
          <strong>attestation</strong>: a digest of a canonical encoding of the result. On any examination
          page, <em>Recompute on chain</em> asks the contract to rebuild it from public state.
        </p>
      </>
    ),
  },
  {
    slug: 'contract-api',
    title: 'Contract API',
    group: 'Reference',
    summary: 'Every write and view method.',
    body: () => (
      <>
        <p>
          Contract{' '}
          <a href={explorerAddress(CONTRACT_ADDRESS)} target="_blank" rel="noreferrer" className="mono">
            {CONTRACT_ADDRESS}
          </a>{' '}
          on {CHAIN_NAME} (chain id {CHAIN_ID}). Version 1.0.0.
        </p>
        <h2 id="writes">Write methods</h2>
        <Table
          head={['Method', 'Who', 'Effect']}
          rows={[
            [
              <code key="1">open_claim(title, statement, topic, anchors_json) → claim_id</code>,
              'anyone',
              'Puts a claim on record. The same statement cannot be opened twice.',
            ],
            [
              <code key="2">add_source(claim_id, url) → source_id</code>,
              'anyone',
              'Adds a page. 6 per claim, 3 per signer, 2 per publisher. Deterministic, no network.',
            ],
            [
              <code key="3">drop_source(claim_id, source_id)</code>,
              'owner',
              'Removes a source. Logged with its last stance.',
            ],
            [
              <code key="4">examine(claim_id) → verdict</code>,
              'anyone',
              'Validators read every source. An hour apart unless the sources changed.',
            ],
            [
              <code key="5">close_claim(claim_id)</code>,
              'owner',
              'Stops changes and examinations. History stays.',
            ],
          ]}
        />
        <h2 id="views">View methods</h2>
        <Table
          head={['Method', 'Returns']}
          rows={[
            [<code key="1">contract_info()</code>, 'name, version, limits, echo rules, publisher tables'],
            [<code key="2">stats()</code>, 'counters and the tally of verdicts issued'],
            [
              <code key="3">inspect_url(url)</code>,
              'whether an address is acceptable, its origin key and document key. Never raises.',
            ],
            [<code key="4">list_claims(offset, limit)</code>, 'newest first, up to 50 summaries'],
            [
              <code key="5">get_claim_bundle(claim_id)</code>,
              'the claim and a summary of each examination, or null',
            ],
            [
              <code key="6">get_examination_bundle(exam_id)</code>,
              'the full examination with its claim, or null',
            ],
            [<code key="7">standing_of(claim_id)</code>, 'UNEXAMINED or the last conclusive verdict'],
            [
              <code key="8">flips_of(claim_id)</code>,
              'how many times a conclusive re-examination changed the verdict',
            ],
            [
              <code key="9">recompute_attestation(exam_id)</code>,
              'the attestation rebuilt from stored state',
            ],
          ]}
        />
        <h2 id="anchors-json">anchors_json</h2>
        <p>A JSON array. Each entry is a string, or a list of alternative spellings of one anchor.</p>
        <pre>
          <code>{`["speed of light", ["299,792,458", "299 792 458", "299792458"]]`}</code>
        </pre>
        <h2 id="topics">Topics</h2>
        <p>
          {['science', 'health', 'economy', 'technology', 'history', 'environment', 'society', 'other'].map(
            (t) => (
              <code key={t} style={{ marginRight: 6 }}>
                {t}
              </code>
            ),
          )}
        </p>
        <h2 id="limits">Limits</h2>
        <LiveLimits />
        <h2 id="using">Calling it yourself</h2>
        <p>
          The app uses <code>genlayer-js</code>. Reading needs no account:
        </p>
        <pre>
          <code>{`import { createClient } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';

const client = createClient({ chain: studionet });
const raw = await client.readContract({
  address: '${CONTRACT_ADDRESS}',
  functionName: 'get_claim_bundle',
  args: ['CLM-0001'],
});
const bundle = JSON.parse(String(raw));`}</code>
        </pre>
      </>
    ),
  },
  {
    slug: 'wallet',
    title: 'Wallet & network',
    group: 'Reference',
    summary: 'EIP-6963 discovery, connect, disconnect, switching.',
    body: () => (
      <>
        <h2 id="eip6963">Discovery with EIP-6963</h2>
        <p>
          The app does not read <code>window.ethereum</code>. It follows{' '}
          <a href="https://eips.ethereum.org/EIPS/eip-6963" target="_blank" rel="noreferrer">
            EIP-6963
          </a>
          : it listens for <code>eip6963:announceProvider</code> events, asks wallets to announce themselves
          with <code>eip6963:requestProvider</code>, and lists every wallet that answers, with its own name
          and icon. With several wallets installed none can hijack another’s connection, and you choose.
        </p>
        <h2 id="connect">Connecting and disconnecting</h2>
        <ul>
          <li>
            <strong>Connect</strong> calls <code>eth_requestAccounts</code> on the wallet you picked.
          </li>
          <li>
            <strong>Disconnect</strong> forgets the account in the app, stops listening to the wallet, and
            asks the wallet to revoke the site’s permission (<code>wallet_revokePermissions</code>) where it
            supports that. The app will not reconnect on its own afterwards.
          </li>
          <li>
            If you switch accounts in the wallet, the app follows. If you disconnect from the wallet itself,
            the app disconnects.
          </li>
          <li>
            A wallet you left connected is picked up again silently on your next visit (
            <code>eth_accounts</code>, no popup).
          </li>
        </ul>
        <h2 id="network">The network</h2>
        <Table
          head={['Field', 'Value']}
          rows={[
            ['Network name', CHAIN_NAME],
            ['Chain id', `${CHAIN_ID} (0xf22f)`],
            ['RPC URL', <code key="r">{RPC_URL}</code>],
            ['Currency', 'GEN (gasless on Studionet)'],
            [
              'Explorer',
              <a key="e" href={EXPLORER_URL} target="_blank" rel="noreferrer">
                {EXPLORER_URL}
              </a>,
            ],
          ]}
        />
        <p>
          When your wallet is on another chain a red banner appears with{' '}
          <strong>Switch to {CHAIN_NAME}</strong>. It calls <code>wallet_switchEthereumChain</code>, and if
          the wallet does not know the chain yet, <code>wallet_addEthereumChain</code> with the values above.
          Writing is blocked until the chain is right.
        </p>
        <h2 id="tx">Transactions</h2>
        <p>
          Writes are signed and submitted by your wallet. The app then follows the transaction on the network
          and only reports success for a transaction that was <em>decided</em> and{' '}
          <em>executed successfully</em>: a transaction can be accepted by the validators while the contract
          call itself raised an error, and the app reads the execution result to tell the difference.{' '}
          <code>ACCEPTED</code> can still be appealed; <code>FINALIZED</code> cannot change.
        </p>
      </>
    ),
  },
  {
    slug: 'threat-model',
    title: 'Threat model',
    group: 'Reference',
    summary: 'What an attacker can and cannot do.',
    body: () => (
      <>
        <Table
          head={['Attack', 'What happens', 'Residual risk']}
          rows={[
            [
              <strong key="1">Prompt injection in a page or claim</strong>,
              'Text is fenced and marked untrusted; fence markers inside it are neutralised. The model can only choose a stance and quote a passage, which the contract re-verifies. A model that obeys an injection produces unverifiable answers, which count as no evidence.',
              'A page that genuinely states the claim with all its anchors is, correctly, support.',
            ],
            [
              <strong key="2">Model names the verdict or invents tallies</strong>,
              'Ignored. The verdict is computed from findings and the echo graph, and the outcome is proven consistent before it is stored.',
              'None found.',
            ],
            [
              <strong key="3">Excerpt laundering</strong>,
              'Every excerpt is checked against its own source’s text.',
              'None found.',
            ],
            [
              <strong key="4">Syndication, mirrors, subdomains</strong>,
              'Merged into one origin by the echo graph.',
              'Copies reworded beyond the thresholds look independent.',
            ],
            [
              <strong key="5">Hidden text</strong>,
              'Scripts, styles, comments, templates and svg are not part of the text.',
              'Text hidden with CSS only is visible text to the contract.',
            ],
            [
              <strong key="6">Hostile markup</strong>,
              'Linear-time scanner; bounded raw size, scan size and shingle size.',
              'Slow servers are bounded by runtime timeouts.',
            ],
            [
              <strong key="7">Quota abuse</strong>,
              '6 sources per claim, 3 per signer, 2 per publisher.',
              'Anyone can create more signers (Sybil). The owner can drop a source, publicly.',
            ],
            [
              <strong key="8">Bridging</strong>,
              'A page that copies one relevant sentence from each of two honest pages merges all three into one voice: corroboration is understated, never overstated.',
              'A cheap way to deny a clean bill until the owner reacts.',
            ],
            [
              <strong key="9">Owner drops inconvenient sources</strong>,
              'The drop is logged with the source’s last stance; earlier examinations are immutable.',
              'Readers have to look at the history.',
            ],
            [
              <strong key="10">Flapping pages</strong>,
              'Validators disagree and nothing is written.',
              'A page can make an examination fail repeatedly; remove it.',
            ],
            [
              <strong key="11">Leader forges a finding</strong>,
              'Validators re-judge every stance with their own copy of the page.',
              'Needs a validator majority to be wrong.',
            ],
            [
              <strong key="12">Redirects</strong>,
              'The origin is judged from the submitted address.',
              'A trusted page that redirects elsewhere is attributed to the trusted publisher.',
            ],
          ]}
        />
        <h2 id="not">What the verdict does not mean</h2>
        <ul>
          <li>Independent origins are not independent authors.</li>
          <li>Agreement is not truth.</li>
          <li>
            Negation markers are English; contradictions in other languages are accepted only through a
            missing anchor.
          </li>
          <li>A verdict describes the pages at the time of the examination.</li>
        </ul>
        <h2 id="frontend">About this website</h2>
        <p>
          The site is a static client. It holds no keys and has no server: reads go to the Studionet RPC
          endpoint, writes are signed by your wallet. Page excerpts are rendered as text, never as HTML.
        </p>
      </>
    ),
  },
  {
    slug: 'testing',
    title: 'Testing & verification',
    group: 'Reference',
    summary: 'What was tested, and what the live run proved.',
    body: () => (
      <>
        <Table
          head={['Suite', 'What it covers']}
          rows={[
            [
              'Python tests',
              'pure helpers, URL and publisher rules, anchors, judging, the verdict table (exhaustively), the echo graph, window selection, outcome validation, the lifecycle, consensus and the equivalence rule, adversarial pages, models and callers, GenVM hygiene, hash-seed independence',
            ],
            [
              'Node tests',
              'receipt parsing, the report library, and the whole end-to-end script run offline against the real contract code on the GenVM simulator',
            ],
            ['Mutation testing', 'plants one bug at a time in the contract; the suite must catch each one'],
            ['genvm-lint', 'the real GenVM linter and SDK validation'],
            [
              'Frontend tests',
              'Vitest: receipt parsing, claim validation, EIP-6963 discovery, wallet connect/disconnect/switch, graph layout, pages',
            ],
          ]}
        />
        <h2 id="live">The live run</h2>
        <p>
          The deployed contract was exercised on Studionet by <code>scripts/e2e.mjs</code>. It checks the
          publisher-resolution views, a long list of refusal proofs (each passes only if the network reports a
          failure <em>and</em> the state read back is unchanged <em>and</em> the reason matches) and live
          scenarios on real pages:
        </p>
        <ul>
          <li>
            <code>light-speed</code>: three unrelated publishers state one defined constant.
          </li>
          <li>
            <code>echo-github</code>: two hosts of one GitHub account are one voice.
          </li>
          <li>
            <code>echo-wikipedia</code>: two Wikipedia language hosts are one publisher.
          </li>
          <li>
            <code>moon-wall-myth</code>: a popular myth must never be corroborated.
          </li>
          <li>
            <code>unreachable-source</code>: a 404 page must never count and must block a clean bill.
          </li>
        </ul>
        <p>
          Verdicts a scenario merely <em>hopes</em> for depend on live pages and on the validators’ language
          model, so they are reported, not enforced. The committed report is in{' '}
          <a href={`${GITHUB_URL}/tree/main/reports`} target="_blank" rel="noreferrer">
            the repository
          </a>
          .
        </p>
      </>
    ),
  },
  {
    slug: 'run-it-yourself',
    title: 'Run it yourself',
    group: 'Build',
    summary: 'Run the site locally, point it at another contract, deploy it.',
    body: () => (
      <>
        <h2 id="local">Run the site</h2>
        <pre>
          <code>{`cd frontend
npm install
cp .env.example .env     # optional: contract address and RPC
npm run dev              # http://localhost:5173
npm run check            # typecheck, lint, tests and a production build`}</code>
        </pre>
        <h2 id="env">Environment</h2>
        <Table
          head={['Variable', 'Meaning', 'Default']}
          rows={[
            [
              <code key="1">VITE_TRIANGULATE_ADDRESS</code>,
              'contract address',
              <code key="a" style={{ wordBreak: 'break-all' }}>
                {CONTRACT_ADDRESS}
              </code>,
            ],
            [
              <code key="2">VITE_GENLAYER_RPC</code>,
              'Studionet JSON-RPC endpoint',
              <code key="b">{RPC_URL}</code>,
            ],
            [
              <code key="3">VITE_BASE</code>,
              'public base path when not served from the domain root',
              <code key="c">/</code>,
            ],
          ]}
        />
        <h2 id="deploy-site">Deploy the site</h2>
        <p>
          <code>npm run build</code> writes a static site to <code>frontend/dist</code>. Serve it from any
          static host. The site uses the History API, so configure the host to fall back to{' '}
          <code>index.html</code> for unknown paths (a ready <code>404.html</code> copy is generated for
          GitHub Pages).
        </p>
        <h2 id="contract">Deploy your own contract</h2>
        <pre>
          <code>{`bash run.sh deploy      # deploys and writes artifacts/deployment.json
bash run.sh e2e         # live end-to-end run against it
bash run.sh all         # tests, lint, deploy, e2e, report`}</code>
        </pre>
        <p>
          Then set <code>VITE_TRIANGULATE_ADDRESS</code> to the new address. The full contract workflow is in
          the repository{' '}
          <a href={GITHUB_URL} target="_blank" rel="noreferrer">
            README
          </a>
          .
        </p>
      </>
    ),
  },
  {
    slug: 'faq',
    title: 'FAQ',
    group: 'Build',
    summary: 'Common questions and errors.',
    body: () => (
      <>
        <h3>Why did my examination end “undetermined”?</h3>
        <p>
          Validators must agree on the stance of every source. A borderline page, or one that serves different
          text on each request, can split them, and nothing is written. Try again, or drop that page.
        </p>
        <h3>Why was my claim refused as “already tracked”?</h3>
        <p>
          The same statement can only be opened once per deployment, so sources gather in one place. Find the
          existing claim in the list.
        </p>
        <h3>Why is a source refused?</h3>
        <p>
          Shorteners, web archives, paste sites and shared document hosts hide the publisher. Cite the
          original page. Use <Link to="/inspect">Inspect URL</Link> to see what the contract thinks of an
          address.
        </p>
        <h3>Why “echo only” when I have five sources?</h3>
        <p>
          Because they collapse into one origin: same publisher, one links to another, near copies, or the
          same sentence. The examination page shows which edges did it.
        </p>
        <h3>Why can’t I examine again?</h3>
        <p>A conclusively examined claim waits an hour unless its sources changed.</p>
        <h3>Disconnect did not remove the site from my wallet’s connected sites.</h3>
        <p>
          Not every wallet implements <code>wallet_revokePermissions</code>. The app has forgotten your
          account and will not reconnect by itself; remove the site in the wallet’s settings if you want the
          permission gone.
        </p>
        <h3>Does the site store anything about me?</h3>
        <p>
          Only your theme and the last wallet you used, in your browser’s local storage. No analytics, no
          server.
        </p>
      </>
    ),
  },
];

export const DOC_GROUPS = [...new Set(DOCS.map((d) => d.group))];
