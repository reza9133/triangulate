# Threat model

| Attack | What happens | Residual risk |
| --- | --- | --- |
| **Prompt injection in a page or claim** | Text is fenced and marked untrusted, fence markers inside it are neutralised. The model can only choose a stance and quote a passage; the contract re-verifies the quote on the page and applies the anchor rules. A model that obeys the injection produces unverifiable answers, which count as no evidence. | A page that genuinely states the claim with all its anchors is, correctly, support. |
| **Model names the verdict or invents tallies** | Ignored. The verdict is computed from findings and the echo graph, and `_validate_outcome` proves that origins, tallies and verdict follow from the recorded findings. | None found. |
| **Excerpt laundering** (quote taken from another source) | Every excerpt is checked against its own source's text. | None found. |
| **Syndication, mirrors, subdomains, one owner on several hosts** | Merged into one origin by the echo graph. | Copies that are reworded beyond the thresholds are seen as independent. |
| **Hidden text** (scripts, styles, comments, templates, svg) | Not part of the text excerpts are checked against. | Text hidden with CSS only is visible text to the contract. |
| **Hostile markup built to stall validators** | Linear-time scanner; bounded raw size, scan size and shingle size. | Slow servers are bounded by the runtime's own timeouts. |
| **Quota abuse** | 6 sources per claim, 3 per signer, 2 per publisher. | Anyone can create more signers (Sybil). The owner can drop a source, publicly. |
| **Bridging**: a page that copies one relevant sentence from each of two honest pages merges all three into one voice | Corroboration is understated, never overstated. The echo edges are recorded in the examination, and the owner can drop the bridge. | A cheap way to deny a clean bill until the owner reacts. A maximum-independent-set rule would resist it but would overstate independence for partial copies of one original. |
| **Owner drops inconvenient sources** | The drop is logged with the source's last stance, earlier examinations are immutable, and the verdict history keeps every verdict. | Readers have to look at the history. |
| **Flapping pages** (a different document on every request) | Validators disagree and nothing is written. | A page can make an examination fail repeatedly; remove it. |
| **Leader forges a finding** | Validators re-judge every stance with their own copy of the page and compare the whole outcome. | Needs a validator majority to be wrong. |
| **Redirects** | The origin is judged from the submitted address; the fetch layer follows redirects. | A page on a trusted publisher that redirects elsewhere is attributed to the trusted publisher. Two such pages with the same content are still merged by `NEAR_COPY`. |

## What the verdict does not mean

* **Independent origins are not independent authors.** Two publishers owned by one person are two origins.
* **Agreement is not truth.** Independent sources can be wrong together.
* **Language.** Negation markers are English. Contradictions in other languages are accepted only through a missing anchor.
* **Pages change.** A verdict describes the pages at the time of the examination. Re-examine to watch them; the history records every change.
