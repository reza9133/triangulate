"""Consensus behaviour: what validators must agree on, and what makes them refuse."""

import copy
import json
import unittest

from gensim import Env, NoConsensus, SimulationRuleViolation
from support import (
    ALICE, BOB, FILLER, SUPPORT_ENGINEER, SUPPORT_NEWS, SUPPORT_ROADS, URL_BLOG, URL_ENGINEER, URL_NEWS,
    URL_ROADS, URL_SOCIETY, World, answer, ideal_llm, model_reply, page, standard_web, STATEMENT, ANCHORS,
    MODULE as M,
)


def three(world):
    claim_id = world.open()
    world.add(claim_id, URL_ROADS)
    world.add(claim_id, URL_ENGINEER)
    world.add(claim_id, URL_NEWS, sender=BOB)
    return claim_id


class AgreementTests(unittest.TestCase):
    def test_unanimous_validators_settle_in_one_round(self):
        w = World()
        w.examine(three(w))
        self.assertEqual(w.last_rounds, [[True] * 5])

    def test_every_node_fetches_every_source_and_asks_the_model_once(self):
        w = World()
        w.examine(three(w))
        nodes = 1 + w.validators
        self.assertEqual(len(w.last_requests), 3 * nodes)
        self.assertEqual(len(w.last_prompts), nodes)

    def test_a_minority_of_dissenters_does_not_block_a_settlement(self):
        w = World()
        claim_id = three(w)
        flaky = standard_web()
        flaky[URL_NEWS] = (200, page('A page that now says something unrelated about weather and the harbour traffic.', FILLER['news']))
        leader = Env(w.web, ideal_llm)
        good = Env(w.web, ideal_llm)
        bad = Env(flaky, ideal_llm)
        self.assertEqual(w.examine(claim_id, validator_envs=[good, good, bad, bad]), 'TRIANGULATED')
        self.assertEqual(w.last_rounds, [[True, True, True, False, False]])

    def test_a_majority_of_dissenters_blocks_it_and_nothing_is_written(self):
        w = World()
        claim_id = three(w)
        before = w.view('get_claim_bundle', claim_id)
        flaky = standard_web()
        flaky[URL_NEWS] = (404, 'gone')
        good = Env(w.web, ideal_llm)
        bad = Env(flaky, ideal_llm)
        with self.assertRaises(NoConsensus):
            w.examine(claim_id, validator_envs=[good, bad, bad, bad])
        self.assertEqual(w.view('get_claim_bundle', claim_id), before)
        self.assertEqual(w.jview('stats')['examinations'], 0)

    def test_a_page_that_serves_a_different_document_each_time_cannot_settle(self):
        w = World()
        claim_id = three(w)
        counter = {'n': 0}

        def flapping():
            counter['n'] += 1
            if counter['n'] == 1:
                return (200, page(SUPPORT_NEWS, FILLER['news']))
            return (200, page('A completely different document number %d that says nothing about any bridge whatsoever, honest.' % counter['n'], FILLER['news']))

        web = standard_web()
        web[URL_NEWS] = flapping
        env = Env(web, ideal_llm)
        with self.assertRaises(NoConsensus):
            w.examine(claim_id, web=web, validator_envs=[env] * 4)

    def test_harmless_differences_between_nodes_do_not_matter(self):
        w = World()
        claim_id = three(w)
        noisy = standard_web()
        noisy[URL_ROADS] = (200, page('Cookie banner words. ' + SUPPORT_ROADS, FILLER['roads'], 'An advertisement appears here for a local car dealership.', title='Meridian Bridge'))
        env = Env(noisy, ideal_llm)
        good = Env(w.web, ideal_llm)
        self.assertEqual(w.examine(claim_id, validator_envs=[env, good, env, good]), 'TRIANGULATED')

    def test_a_different_excerpt_choice_is_fine_if_the_stance_agrees(self):
        w = World()
        claim_id = three(w)

        def other_choice(prompt):
            reply = ideal_llm(prompt)
            for item in reply['sources']:
                item['excerpt'] = item['excerpt'] + ' '
                item['reason'] = 'a different reason entirely'
            return reply

        env = Env(w.web, other_choice)
        self.assertEqual(w.examine(claim_id, validator_envs=[env] * 4), 'TRIANGULATED')

    def test_a_validator_that_reads_one_source_differently_dissents(self):
        w = World()
        claim_id = three(w)

        def lenient(prompt):
            reply = ideal_llm(prompt)
            reply['sources'][0]['stance'] = 'QUALIFIES'
            return reply

        good = Env(w.web, ideal_llm)
        odd = Env(w.web, lenient)
        with self.assertRaises(NoConsensus):
            w.examine(claim_id, validator_envs=[odd, odd, odd, good])
        self.assertEqual(w.examine(claim_id, validator_envs=[good, good, good, odd]), 'TRIANGULATED')
        self.assertEqual(w.last_rounds, [[True, True, True, True, False]])

    def test_validators_must_agree_when_a_source_is_unreachable(self):
        w = World()
        claim_id = three(w)
        down = standard_web()
        del down[URL_NEWS]
        w.web = down
        self.assertEqual(w.examine(claim_id), 'INCONCLUSIVE')
        self.assertEqual(w.last_rounds, [[True] * 5])

    def test_a_validator_that_cannot_reach_a_page_the_leader_read_dissents(self):
        w = World()
        claim_id = three(w)
        cut = standard_web()
        del cut[URL_SOCIETY]
        del cut[URL_NEWS]
        env = Env(cut, ideal_llm)
        good = Env(w.web, ideal_llm)
        with self.assertRaises(NoConsensus):
            w.examine(claim_id, validator_envs=[env, env, env, good])

    def test_an_exception_from_the_web_layer_is_just_an_unreadable_page(self):
        w = World()
        claim_id = three(w)
        web = {URL_ROADS: (200, page(SUPPORT_ROADS, FILLER['roads'])), URL_ENGINEER: ValueError('boom'), URL_NEWS: (200, page(SUPPORT_NEWS, FILLER['news']))}
        self.assertEqual(w.examine(claim_id, web=web, validator_envs=[Env(web, ideal_llm)] * 4), 'INCONCLUSIVE')
        flags = [f['flag'] for f in w.exam('EXM-0001')['findings']]
        self.assertEqual(flags, ['', 'UNREACHABLE', ''])

    def test_the_simulator_enforces_the_runtime_rules(self):
        # Storage may not be touched inside a non-deterministic block; if the contract did that, this run would raise.
        w = World()
        try:
            w.examine(three(w))
        except SimulationRuleViolation as error:
            self.fail(str(error))


class EquivalenceRuleTests(unittest.TestCase):
    """Drive the equivalence function directly with hand-made leader results."""

    def setUp(self):
        self.w = World()
        self.claim_id = three(self.w)
        self.w.examine(self.claim_id)
        self.claim = self.w.claim(self.claim_id)
        self.exam = self.w.exam('EXM-0001')
        self.snapshot = self.exam['sources']
        self.groups = self.claim['anchors']
        self.statement = self.claim['statement']
        self.web = self.w.web
        gl_env = Env(self.web, ideal_llm)
        from gensim import RUNTIME
        RUNTIME.reset()
        RUNTIME.env = gl_env
        RUNTIME.in_nondet = True
        try:
            self.mine, self.pages = M._examine_once(self.statement, self.groups, self.snapshot)
        finally:
            RUNTIME.in_nondet = False
        self.leader = json.loads(json.dumps(self.mine))

    def equivalent(self, theirs):
        return M._examination_equivalent(theirs, self.mine, self.pages, self.statement, self.groups, self.snapshot)

    def test_identical_outcomes_are_equivalent(self):
        self.assertTrue(self.equivalent(self.leader))

    def test_free_text_may_differ(self):
        theirs = copy.deepcopy(self.leader)
        for finding in theirs['findings']:
            finding['reason'] = 'something else'
        self.assertTrue(self.equivalent(theirs))

    def test_a_different_verdict_is_not_equivalent(self):
        theirs = copy.deepcopy(self.leader)
        theirs['verdict'] = 'CORROBORATED'
        self.assertFalse(self.equivalent(theirs))

    def test_a_different_stance_is_not_equivalent_even_with_the_same_verdict(self):
        theirs = copy.deepcopy(self.leader)
        mine = copy.deepcopy(self.mine)
        mine['findings'][0]['stance'] = 'QUALIFIES'
        self.assertFalse(M._examination_equivalent(theirs, mine, self.pages, self.statement, self.groups, self.snapshot))

    def test_a_forged_excerpt_is_not_equivalent(self):
        theirs = copy.deepcopy(self.leader)
        theirs['findings'][0]['excerpt'] = 'The Meridian Bridge opened to traffic in 1964 and spans 1,280 metres, so say the validators.'
        self.assertFalse(self.equivalent(theirs))

    def test_support_without_the_anchors_is_not_equivalent(self):
        theirs = copy.deepcopy(self.leader)
        page_text = self.pages['S1']
        partial = 'meridian bridge opened in 1964'
        self.assertIn(partial, page_text)
        theirs['findings'][0]['excerpt'] = partial
        self.assertFalse(self.equivalent(theirs))

    def test_a_contradiction_without_a_signal_is_not_equivalent(self):
        theirs = copy.deepcopy(self.leader)
        mine = copy.deepcopy(self.mine)
        theirs['findings'][0]['stance'] = 'CONTRADICTS'
        mine['findings'][0]['stance'] = 'CONTRADICTS'
        theirs['tallies'] = mine['tallies'] = None
        self.assertFalse(M._examination_equivalent(theirs, mine, self.pages, self.statement, self.groups, self.snapshot))

    def test_an_internally_inconsistent_leader_is_not_equivalent(self):
        for tamper in (
            lambda o: o['tallies'].update(support_origins=1),
            lambda o: o['origins'].reverse(),
            lambda o: o['edges'].append({'a': 'S1', 'b': 'S2', 'kind': 'NEAR_COPY'}),
            lambda o: o['findings'].pop(),
            lambda o: o.update(ok=False),
        ):
            theirs = copy.deepcopy(self.leader)
            tamper(theirs)
            self.assertFalse(self.equivalent(theirs))

    def test_non_dict_results_are_not_equivalent(self):
        for value in (None, 'x', 5, [], [self.leader]):
            self.assertFalse(self.equivalent(value))
        self.assertFalse(M._examination_equivalent(self.leader, None, self.pages, self.statement, self.groups, self.snapshot))

    def test_a_validator_that_failed_is_never_equivalent(self):
        mine = copy.deepcopy(self.mine)
        mine['ok'] = False
        self.assertFalse(M._examination_equivalent(self.leader, mine, self.pages, self.statement, self.groups, self.snapshot))

    def test_an_excerpt_missing_from_the_validators_copy_is_not_equivalent(self):
        pages = dict(self.pages)
        pages['S1'] = M._verify_text('a page that no longer carries the passage the leader quoted at all, sorry about that.')
        self.assertFalse(M._examination_equivalent(self.leader, self.mine, pages, self.statement, self.groups, self.snapshot))


def regrade(outcome):
    """Recompute origins, tallies and verdict of a hand-edited outcome so that it stays self-consistent."""
    ids = [f['source_id'] for f in outcome['findings']]
    graded = M._grade(outcome['findings'], M._components(ids, outcome['edges']))
    outcome['origins'], outcome['tallies'], outcome['verdict'] = graded['origins'], graded['tallies'], graded['verdict']
    return outcome


class SubtleDisagreementTests(unittest.TestCase):
    """Outcomes that look alike in the headline numbers but are different findings."""

    def setUp(self):
        self.snapshot = [
            {'source_id': 'S%d' % n, 'url': 'https://p%d.example/x' % n, 'source_key': 'p%d.example/x' % n, 'origin_key': 'p%d.example' % n}
            for n in (1, 2, 3)
        ]
        self.findings = [M._finding(item, 'SILENT', '', '', '') for item in self.snapshot]
        self.pages = {sid: M._verify_text('some page text') for sid in ('S1', 'S2', 'S3')}

    def outcome(self, edges, findings=None):
        out = {'ok': True, 'edges': sorted(edges, key=M._edge_order), 'findings': json.loads(json.dumps(findings or self.findings))}
        return json.loads(json.dumps(regrade(out)))

    def equivalent(self, theirs, mine):
        return M._examination_equivalent(theirs, mine, self.pages, 'The Meridian Bridge spans 1,280 metres.', [['Meridian Bridge']], self.snapshot)

    def test_the_same_number_of_origins_with_a_different_partition_is_not_equivalent(self):
        theirs = self.outcome([M._edge('S1', 'S2', 'NEAR_COPY')])
        mine = self.outcome([M._edge('S2', 'S3', 'NEAR_COPY')])
        self.assertEqual(theirs['tallies'], mine['tallies'])
        self.assertFalse(self.equivalent(theirs, mine))
        self.assertTrue(self.equivalent(theirs, copy.deepcopy(theirs)))

    def test_the_same_partition_through_a_different_kind_of_evidence_is_not_equivalent(self):
        theirs = self.outcome([M._edge('S1', 'S2', 'NEAR_COPY')])
        mine = self.outcome([M._edge('S1', 'S2', 'SHARED_PASSAGE')])
        self.assertEqual(theirs['origins'], mine['origins'])
        self.assertFalse(self.equivalent(theirs, mine))

    def test_an_excerpt_the_leader_attached_to_a_non_evidence_finding_must_exist_too(self):
        forged = copy.deepcopy(self.findings)
        forged[0] = M._finding(self.snapshot[0], 'UNVERIFIED', 'text that is nowhere on any page at all, forged', '', 'excerpt_unrelated_to_claim')
        theirs = self.outcome([], forged)
        honest = copy.deepcopy(forged)
        honest[0] = M._finding(self.snapshot[0], 'UNVERIFIED', 'some page text', '', 'excerpt_unrelated_to_claim')
        mine = self.outcome([], honest)
        self.assertEqual(theirs['tallies'], mine['tallies'])
        self.assertFalse(self.equivalent(theirs, mine))
        self.assertTrue(self.equivalent(mine, copy.deepcopy(mine)))


class DiagnosticsTests(unittest.TestCase):
    def test_diagnostics_do_not_affect_agreement_or_the_attestation(self):
        w = World()
        claim_id = three(w)
        def quotes_wrongly(prompt):
            reply = ideal_llm(prompt)
            reply['sources'][0]['excerpt'] = 'a quotation that is not on the page at all, said the model'
            return reply

        env_a = Env(w.web, quotes_wrongly)
        w.examine(claim_id, llm=quotes_wrongly, validator_envs=[env_a] * 4)
        exam = w.exam('EXM-0001')
        first = exam['findings'][0]
        self.assertEqual(first['stance'], 'UNVERIFIED')
        self.assertIn('a quotation that is not on the page', first['claimed'])
        self.assertIn('meridian bridge', first['seen'])
        self.assertEqual(w.view('recompute_attestation', 'EXM-0001'), exam['attestation'])
        stored = json.loads(w.contract.exams['EXM-0001'])
        stored['findings'][0]['claimed'] = 'edited afterwards'
        w.contract.exams['EXM-0001'] = json.dumps(stored)
        self.assertEqual(w.view('recompute_attestation', 'EXM-0001'), exam['attestation'])


if __name__ == '__main__':
    unittest.main()
