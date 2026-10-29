"""
Mutation testing: plant one deliberate bug at a time in a copy of the contract and check that the
test suite notices. A mutant that survives is a hole in the tests.

Usage:  python3 tests/mutation.py [name-fragment]
"""

import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTRACT = ROOT / 'contracts' / 'triangulate.py'

# Planted changes that cannot be observed, by design, so they are not counted:
#   * dropping the verdict comparison in the validator: the verdict is a pure function of the
#     tallies, which are compared, and _validate_outcome proves that function holds;
#   * dropping the isinstance(Return) guard: a crashed leader has no .calldata, so the next line
#     fails and the validator still votes False.
# Both checks stay in the contract as defence in depth.
MUTANTS = [
    ('support accepted without anchors', "if _groups_present(groups, excerpt):\n            return _finding(source, STANCE_SUPPORTS", "if True:\n            return _finding(source, STANCE_SUPPORTS"),
    ('contradiction needs no signal', "if _groups_present(groups, excerpt) and not _has_negation(excerpt):", "if False:"),
    ('contradiction may be loosely related', "    if shared < 2:\n        return _finding(source, STANCE_UNVERIFIED, excerpt, reason, 'excerpt_too_loosely_related')", "    if shared < 0:\n        return _finding(source, STANCE_UNVERIFIED, excerpt, reason, 'excerpt_too_loosely_related')"),
    ('unrelated excerpt accepted', "    if shared == 0:\n        return _finding(source, STANCE_UNVERIFIED, excerpt, reason, 'excerpt_unrelated_to_claim')", "    if shared < 0:\n        return _finding(source, STANCE_UNVERIFIED, excerpt, reason, 'excerpt_unrelated_to_claim')"),
    ('excerpt not verified', "return len(cleaned) >= MIN_EXCERPT_CHARS and (' ' + cleaned + ' ') in verify_text", "return True"),
    ('short excerpt accepted', "return len(cleaned) >= MIN_EXCERPT_CHARS and (' ' + cleaned + ' ') in verify_text", "return (' ' + cleaned + ' ') in verify_text"),
    ('excerpt may start or stop inside a word', "return len(cleaned) >= MIN_EXCERPT_CHARS and (' ' + cleaned + ' ') in verify_text", "return len(cleaned) >= MIN_EXCERPT_CHARS and cleaned in verify_text"),
    ('clean bill despite unresolved', "        if tallies['unresolved_origins'] > 0:\n            return VERDICT_INCONCLUSIVE", "        if False:\n            return VERDICT_INCONCLUSIVE"),
    ('triangulated at two', "return VERDICT_TRIANGULATED if support >= 3 else VERDICT_CORROBORATED", "return VERDICT_TRIANGULATED if support >= 2 else VERDICT_CORROBORATED"),
    ('same origin not merged', "            if first['origin_key'] == second['origin_key']:\n                edges.append(_edge(a, b, EDGE_SAME_ORIGIN))", "            if False:\n                edges.append(_edge(a, b, EDGE_SAME_ORIGIN))"),
    ('citation not merged', "            if second['source_key'] in page_a['cited']:", "            if False:"),
    ('citation one direction only', "            if first['source_key'] in page_b['cited']:", "            if False:"),
    ('near copies never detected', "NEAR_COPY_PERMILLE = 500", "NEAR_COPY_PERMILLE = 1001"),
    ('near copy threshold too low', "NEAR_COPY_PERMILLE = 500", "NEAR_COPY_PERMILLE = 5"),
    ('boilerplate counts as echo', "SHARED_PASSAGE_MIN_SCORE = 3", "SHARED_PASSAGE_MIN_SCORE = 0"),
    ('shared passage never detected', "            if len(page_a['passages'] & page_b['passages']) > 0:", "            if False:"),
    ('conflicted origin counts once', "    support = tallies['support_origins'] + tallies['conflicted_origins']", "    support = tallies['support_origins']"),
    ('cooldown ignored', "            and now - int(record['last_conclusive_at']) < REEXAMINE_COOLDOWN_SECONDS", "            and False"),
    ('stranger may drop sources', "        if _hex_of(gl.message.sender_address) != record['owner']:\n            _fail('only the owner may drop a source')", "        if False:\n            _fail('only the owner may drop a source')"),
    ('stranger may close claims', "        if _hex_of(gl.message.sender_address) != record['owner']:\n            _fail('only the owner may close this claim')", "        if False:\n            _fail('only the owner may close this claim')"),
    ('no per-adder quota', "if sum(1 for item in sources if item['added_by'] == sender) >= MAX_SOURCES_PER_ADDER:", "if False:"),
    ('no per-publisher quota', "if sum(1 for item in sources if item['origin_key'] == origin) >= MAX_SOURCES_PER_ORIGIN:", "if False:"),
    ('no total quota', "        if len(sources) >= MAX_SOURCES:\n            _fail('this claim already has the maximum number of sources')", "        if False:\n            _fail('this claim already has the maximum number of sources')"),
    ('duplicate sources allowed', "if any(item['source_key'] == key for item in sources):", "if False:"),
    ('hidden publishers allowed', "    if refusal != '':\n        _fail('source is on '", "    if False:\n        _fail('source is on '"),
    ('prompt fence not sanitised', "    while '===' in text:", "    while False:"),
    ('origins not cross-checked', "        outcome.get('origins') != graded['origins']\n", "        False\n"),
    ('tallies not cross-checked', "        or outcome.get('tallies') != graded['tallies']\n", "        or False\n"),
    ('verdict not cross-checked', "        or outcome.get('verdict') != graded['verdict']\n", "        or False\n"),
    ('publisher edges not cross-checked', "    if expected_same != recorded_same:", "    if False:"),
    ('validators ignore stance', "own.get('stance') != finding['stance']", "False"),
    ('validators ignore the echo graph', "if checked['edges'] != mine.get('edges') or checked['origins'] != mine.get('origins'):", "if False:"),
    ('validators skip excerpt lookup', "if page_verify is None or not _on_page(finding['excerpt'], page_verify):", "if False:"),
    ('validators skip the replay', "            if replay['stance'] != finding['stance']:", "            if False:"),
    ('unreadable counted as silent', "findings.append(_finding(source, STANCE_UNREADABLE, '', '', reasons.get(source_id, REASON_UNREACHABLE)))", "findings.append(_finding(source, STANCE_SILENT, '', '', reasons.get(source_id, REASON_UNREACHABLE)))"),
    ('model failure ignored', "        except Exception:\n            model_failed = True", "        except Exception:\n            model_failed = False"),
    ('drift never recorded', "            if was != '' and was != now_stance:", "            if False:"),
    ('flips never counted', "            if record['standing'] != STANDING_UNEXAMINED and record['standing'] != verdict:", "            if False:"),
    ('claim stays dirty', "            record['dirty'] = False", "            record['dirty'] = True"),
    ('inconclusive counts as conclusive', "        conclusive = verdict != VERDICT_INCONCLUSIVE", "        conclusive = True"),
    ('duplicate claims allowed', "        if existing != '':\n            _fail('this claim is already tracked as '", "        if False:\n            _fail('this claim is already tracked as '"),
    ('anchors need not be in the statement', "        if not _has_term(statement_norm, first):", "        if False:"),
    ('token boundaries ignored', "        if not left_clash and not right_clash:", "        if True:"),
    ('scripts are visible text', "        if name in _SKIPPED_ELEMENTS and not closing:", "        if False:"),
    ('one source may be examined', "MIN_SOURCES_TO_EXAMINE = 2", "MIN_SOURCES_TO_EXAMINE = 1"),
    ('two-level suffixes ignored', "    if len(labels) >= 3 and '.'.join(labels[-2:]) in _TWO_LEVEL_SUFFIXES:", "    if False:"),
    ('path tenants ignored', "        return family + ':' + '/'.join(segment.casefold() for segment in segments[:depth])", "        return host"),
    ('echo-only rule removed', "    if support == 1 and tallies['support_sources'] >= 2:", "    if False:"),
    ('qualified rule removed', "    if qualify >= 1 and qualify >= support and support + qualify >= 2:", "    if False:"),
    ('empty pages are readable', "    if len(' '.join(blocks)) < MIN_TEXT_CHARS:", "    if False:"),
    ('server errors are readable', "        if status >= 500:\n            return {'ok': False, 'reason': REASON_HTTP_5XX}", "        if False:\n            return {'ok': False, 'reason': REASON_HTTP_5XX}"),
    ('attestation ignores the verdict', "            'verdict': exam['verdict'],\n            'tallies': exam['tallies'],\n            'sources'", "            'tallies': exam['tallies'],\n            'sources'"),
    ('attestation ignores the echo graph', "            'edges': exam['edges'],\n            'findings'", "            'findings'"),
    ('attestation ignores the claim', "            'claim_commitment': claim['commitment'],\n", ""),
    ('dropped sources are not logged', "        record['dropped'] = (record['dropped'] + [entry])[-MAX_DROPPED_LOG:]", "        record['dropped'] = record['dropped']"),
    ('closed claims can be examined', "        record = self._load_claim(claim_id)\n        if record['status'] != CLAIM_OPEN:\n            _fail('claim is closed')\n        sources = record['sources']\n        if len(sources) < MIN_SOURCES_TO_EXAMINE:", "        record = self._load_claim(claim_id)\n        sources = record['sources']\n        if len(sources) < MIN_SOURCES_TO_EXAMINE:"),
    ('examination history unbounded', "        if len(record['exam_ids']) >= MAX_EXAMS_PER_CLAIM:", "        if False:"),
    ('url credentials allowed', "    if '@' in host:\n        _fail(label + ' must not contain credentials')", "    if False:\n        _fail(label + ' must not contain credentials')"),
    ('ip literals allowed', "_NUMERIC_LABEL_RE.match(host.rsplit('.', 1)[-1]) is not None:", "False:"),
    ('statement stems not required', "        if len(_stems(statement_clean)) < 3:", "        if False:"),
    ('window drops neighbours', "            for near in (index - 1, index + 1):", "            for near in ():"),
    ('window has no gap marker', "            if previous != -2 and index != previous + 1:", "            if False:"),
    ('footnote marks not stripped', "_norm(_FOOTNOTE_RE.sub(' ', text))", "_norm(text)"),
    ('window ignores relevance', "        scored.sort()\n", "        scored.sort(key=lambda item: item[1])\n"),
]


def run_suite(contract_path: Path) -> bool:
    env = dict(os.environ, TRIANGULATE_CONTRACT=str(contract_path))
    result = subprocess.run(
        [sys.executable, '-m', 'unittest', 'discover', '-s', 'tests', '-t', 'tests', '-f'],
        cwd=str(ROOT), env=env, capture_output=True, text=True,
    )
    return result.returncode == 0


def main() -> int:
    fragment = sys.argv[1].lower() if len(sys.argv) > 1 else ''
    source = CONTRACT.read_text(encoding='utf-8')
    survivors = []
    broken = []
    checked = 0
    with tempfile.TemporaryDirectory() as tmp:
        for name, old, new in MUTANTS:
            if fragment and fragment not in name.lower():
                continue
            if source.count(old) != 1:
                broken.append((name, source.count(old)))
                continue
            path = Path(tmp) / 'mutant.py'
            path.write_text(source.replace(old, new, 1), encoding='utf-8')
            killed = not run_suite(path)
            checked += 1
            print(('KILLED   ' if killed else 'SURVIVED ') + name, flush=True)
            if not killed:
                survivors.append(name)
    print()
    print('mutants checked: %d, killed: %d, survived: %d, unusable: %d' % (checked, checked - len(survivors), len(survivors), len(broken)))
    for name, count in broken:
        print('  unusable (pattern found %d times): %s' % (count, name))
    for name in survivors:
        print('  SURVIVOR: ' + name)
    return 1 if survivors or broken else 0


if __name__ == '__main__':
    sys.exit(main())
