# Triangulate

**How many independent voices really stand behind a claim?**

Ten web pages can repeat one sentence and still be one source: a wire story is syndicated, a blog quotes the press release, a mirror copies an encyclopedia. Counting links is not counting evidence.

Triangulate is a GenLayer Intelligent Contract for Studionet. It keeps a claim on chain together with the pages offered as sources for it, makes the validators read every page, and then **collapses sources that are really the same voice before it counts anything**. It does not decide whether a claim is true. It decides how well the claim is corroborated: how many independent origins support it, how many contradict it, and how many of the pages that seem to agree are only echoes of each other.

```
open_claim   ->   add_source (x2..6)   ->   examine   ->   verdict + permanent record
 statement          anyone, quotas           validators        TRIANGULATED, CORROBORATED, ECHO_ONLY,
 + anchors          publisher resolved       read the pages    UNCONFIRMED, QUALIFIED, DOUBTED,
                    on chain, no network     and the contract  CONTESTED, REFUTED, INCONCLUSIVE
                                             grades them
```

## What makes it different

* **Independence is computed, never asserted.** Two sources are merged into one origin when they have the same publisher (registrable domain, or the tenant of a shared host such as `github.com/<owner>`), when one links to the exact address of the other, when their text is a near copy, or when they carry the same claim-relevant sentence. This echo graph depends only on addresses and fetched text, never on what a model said, so a prompt cannot steer it.
* **Support has to show the specifics.** A claim names its *anchors*: the numbers, names or dates a source must actually show. A `SUPPORTS` answer whose excerpt lacks them is downgraded to `QUALIFIES`. A `CONTRADICTS` answer needs an on-topic excerpt and a real sign of disagreement (a missing anchor or an explicit negation).
* **The model only reads.** It chooses from a fixed stance vocabulary and must back every answer with an excerpt, which the contract re-verifies against the page word for word (punctuation, table separators and footnote marks such as [1] are ignored; a changed word is not). Anchors are always matched exactly. The verdict is computed from the surviving origins by a table, never written by a model.
* **Fail closed.** An unreadable page or an unverifiable answer never counts as evidence either way, and a clean bill (`CORROBORATED`, `TRIANGULATED`) is never issued while any source is unresolved.
* **A record that remembers.** Every examination is kept as an immutable snapshot with a recomputable attestation. Verdict flips and sources that quietly changed their stance are recorded permanently. The owner may drop a source, but the drop is logged with the stance the source last had.

## Verdicts

| Verdict | Meaning |
| --- | --- |
| `TRIANGULATED` | three or more independent origins support it, none contradicts, nothing unresolved |
| `CORROBORATED` | two independent origins support it, none contradicts, nothing unresolved |
| `ECHO_ONLY` | several sources agree, but they are one voice |
| `UNCONFIRMED` | at most one independent voice supports it |
| `QUALIFIED` | the sources address it only partly, or with caveats |
| `DOUBTED` | one independent origin contradicts it and none supports it |
| `CONTESTED` | independent origins support it and independent origins contradict it |
| `REFUTED` | two or more independent origins contradict it and none supports it |
| `INCONCLUSIVE` | nothing verifiable was read, or a clean bill was blocked by an unresolved source |

## Quick start (GitHub Codespace)

Open the repository in a Codespace (the `.devcontainer` installs Node 20, Python 3.12 and the GenVM linter), then:

```bash
bash run.sh
```

That installs dependencies, runs every offline test, lints the contract with the real GenVM linter, deploys a fresh contract to Studionet, runs the live end-to-end suite and writes a report to `reports/studionet-e2e-<time>.md` and `.json`. The exit code is 1 if a hard check failed.

```bash
bash run.sh test              # offline tests only
bash run.sh deploy            # deploy and write artifacts/deployment.json
bash run.sh e2e               # live e2e against that deployment
bash run.sh all --finality    # wait for FINALIZED instead of ACCEPTED (slower, strongest)
bash run.sh all --only echo-github,light-speed
bash run.sh all --skip-refusals
```

Studionet is gasless, so throwaway keys are used unless you set `TRIANGULATE_PRIVATE_KEY` (see `.env.example`).

A fresh contract is deployed for every `bash run.sh`, because a claim statement can only be opened once per deployment. Re-running `e2e` against the same deployment skips scenarios that already exist.

## What the live run checks

1. **Publisher resolution views** - the contract's own `inspect_url` against a table of addresses (no transactions).
2. **Refusal proofs** - 23 calls the contract must refuse: duplicate claims, bad anchors, URL shorteners, web archives, `http`, localhost, IP literals, credentials, fragments, duplicate spellings of a page, per-publisher and per-signer quotas, strangers dropping or closing, closed claims, an immediate re-examination. A refusal only passes if the network reports a failure **and** the state read back afterwards is byte-for-byte unchanged **and** the reason matches.
3. **Live scenarios** (`scenarios/scenarios.json`) on real public pages:
   * `light-speed` - three unrelated publishers state one defined constant.
   * `echo-github` - `github.com/psf/requests` and `raw.githubusercontent.com/psf/requests` are one account, so they are one voice.
   * `echo-wikipedia` - `en.` and `simple.` Wikipedia are one publisher.
   * `moon-wall-myth` - a popular myth must never be corroborated.
   * `unreachable-source` - a page that answers 404 must never count, and must block a clean bill.
4. For every scenario: the echo-graph **structure** facts must hold, **forbidden verdicts** must never appear, the attestation must recompute on chain, and each excerpt recorded on chain is searched for in a page copy fetched from your machine.

Verdicts a scenario merely *hopes* for depend on live pages and on the validators' language model, so they are reported, not enforced. The scenario pages are real third-party pages that can change; a preflight step reports which ones still show the expected text before any transaction is sent. Edit `scenarios/scenarios.json` freely.

## Using the contract

```text
open_claim(title, statement, topic, anchors_json) -> claim_id
add_source(claim_id, url) -> source_id           anyone; 6 sources max, 3 per signer, 2 per publisher
drop_source(claim_id, source_id)                 owner only, logged
examine(claim_id) -> verdict                     anyone; an hour apart unless the sources changed
close_claim(claim_id)                            owner only

views: contract_info, stats, inspect_url, list_claims, get_claim_bundle,
       get_examination_bundle, standing_of, flips_of, recompute_attestation
```

`anchors_json` is a JSON array. Each entry is a string, or a list of alternative spellings of one anchor, for example:

```json
["speed of light", ["299,792,458", "299 792 458", "299792458"]]
```

The first spelling of every anchor must occur in the statement.

## Testing

| Suite | What it covers |
| --- | --- |
| 238 Python tests | pure helpers, URL and publisher rules, anchors, judging, the verdict table (exhaustively), the echo graph, window selection, outcome validation; the full lifecycle; consensus and the equivalence rule; adversarial pages, models and callers; GenVM hygiene rules; hash-seed independence |
| 22 Node tests | receipt parsing, the report library, and **the whole `scripts/e2e.mjs` flow** run offline against the *real contract code* executed on the GenVM simulator, including runs that must fail when a mutated contract stops refusing |
| 64 mutants | `python3 tests/mutation.py` plants one bug at a time in the contract; the suite must catch every one (64 of 64 are caught; two changes that cannot be observed by design are documented in the file) |
| `genvm-lint` | the real GenVM linter and SDK validation |

Hostile pages are part of the tests: unclosed `<script>` and `<!--` floods, angle-bracket soup and million-character words are processed in linear time. (Regex-based HTML stripping can take a minute on such pages; the contract uses a hand-written single-pass scanner instead.)

## Repository layout

```
contracts/triangulate.py   the Intelligent Contract
scripts/                   deploy.mjs, e2e.mjs, report and receipt helpers
scenarios/scenarios.json   live scenarios
tests/                     Python suite, simulator, mutation testing, Node tests
docs/design.md             design decisions and the reasoning behind them
docs/threat-model.md       what an attacker can and cannot do, and the known limits
run.sh                     one command for everything
```

## Honest limits

* **Origin is not authorship.** Two different publishers can still be controlled by one person. The contract separates publishers it can see; it cannot see who owns them. See `docs/threat-model.md`.
* **It reports corroboration, not truth.** Many independent sources can be wrong together.
* **Negation detection is English.** Contradictions in other languages are accepted only through a missing anchor.
* **Live consensus can be noisy.** Validators must agree on the stance of every source, so a borderline page can make a run end `UNDETERMINED`. The e2e script retries once by default (`--retries`).
* The contract was linted with the real GenVM linter and exercised on a simulator that enforces GenVM's non-deterministic-block rules, but the live network run is yours to perform: it was not possible to reach Studionet or the scenario sites from the environment this project was built in.

## Frontend

A multi-page web app for the deployed contract lives in `frontend/` (Vite, React, TypeScript, three.js). It has light, dim and dark themes, an EIP-6963 wallet picker with working connect, disconnect and network switching, a claim explorer, claim and examination pages with an echo graph, a claim form with client-side anchor validation, a publisher inspector, and full documentation.

```bash
cd frontend
npm install
npm run dev      # http://localhost:5173
npm run check    # typecheck, lint, format, tests, production build
```

The contract address and RPC endpoint are set in `frontend/.env` (see `.env.example`). Details and limits: `frontend/NOTES.md`.
