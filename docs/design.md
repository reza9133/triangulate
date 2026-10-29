# Design notes

## The question

A claim is usually "supported" by counting sources. That count is wrong whenever sources are not independent. Triangulate makes the unit of evidence an *origin*, not a page, and makes the grouping of pages into origins something a validator can recompute from public facts.

## The echo graph

Sources are nodes. An edge means "these two are the same voice". Four kinds, all computed without a model:

| Edge | Rule | Why |
| --- | --- | --- |
| `SAME_ORIGIN` | same publisher key: registrable domain, or the tenant on a shared host | one publisher, one voice |
| `CITES` | the markup of one page contains the exact address of the other | a page that points at its source relays it |
| `NEAR_COPY` | at least 30 shared 6-word shingles and at least half of the smaller page's shingles are in the larger | syndication and mirrors |
| `SHARED_PASSAGE` | both pages carry the same sentence of 10 to 80 words that bears strongly on the claim | a quoted press release, a copied paragraph |

Origins are the connected components of this graph. The partition depends on addresses and fetched text only, which has two consequences: a prompt cannot move it, and validators agree on it whenever they fetch the same pages.

Why connected components rather than a maximum independent set: for the common case of fan-out syndication they give the right answer, and they never overstate independence. The price is the bridging attack described in the threat model.

Publisher identity is resolved by a small table inside the contract (`_TWO_LEVEL_SUFFIXES`, `_TENANT_HOSTS`, `_TENANT_SUFFIXES`, `_REFUSED_HOSTS`). Hosts that hide a publisher (URL shorteners, web archives, paste sites, shared document hosts) are refused when a source is added, so no examination is spent on a page whose publisher cannot be named.

## Anchors

A claim names the specifics a supporting source must show. They are checked by the contract, not requested from a model: an excerpt that lacks any anchor group cannot be `SUPPORTS`. The first spelling of each anchor must occur in the claim statement, so an anchor is always a specific of this claim and never a word that is easy to find on any page. Matching is token-aware (`8,848.86` is not found inside `18,848.86`, but is found in `8,848.86m`).

## Verifying excerpts

An excerpt counts only if its words occur in the page, in order, as whole words. Matching is done on a skeleton of the text in which every character that is not a letter or a digit is a space. The first live run on Studionet showed why: a model that quotes a table row, or a sentence with a footnote mark, adds or drops separators the page text does not have, and an exact-substring check voided correct answers (and made validators disagree about them). Anchors are not matched this way; they stay exact, so `1,280` and `1.280` remain different numbers where it matters.

## What the model is shown

Pages are long, so the model sees a window: the sentences that bear most on the claim, plus the neighbours of each, in page order, with a `[...]` line wherever the page continues with text that is not shown. The second live run showed why neighbours and gap markers matter. A table row is several short pieces (`speed of light in vacuum`, `c`, `299 792 458`, `m s-1`); showing only the pieces that scored left out `c`, the model quoted the two remaining pieces as one phrase, and that phrase is not on the page, so a correct answer was voided.

## Verdict

A pure function of origin counts (`_verdict_of`), strictest evidence first. An origin that argues both sides counts on both sides, so it can only make a verdict more cautious. A clean bill needs `unresolved_origins == 0`.

## Consensus

Validators repeat every fetch and the model call independently and must agree on the verdict, the tallies, the echo graph, the origin partition and the stance of every source. Reasons and the choice of excerpt may differ. Every excerpt the leader cited must exist in the validator's own copy of the page, and every stance the leader claims is re-judged under the contract's own rules against that copy.

Expected failures (unreachable page, model refusal) are returned as values so validators can agree on them; they never raise inside the non-deterministic block.

## Why a hand-written HTML scanner

The first version used regular expressions for comments, script elements and tags. A page that repeats an unclosed `<script>` or `<!--` ten thousand times makes such patterns take time proportional to the square of the page: 30 to 60 seconds in measurement, which is a denial of service on every validator. The scanner is a single linear pass, and the test suite includes pages built to hurt.

## Storage

Records are canonical JSON text in `TreeMap[str, str]`, readable from any client. Counters are `u256`. Every examination stores its own snapshot of the sources it read, so later changes to a claim can never rewrite an earlier examination.
