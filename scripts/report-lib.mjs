// Pure helpers for the end-to-end report: client-side page checks, scenario expectations and
// markdown rendering. No network and no genlayer-js here, so tests/node can exercise all of it.

const PUNCTUATION = [
  [/[\u2018\u2019]/g, "'"],
  [/[\u201c\u201d]/g, '"'],
  [/[\u2010\u2011\u2013\u2014\u2212]/g, '-'],
  [/[\u00a0\u2009\u202f]/g, ' '],
];

/** The same comparison normalisation the contract applies (_norm): fold quotes, dashes, spaces and case. */
export function normText(text) {
  let value = String(text ?? '');
  for (const [pattern, replacement] of PUNCTUATION) value = value.replace(pattern, replacement);
  return value.split(/\s+/).filter((part) => part.length > 0).join(' ').toLowerCase();
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-', lsquo: "'", rsquo: "'", ldquo: '"', rdquo: '"', hellip: '...', minus: '-' };

const SKIPPED = new Set(['script', 'style', 'noscript', 'template', 'svg']);
const BLOCKS = new Set(['p', 'div', 'br', 'hr', 'li', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr', 'td', 'th', 'table', 'section', 'article', 'header', 'footer', 'main', 'nav', 'aside', 'blockquote', 'figure', 'figcaption', 'dt', 'dd', 'dl', 'pre', 'title', 'body', 'html', 'head']);
const TAG_TAIL = /[a-zA-Z/!][^<>]*>/y;
const TAG_NAME = /\/?([a-zA-Z][a-zA-Z0-9]*)/y;

/**
 * HTML to text for the client-side checks, in one linear pass (the same scanner the contract uses, so a
 * hostile page cannot stall this script either). Comments and script, style, noscript, template and svg
 * elements are dropped; block tags separate words; inline tags vanish without a space.
 */
export function htmlToText(raw) {
  const source = String(raw ?? '');
  const lowered = source.toLowerCase();
  const parts = [];
  let position = 0;
  while (position < source.length) {
    const start = source.indexOf('<', position);
    if (start === -1) {
      parts.push(source.slice(position));
      break;
    }
    parts.push(source.slice(position, start));
    if (source.startsWith('<!--', start)) {
      const end = source.indexOf('-->', start + 4);
      parts.push(' ');
      if (end === -1) break;
      position = end + 3;
      continue;
    }
    TAG_TAIL.lastIndex = start + 1;
    const tail = TAG_TAIL.exec(source);
    if (!tail) {
      parts.push('<');
      position = start + 1;
      continue;
    }
    const tagEnd = TAG_TAIL.lastIndex;
    TAG_NAME.lastIndex = start + 1;
    const named = TAG_NAME.exec(source);
    const name = named ? named[1].toLowerCase() : '';
    const closing = source.startsWith('</', start);
    if (SKIPPED.has(name) && !closing) {
      const close = lowered.indexOf('</' + name, tagEnd);
      parts.push(' ');
      if (close === -1) break;
      const after = source.indexOf('>', close);
      if (after === -1) break;
      position = after + 1;
      continue;
    }
    if (BLOCKS.has(name)) parts.push(' ');
    position = tagEnd;
  }
  const text = parts.join('').replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (_all, token) => {
    if (token[0] === '#') {
      const code = token[1] === 'x' || token[1] === 'X' ? parseInt(token.slice(2), 16) : parseInt(token.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : ' ';
    }
    return ENTITIES[token.toLowerCase()] ?? ' ';
  });
  return text.split(/\s+/).filter((part) => part.length > 0).join(' ');
}

/** Whether any of the alternative strings occurs in the page text (normalised). Null when nothing is expected. */
export function hasAnyText(pageText, alternatives) {
  if (!Array.isArray(alternatives) || alternatives.length === 0) return null;
  const haystack = normText(pageText);
  return alternatives.some((item) => haystack.includes(normText(item)));
}

/** Letters and digits only, every other run of characters a single space, padded. Mirrors the contract's _verify_text. */
const FOOTNOTE = /\[(?:\d{1,3}|[a-zA-Z]|note \d{1,3}|nb \d{1,3}|citation needed)\]/gi;

export function verifyText(text) {
  return ` ${normText(String(text ?? '').replace(FOOTNOTE, ' ')).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
}

/** Whether the words of an excerpt recorded on chain occur, in order and as whole words, in a page's text. */
export function excerptOnPage(excerpt, pageText) {
  const needle = verifyText(excerpt).trim();
  return needle.length >= 12 && verifyText(pageText).includes(` ${needle} `);
}

/** Facts about the echo graph that depend only on addresses, compared with what the chain recorded. */
export function checkStructure(expected, tallies) {
  const failures = [];
  for (const [key, value] of Object.entries(expected ?? {})) {
    if (tallies?.[key] !== value) failures.push(`${key}: expected ${value}, chain recorded ${tallies?.[key]}`);
  }
  return failures;
}

/** Verdict expectations: 'forbidden' is a hard failure, 'hoped' is only reported. */
export function judgeVerdict(scenario, verdict) {
  const forbidden = Array.isArray(scenario.expect_not) && scenario.expect_not.includes(verdict);
  const hopedSet = scenario.expect_any ?? (scenario.expect ? [scenario.expect] : []);
  const hoped = hopedSet.length === 0 ? null : hopedSet.includes(verdict);
  return { forbidden, hoped };
}

function cell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function table(headers, rows) {
  const lines = [`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`];
  for (const row of rows) lines.push(`| ${row.map(cell).join(' | ')} |`);
  return lines.join('\n');
}

function short(hash) {
  return hash ? `${hash.slice(0, 10)}...${hash.slice(-6)}` : '-';
}

/** Render the whole report as markdown. `run` is the plain-data record the e2e script builds. */
export function renderReport(run) {
  const out = [];
  out.push(`# Triangulate - live Studionet end-to-end report`);
  out.push('');
  out.push(`- Generated: ${run.startedAt} (took ${Math.round(run.durationMs / 1000)}s)`);
  out.push(`- Network: Studionet (chain ${run.chainId}), RPC ${run.rpc}`);
  out.push(`- Contract: \`${run.address}\` (${run.info.name} ${run.info.version}, runner \`${run.info.runner}\`)`);
  out.push(`- Source SHA-256: \`${run.sourceSha256}\``);
  out.push(`- Signers: ${run.signers.map((item, index) => `#${index} \`${item}\``).join(', ')}`);
  out.push(`- Finality waited for: ${run.waitedForFinality ? 'yes (FINALIZED)' : 'no (ACCEPTED is enough; pass --finality to wait)'}`);
  out.push('');
  out.push(`## Result: ${run.passed ? 'PASSED' : 'FAILED'}`);
  out.push('');
  out.push(table(['Check', 'Result'], run.summary.map((item) => [item.name, item.result])));
  out.push('');
  if (run.hardFailures.length > 0) {
    out.push('### Hard failures');
    out.push('');
    for (const failure of run.hardFailures) out.push(`- ${failure}`);
    out.push('');
  }
  if (run.warnings.length > 0) {
    out.push('### Warnings (not failures)');
    out.push('');
    for (const warning of run.warnings) out.push(`- ${warning}`);
    out.push('');
  }

  out.push('## How to read this report');
  out.push('');
  out.push('- **Refusal checks** prove the contract rejects bad input. A refusal passes only when the network decided the call failed (or could not run it) AND the contract state read back afterwards is byte-for-byte unchanged.');
  out.push('- **Structure** checks are facts about the echo graph that follow from addresses alone (for example two hosts of one GitHub account are one origin). They must hold.');
  out.push('- **Forbidden verdicts** must never be issued (for example a clean bill for a known myth, or while a source is unreadable). Breaking one fails the run.');
  out.push('- **Hoped verdicts** depend on live pages and on the validators\' language model. They are reported, never enforced.');
  out.push('- Every excerpt recorded on chain was also searched for in a page copy fetched by this script. A miss is a warning: the validators may have been served a different copy.');
  out.push('');

  out.push('## Refusal checks');
  out.push('');
  out.push(table(['#', 'Check', 'Network said', 'State unchanged', 'Message', 'Result'], run.negatives.map((item, index) => [index + 1, item.label, item.execution, item.stateUnchanged ? 'yes' : 'NO', item.message || '-', item.pass ? 'PASS' : 'FAIL'])));
  out.push('');

  for (const scenario of run.scenarios) {
    out.push(`## Scenario: ${scenario.title} (\`${scenario.id}\`)`);
    out.push('');
    out.push(`> ${scenario.statement}`);
    out.push('');
    out.push(`${scenario.why}`);
    out.push('');
    out.push(`- Claim: \`${scenario.claimId}\`, examination \`${scenario.examId ?? '-'}\``);
    out.push(`- Verdict: **${scenario.verdict ?? 'n/a'}** (hoped ${JSON.stringify(scenario.hopedSet)}; ${scenario.hoped === null ? 'no expectation' : scenario.hoped ? 'matches' : 'differs'}${scenario.forbidden ? '; FORBIDDEN VERDICT' : ''})`);
    if (scenario.tallies) {
      out.push(`- Tallies: ${Object.entries(scenario.tallies).map(([key, value]) => `${key}=${value}`).join(', ')}`);
    }
    out.push(`- Structure: ${scenario.structureFailures.length === 0 ? 'as expected' : 'MISMATCH - ' + scenario.structureFailures.join('; ')}`);
    out.push(`- Attestation: ${scenario.attestation ? `\`${scenario.attestation}\`` : '-'} (recomputed by the contract: ${scenario.attestationMatches === null ? 'n/a' : scenario.attestationMatches ? 'matches' : 'MISMATCH'})`);
    out.push('');
    out.push('Sources and what the validators concluded:');
    out.push('');
    out.push(
      table(
        ['Source', 'Publisher (origin)', 'Preflight', 'Stance', 'Flag', 'Excerpt found on client copy'],
        scenario.sources.map((item) => [item.sourceId ?? '-', `${item.origin ?? '-'}`, item.preflight, item.stance ?? '-', item.flag || '-', item.excerptCheck]),
      ),
    );
    out.push('');
    out.push(table(['Source', 'URL'], scenario.sources.map((item) => [item.sourceId ?? '-', item.url])));
    out.push('');
    if (scenario.origins && scenario.origins.length > 0) {
      out.push('Origins after echo collapsing:');
      out.push('');
      out.push(table(['Origin', 'Sources', 'Stance'], scenario.origins.map((item) => [item.origin_id, item.sources.join(', '), item.stance])));
      out.push('');
    }
    if (scenario.edges && scenario.edges.length > 0) {
      out.push('Echo edges:');
      out.push('');
      out.push(table(['From', 'To', 'Kind'], scenario.edges.map((item) => [item.a, item.b, item.kind])));
      out.push('');
    }
    const excerpts = (scenario.findings ?? []).filter((item) => item.excerpt);
    if (excerpts.length > 0) {
      out.push('Excerpts recorded on chain:');
      out.push('');
      for (const item of excerpts) out.push(`- ${item.source_id} (${item.stance}): "${item.excerpt}"`);
      out.push('');
    }
    const unverified = (scenario.findings ?? []).filter((item) => item.claimed || item.seen);
    if (unverified.length > 0) {
      out.push('Answers that could not be verified (what the model quoted, and what the validator saw near the first anchor):');
      out.push('');
      for (const item of unverified) out.push(`- ${item.source_id} [${item.flag}]: model quoted "${item.claimed}" / validator saw "${item.seen}"`);
      out.push('');
    }
  }

  out.push('## Transactions');
  out.push('');
  out.push(table(['#', 'Step', 'Hash', 'Decision', 'Execution', 'Finality', 'Seconds'], run.transactions.map((item, index) => [index + 1, item.label, short(item.hash), item.statusName, item.execution, item.finality ?? '-', item.seconds])));
  out.push('');
  out.push('Full hashes:');
  out.push('');
  for (const item of run.transactions) if (item.hash) out.push(`- ${item.label}: \`${item.hash}\``);
  out.push('');
  out.push('## Contract statistics');
  out.push('');
  out.push('```json');
  out.push(JSON.stringify({ before: run.statsBefore, after: run.statsAfter }, null, 2));
  out.push('```');
  out.push('');
  return out.join('\n');
}
