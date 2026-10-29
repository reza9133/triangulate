"""End-to-end tests of the contract's public methods on the simulated runtime."""

import json
import unittest

from gensim import UserError
from support import (
    ALICE, ANCHORS_JSON, BOB, CAROL, DAVE, STATEMENT, TITLE, URL_BLOG, URL_ENGINEER, URL_NEWS, URL_ROADS,
    URL_SOCIETY, World, answer, expect_user_error, fixed_llm, model_reply, page, standard_web,
    SUPPORT_ENGINEER, SUPPORT_NEWS, SUPPORT_ROADS, SUPPORT_SOCIETY, FILLER,
)


def w_module():
    from support import MODULE
    return MODULE


def four(world, claim_id=None):
    claim_id = claim_id or world.open()
    for url, sender in ((URL_ROADS, ALICE), (URL_ENGINEER, ALICE), (URL_NEWS, BOB), (URL_SOCIETY, BOB)):
        world.add(claim_id, url, sender=sender)
    return claim_id


class OpenClaimTests(unittest.TestCase):
    def test_opening_a_claim_records_everything(self):
        w = World()
        claim_id = w.open()
        self.assertEqual(claim_id, 'CLM-0001')
        claim = w.claim(claim_id)
        self.assertEqual(claim['title'], TITLE)
        self.assertEqual(claim['statement'], STATEMENT)
        self.assertEqual(claim['owner'], ALICE.as_hex)
        self.assertEqual(claim['status'], 'OPEN')
        self.assertEqual(claim['standing'], 'UNEXAMINED')
        self.assertEqual(claim['anchors'], [['Meridian Bridge'], ['1,280 metres', '1,280 m', '1280 metres'], ['1964']])
        self.assertEqual(claim['sources'], [])
        self.assertTrue(claim['commitment'].startswith('0x'))
        self.assertEqual(w.view('standing_of', claim_id), 'UNEXAMINED')

    def test_whitespace_in_text_fields_is_squashed(self):
        w = World()
        claim_id = w.open(title='  Meridian   Bridge  facts ', statement='  ' + STATEMENT.replace(' ', '   ') + '  ')
        claim = w.claim(claim_id)
        self.assertEqual(claim['title'], 'Meridian Bridge facts')
        self.assertEqual(claim['statement'], STATEMENT)

    def test_the_same_statement_cannot_be_opened_twice(self):
        w = World()
        w.open()
        with expect_user_error(self, 'already tracked as CLM-0001'):
            w.open(sender=BOB, title='Another title')
        with expect_user_error(self, 'already tracked'):
            w.open(statement=STATEMENT.upper())
        self.assertEqual(w.jview('stats')['claims'], 1)

    def test_invalid_input_is_refused_and_leaves_no_trace(self):
        w = World()
        cases = [
            (dict(title='ab'), 'title is too short'),
            (dict(title='x' * 121), 'title is too long'),
            (dict(statement='too short'), 'statement is too short'),
            (dict(statement=STATEMENT + ' ' + 'x' * 400), 'statement is too long'),
            (dict(topic='gossip'), 'unsupported topic'),
            (dict(anchors_json='[]'), 'non-empty'),
            (dict(anchors_json='["Eiffel"]'), 'does not occur'),
            (dict(statement='It was all in it and so on as is, it is.', anchors_json='["all"]'), 'says too little'),
        ]
        for overrides, fragment in cases:
            with self.subTest(fragment=fragment):
                with expect_user_error(self, fragment):
                    w.open(**overrides)
        self.assertEqual(w.jview('stats')['claims'], 0)
        self.assertEqual(w.jview('list_claims', 0, 10)['items'], [])

    def test_claim_ids_increase_and_listing_is_newest_first(self):
        w = World()
        first = w.open()
        second = w.open(statement='The Harbour Tunnel is 4,200 metres long and carries two railway tracks beneath the bay.', anchors_json='["Harbour Tunnel","4,200 metres"]')
        self.assertEqual((first, second), ('CLM-0001', 'CLM-0002'))
        listing = w.jview('list_claims', 0, 10)
        self.assertEqual([item['claim_id'] for item in listing['items']], ['CLM-0002', 'CLM-0001'])
        self.assertEqual(listing['total'], 2)
        page_two = w.jview('list_claims', 1, 1)
        self.assertEqual([item['claim_id'] for item in page_two['items']], ['CLM-0001'])

    def test_listing_bounds_its_page_size(self):
        w = World()
        w.open()
        self.assertEqual(len(w.jview('list_claims', 0, 0)['items']), 1)
        self.assertEqual(len(w.jview('list_claims', 0, 10_000)['items']), 1)
        self.assertEqual(w.jview('list_claims', 99, 5)['items'], [])
        self.assertEqual(w.jview('list_claims', -5, 5)['offset'], 0)


class SourceTests(unittest.TestCase):
    def test_a_source_records_its_publisher_and_adder(self):
        w = World()
        claim_id = w.open()
        self.assertEqual(w.add(claim_id, URL_ROADS, sender=BOB), 'S1')
        claim = w.claim(claim_id)
        entry = claim['sources'][0]
        self.assertEqual(entry['url'], URL_ROADS)
        self.assertEqual(entry['origin_key'], 'roads-authority.example')
        self.assertEqual(entry['source_key'], 'roads-authority.example/bridges/meridian')
        self.assertEqual(entry['added_by'], BOB.as_hex)
        self.assertTrue(claim['dirty'])

    def test_adding_a_source_needs_no_network(self):
        w = World(web={})
        claim_id = w.open()
        w.add(claim_id, URL_ROADS)
        self.assertEqual(w.last_requests, [])
        self.assertEqual(w.last_prompts, [])

    def test_source_ids_are_never_reused(self):
        w = World()
        claim_id = w.open()
        w.add(claim_id, URL_ROADS)
        w.tx('drop_source', claim_id, 'S1')
        self.assertEqual(w.add(claim_id, URL_ENGINEER), 'S2')

    def test_duplicate_spellings_of_one_page_are_refused(self):
        w = World()
        claim_id = w.open()
        w.add(claim_id, URL_ROADS)
        for variant in (
            URL_ROADS + '/',
            URL_ROADS.replace('https://', 'https://www.'),
            URL_ROADS.upper().replace('HTTPS', 'https'),
            URL_ROADS + '?utm_source=newsletter',
            URL_ROADS + '/index.html',
        ):
            with self.subTest(variant=variant):
                with expect_user_error(self, 'already a source'):
                    w.add(claim_id, variant, sender=BOB)

    def test_per_publisher_quota(self):
        w = World()
        claim_id = w.open()
        w.add(claim_id, 'https://example.org/a')
        w.add(claim_id, 'https://news.example.org/b', sender=BOB)
        with expect_user_error(self, 'maximum number of sources from example.org'):
            w.add(claim_id, 'https://blog.example.org/c', sender=CAROL)

    def test_per_adder_quota(self):
        w = World()
        claim_id = w.open()
        for url in ('https://a1.example/x', 'https://a2.example/x', 'https://a3.example/x'):
            w.add(claim_id, url)
        with expect_user_error(self, 'you have already added'):
            w.add(claim_id, 'https://a4.example/x')
        w.add(claim_id, 'https://a4.example/x', sender=BOB)

    def test_total_source_quota(self):
        w = World()
        claim_id = w.open()
        senders = [ALICE, ALICE, ALICE, BOB, BOB, BOB]
        for number, sender in enumerate(senders, start=1):
            w.add(claim_id, 'https://p%d.example/x' % number, sender=sender)
        with expect_user_error(self, 'maximum number of sources'):
            w.add(claim_id, 'https://p7.example/x', sender=CAROL)

    def test_hidden_publishers_are_refused_on_chain(self):
        w = World()
        claim_id = w.open()
        for url in ('https://bit.ly/x1', 'https://web.archive.org/web/2020/https://example.org/', 'https://pastebin.com/raw/abc'):
            with self.subTest(url=url):
                with expect_user_error(self, 'source is on'):
                    w.add(claim_id, url)
        self.assertEqual(w.claim(claim_id)['sources'], [])

    def test_unknown_or_closed_claims_refuse_sources(self):
        w = World()
        with expect_user_error(self, 'unknown claim'):
            w.add('CLM-0009', URL_ROADS)
        claim_id = w.open()
        w.tx('close_claim', claim_id)
        with expect_user_error(self, 'claim is closed'):
            w.add(claim_id, URL_ROADS)

    def test_inspect_url_never_raises_and_matches_add_source(self):
        w = World()
        good = w.jview('inspect_url', URL_ROADS)
        self.assertEqual((good['ok'], good['origin_key']), (True, 'roads-authority.example'))
        bad = w.jview('inspect_url', 'https://bit.ly/x')
        self.assertFalse(bad['ok'])
        self.assertIn('shortener', bad['reason'])
        self.assertFalse(w.jview('inspect_url', 'nonsense')['ok'])
        self.assertFalse(w.jview('inspect_url', '')['ok'])


class OwnerTests(unittest.TestCase):
    def test_only_the_owner_may_drop_or_close(self):
        w = World()
        claim_id = w.open()
        w.add(claim_id, URL_ROADS, sender=BOB)
        with expect_user_error(self, 'only the owner'):
            w.tx('drop_source', claim_id, 'S1', sender=BOB)
        with expect_user_error(self, 'only the owner'):
            w.tx('close_claim', claim_id, sender=BOB)
        self.assertEqual(len(w.claim(claim_id)['sources']), 1)

    def test_dropping_logs_the_last_stance_and_frees_the_slot(self):
        w = World()
        claim_id = w.open()
        w.add(claim_id, URL_ROADS)
        w.add(claim_id, URL_BLOG)
        w.examine(claim_id)
        self.assertEqual(w.tx('drop_source', claim_id, 'S2'), 'DROPPED')
        claim = w.claim(claim_id)
        self.assertEqual([s['source_id'] for s in claim['sources']], ['S1'])
        self.assertEqual(claim['dropped'][0]['source_id'], 'S2')
        self.assertEqual(claim['dropped'][0]['last_stance'], 'CONTRADICTS')
        self.assertEqual(claim['dropped'][0]['url'], URL_BLOG)
        self.assertTrue(claim['dirty'])

    def test_dropping_an_unknown_source_fails(self):
        w = World()
        claim_id = w.open()
        with expect_user_error(self, 'unknown source'):
            w.tx('drop_source', claim_id, 'S1')

    def test_the_drop_log_is_bounded(self):
        w = World()
        claim_id = w.open()
        for number in range(1, 26):
            w.add(claim_id, 'https://q%d.example/x' % number)
            w.tx('drop_source', claim_id, 'S%d' % number)
        self.assertEqual(len(w.claim(claim_id)['dropped']), 20)

    def test_closing_is_permanent_and_blocks_changes(self):
        w = World()
        claim_id = four(w)
        self.assertEqual(w.tx('close_claim', claim_id), 'CLOSED')
        claim = w.claim(claim_id)
        self.assertEqual(claim['status'], 'CLOSED')
        self.assertGreater(claim['closed_at'], 0)
        for method, args in (('close_claim', ()), ('drop_source', ('S1',)), ('examine', ())):
            with self.subTest(method=method):
                with self.assertRaises(UserError):
                    w.tx(method, claim_id, *args)

    def test_an_owner_cannot_drop_the_evidence_of_an_earlier_examination(self):
        w = World()
        claim_id = w.open()
        w.add(claim_id, URL_ROADS)
        w.add(claim_id, URL_BLOG)
        w.examine(claim_id)
        exam_id = w.claim(claim_id)['last_exam_id']
        before = w.exam(exam_id)
        w.tx('drop_source', claim_id, 'S2')
        self.assertEqual(w.exam(exam_id), before)
        self.assertEqual(w.exam(exam_id)['verdict'], 'CONTESTED')


class ExamineTests(unittest.TestCase):
    def test_four_independent_supporters_triangulate_the_claim(self):
        w = World()
        claim_id = four(w)
        self.assertEqual(w.examine(claim_id), 'TRIANGULATED')
        claim = w.claim(claim_id)
        exam = w.exam('EXM-0001')
        self.assertEqual(claim['standing'], 'TRIANGULATED')
        self.assertEqual(exam['tallies']['support_origins'], 4)
        self.assertEqual(exam['tallies']['echoes'], 0)
        self.assertEqual(exam['edges'], [])
        self.assertEqual([f['stance'] for f in exam['findings']], ['SUPPORTS'] * 4)
        self.assertEqual(claim['exam_ids'], ['EXM-0001'])
        self.assertFalse(claim['dirty'])
        self.assertEqual(w.view('standing_of', claim_id), 'TRIANGULATED')

    def test_every_recorded_excerpt_is_on_the_page(self):
        w = World()
        claim_id = four(w)
        w.examine(claim_id)
        exam = w.exam('EXM-0001')
        for finding in exam['findings']:
            text = w.module._html_to_text(w.web[finding['url']][1])
            self.assertIn(w.module._norm(finding['excerpt']), w.module._norm(text))

    def test_two_independent_supporters_corroborate(self):
        w = World()
        claim_id = w.claim_with([URL_ROADS, URL_ENGINEER])
        self.assertEqual(w.examine(claim_id), 'CORROBORATED')

    def test_a_contradicting_source_makes_the_claim_contested(self):
        w = World()
        claim_id = w.claim_with([URL_ROADS, URL_ENGINEER, URL_BLOG])
        self.assertEqual(w.examine(claim_id), 'CONTESTED')
        exam = w.exam('EXM-0001')
        self.assertEqual(exam['tallies']['contradict_origins'], 1)
        self.assertEqual(exam['tallies']['support_origins'], 2)

    def test_a_single_contradiction_doubts_and_two_refute(self):
        web = standard_web()
        web['https://another-blog.example/post'] = (200, page('Not so: the Meridian Bridge is only 1,100 metres between its towers, and it is false that it is longer.', 'A different hobby page about trains, timetables and the stations its author has photographed.'))
        w = World(web=web)
        claim_id = w.claim_with([URL_BLOG, URL_NEWS])
        w.tx('drop_source', claim_id, 'S2')
        w.add(claim_id, 'https://another-blog.example/post', sender=BOB)
        self.assertEqual(w.examine(claim_id), 'REFUTED')
        claim_two = w.open(statement='The Harbour Tunnel is 4,200 metres long and carries two railway tracks beneath the bay.', anchors_json='["Harbour Tunnel","4,200 metres"]')
        w.add(claim_two, URL_BLOG)
        w.add(claim_two, URL_NEWS, sender=BOB)
        self.assertEqual(w.examine(claim_two), 'UNCONFIRMED')

    def test_one_contradiction_alone_is_doubted(self):
        w = World()
        claim_id = w.claim_with([URL_BLOG, 'https://harbour-notes.example/a'])
        w.web['https://harbour-notes.example/a'] = (200, page('A page about gardening and tomatoes with nothing relevant to say about bridges at all.', 'More filler text to pass the minimum length of a readable page.'))
        self.assertEqual(w.examine(claim_id), 'DOUBTED')

    def test_nobody_saying_anything_is_unconfirmed(self):
        web = {
            'https://a.example/x': (200, page('Tomatoes need sun and water and a bit of patience every summer season.')),
            'https://b.example/x': (200, page('Our cafe serves coffee and cake every day of the week except on Sundays.')),
        }
        w = World(web=web)
        claim_id = w.claim_with(['https://a.example/x', 'https://b.example/x'])
        self.assertEqual(w.examine(claim_id), 'UNCONFIRMED')

    def test_the_prompt_never_names_sources_by_address(self):
        w = World()
        w.examine(four(w))
        prompt = w.last_prompts[0]
        for url in (URL_ROADS, URL_ENGINEER, URL_NEWS, URL_SOCIETY):
            self.assertNotIn(url, prompt)
            self.assertNotIn('roads-authority', prompt)

    def test_examining_needs_two_sources(self):
        w = World()
        claim_id = w.open()
        with expect_user_error(self, 'at least 2 sources'):
            w.examine(claim_id)
        w.add(claim_id, URL_ROADS)
        with expect_user_error(self, 'at least 2 sources'):
            w.examine(claim_id)

    def test_unknown_claim_fails(self):
        with expect_user_error(self, 'unknown claim'):
            World().examine('CLM-0001')

    def test_anyone_may_ask_for_an_examination(self):
        w = World()
        claim_id = four(w)
        w.examine(claim_id, sender=CAROL)
        self.assertEqual(w.exam('EXM-0001')['requested_by'], CAROL.as_hex)

    def test_a_failed_examination_changes_nothing(self):
        w = World()
        claim_id = four(w)
        before = w.view('get_claim_bundle', claim_id)
        w.tx('close_claim', claim_id)
        with self.assertRaises(UserError):
            w.examine(claim_id)
        self.assertEqual(w.jview('stats')['examinations'], 0)
        self.assertEqual(before.count('EXM'), 0)

    def test_the_attestation_recomputes_and_is_sensitive(self):
        w = World()
        claim_id = four(w)
        w.examine(claim_id)
        exam = w.exam('EXM-0001')
        self.assertEqual(w.view('recompute_attestation', 'EXM-0001'), exam['attestation'])
        self.assertEqual(w.view('recompute_attestation', 'EXM-0099'), '')
        stored = json.loads(w.contract.exams['EXM-0001'])
        stored['findings'][0]['stance'] = 'CONTRADICTS'
        w.contract.exams['EXM-0001'] = json.dumps(stored)
        self.assertNotEqual(w.view('recompute_attestation', 'EXM-0001'), exam['attestation'])

    def test_the_attestation_binds_the_verdict_the_echo_graph_and_the_claim(self):
        web = standard_web()
        web[URL_ENGINEER] = (200, page(SUPPORT_ENGINEER, FILLER['engineer'], links=[URL_ROADS]))
        w = World(web=web)
        claim_id = w.claim_with([URL_ROADS, URL_ENGINEER, URL_NEWS])
        w.examine(claim_id)
        original = w.view('recompute_attestation', 'EXM-0001')
        stored = json.loads(w.contract.exams['EXM-0001'])
        self.assertTrue(stored['edges'])

        def attestation_after(mutate_exam=None, mutate_claim=None):
            exam = json.loads(w.contract.exams['EXM-0001'])
            claim = json.loads(w.contract.claims[claim_id])
            if mutate_exam:
                mutate_exam(exam)
            if mutate_claim:
                mutate_claim(claim)
            return w.module._attestation_of(exam, claim)

        self.assertEqual(attestation_after(), original)
        self.assertNotEqual(attestation_after(lambda e: e.update(verdict='REFUTED')), original)
        self.assertNotEqual(attestation_after(lambda e: e['edges'].pop()), original)
        self.assertNotEqual(attestation_after(lambda e: e['tallies'].update(echoes=9)), original)
        self.assertNotEqual(attestation_after(lambda e: e['origins'][0].update(stance='SILENT')), original)
        self.assertNotEqual(attestation_after(lambda e: e.update(examined_at=1)), original)
        self.assertNotEqual(attestation_after(lambda e: e['sources'][0].update(url='https://other.example/x')), original)
        self.assertNotEqual(attestation_after(lambda e: e['findings'][0].update(excerpt='different words here')), original)
        self.assertNotEqual(attestation_after(mutate_claim=lambda c: c.update(commitment='0x00')), original)

    def test_the_commitment_follows_the_statement_and_the_anchors(self):
        w = World()
        a = w.claim(w.open())['commitment']
        b = w.claim(w.open(statement=STATEMENT.replace('1964', '1965'), anchors_json='["Meridian Bridge","1965"]'))['commitment']
        c = w.claim(w.open(statement=STATEMENT + ' It is a landmark.', anchors_json='["Meridian Bridge"]'))['commitment']
        self.assertEqual(len({a, b, c}), 3)

    def test_the_bundle_views(self):
        w = World()
        claim_id = four(w)
        w.examine(claim_id)
        bundle = w.jview('get_claim_bundle', claim_id)
        self.assertEqual(bundle['examinations'][0]['exam_id'], 'EXM-0001')
        self.assertEqual(bundle['examinations'][0]['verdict'], 'TRIANGULATED')
        both = w.jview('get_examination_bundle', 'EXM-0001')
        self.assertEqual(both['claim']['claim_id'], claim_id)
        self.assertEqual(w.view('get_claim_bundle', 'CLM-0042'), 'null')
        self.assertEqual(w.view('get_examination_bundle', 'EXM-0042'), 'null')
        self.assertEqual(w.view('standing_of', 'CLM-0042'), '')
        self.assertEqual(w.view('flips_of', 'CLM-0042'), 0)

    def test_stats_and_info(self):
        w = World()
        claim_id = four(w)
        w.examine(claim_id)
        stats = w.jview('stats')
        self.assertEqual((stats['claims'], stats['examinations'], stats['sources_added'], stats['conclusive']), (1, 1, 4, 1))
        self.assertEqual(stats['verdicts'], {'TRIANGULATED': 1})
        info = w.jview('contract_info')
        self.assertEqual((info['name'], info['version']), ('Triangulate', w.module.VERSION))
        self.assertIn('CORROBORATED', info['verdicts'])
        self.assertEqual(info['limits']['max_sources'], 6)


class ReexaminationTests(unittest.TestCase):
    def test_cooldown_blocks_spam_but_not_changed_sources(self):
        w = World()
        claim_id = w.claim_with([URL_ROADS, URL_ENGINEER])
        w.examine(claim_id)
        with expect_user_error(self, 'examined recently'):
            w.examine(claim_id)
        w.add(claim_id, URL_NEWS, sender=BOB)
        self.assertEqual(w.examine(claim_id), 'TRIANGULATED')

    def test_after_the_cooldown_a_claim_can_be_read_again(self):
        w = World()
        claim_id = w.claim_with([URL_ROADS, URL_ENGINEER])
        w.examine(claim_id)
        w.advance(w.module.REEXAMINE_COOLDOWN_SECONDS)
        w.examine(claim_id)
        self.assertEqual(len(w.claim(claim_id)['exam_ids']), 2)

    def test_a_changed_page_flips_the_verdict_and_it_is_recorded(self):
        w = World()
        claim_id = w.claim_with([URL_ROADS, URL_ENGINEER, URL_NEWS])
        self.assertEqual(w.examine(claim_id), 'TRIANGULATED')
        w.web[URL_NEWS] = (200, page('Update: the newsroom now reports the Meridian Bridge spans only 1,150 metres, contrary to earlier coverage.', FILLER['news']))
        w.advance(w.module.REEXAMINE_COOLDOWN_SECONDS)
        self.assertEqual(w.examine(claim_id), 'CONTESTED')
        claim = w.claim(claim_id)
        self.assertEqual(claim['flips'], 1)
        self.assertEqual(claim['standing'], 'CONTESTED')
        self.assertEqual(w.view('flips_of', claim_id), 1)
        self.assertEqual([h['verdict'] for h in claim['verdict_history']], ['TRIANGULATED', 'CONTESTED'])
        drift = claim['drift']
        self.assertEqual((drift[0]['source_id'], drift[0]['was'], drift[0]['now']), ('S3', 'SUPPORTS', 'CONTRADICTS'))
        self.assertEqual(w.jview('stats')['verdict_flips'], 1)
        self.assertEqual(w.jview('stats')['stance_drifts'], 1)

    def test_the_old_examination_is_untouched_by_the_new_one(self):
        w = World()
        claim_id = w.claim_with([URL_ROADS, URL_ENGINEER, URL_NEWS])
        w.examine(claim_id)
        first = w.exam('EXM-0001')
        w.web[URL_NEWS] = (200, page('The newsroom no longer carries this story and has removed its coverage of the bridge entirely.', FILLER['news']))
        w.advance(w.module.REEXAMINE_COOLDOWN_SECONDS)
        w.examine(claim_id)
        self.assertEqual(w.exam('EXM-0001'), first)
        self.assertEqual(w.claim(claim_id)['standing'], 'CORROBORATED')

    def test_the_same_verdict_twice_is_not_a_flip(self):
        w = World()
        claim_id = w.claim_with([URL_ROADS, URL_ENGINEER])
        w.examine(claim_id)
        w.advance(w.module.REEXAMINE_COOLDOWN_SECONDS)
        w.examine(claim_id)
        self.assertEqual(w.claim(claim_id)['flips'], 0)
        self.assertEqual(w.claim(claim_id)['drift'], [])

    def test_the_examination_history_is_bounded(self):
        w = World()
        claim_id = w.claim_with([URL_ROADS, URL_ENGINEER])
        for _ in range(w.module.MAX_EXAMS_PER_CLAIM):
            w.examine(claim_id)
            w.advance(w.module.REEXAMINE_COOLDOWN_SECONDS)
        with expect_user_error(self, 'history of this claim is full'):
            w.examine(claim_id)
        self.assertEqual(len(w.claim(claim_id)['exam_ids']), w.module.MAX_EXAMS_PER_CLAIM)


class InconclusiveTests(unittest.TestCase):
    def test_unreachable_sources_make_the_examination_inconclusive_without_a_standing(self):
        w = World(web={})
        claim_id = w.claim_with([URL_ROADS, URL_ENGINEER])
        self.assertEqual(w.examine(claim_id), 'INCONCLUSIVE')
        claim = w.claim(claim_id)
        self.assertEqual(claim['standing'], 'UNEXAMINED')
        self.assertTrue(claim['dirty'])
        self.assertEqual(w.last_prompts, [])
        exam = w.exam('EXM-0001')
        self.assertEqual([f['stance'] for f in exam['findings']], ['UNREADABLE', 'UNREADABLE'])
        self.assertEqual([f['flag'] for f in exam['findings']], ['UNREACHABLE', 'UNREACHABLE'])
        self.assertFalse(exam['conclusive'])

    def test_an_inconclusive_run_can_be_retried_immediately(self):
        w = World(web={})
        claim_id = w.claim_with([URL_ROADS, URL_ENGINEER])
        w.examine(claim_id)
        w.web = standard_web()
        self.assertEqual(w.examine(claim_id), 'CORROBORATED')

    def test_inconclusive_does_not_erase_a_standing_nor_count_as_a_flip(self):
        w = World()
        claim_id = w.claim_with([URL_ROADS, URL_ENGINEER])
        w.examine(claim_id)
        w.advance(w.module.REEXAMINE_COOLDOWN_SECONDS)
        w.web = {}
        self.assertEqual(w.examine(claim_id), 'INCONCLUSIVE')
        claim = w.claim(claim_id)
        self.assertEqual((claim['standing'], claim['flips']), ('CORROBORATED', 0))
        self.assertEqual(w.jview('stats')['conclusive'], 1)

    def test_failure_classes_are_recorded(self):
        web = {
            URL_ROADS: (404, 'gone'),
            URL_ENGINEER: (503, 'busy'),
            URL_NEWS: (200, ''),
            URL_SOCIETY: (200, '<html><script>only script</script></html>'),
        }
        w = World(web=web)
        claim_id = four(w)
        self.assertEqual(w.examine(claim_id), 'INCONCLUSIVE')
        flags = [f['flag'] for f in w.exam('EXM-0001')['findings']]
        self.assertEqual(flags, ['HTTP_4XX', 'HTTP_5XX', 'EMPTY', 'EMPTY'])

    def test_one_unreadable_source_blocks_a_clean_bill_but_not_an_accusation(self):
        web = standard_web()
        web[URL_SOCIETY] = (500, 'down')
        w = World(web=web)
        claim_id = four(w)
        self.assertEqual(w.examine(claim_id), 'INCONCLUSIVE')
        web2 = standard_web()
        web2[URL_SOCIETY] = (500, 'down')
        w2 = World(web=web2)
        claim_two = w2.claim_with([URL_ROADS, URL_BLOG, URL_SOCIETY])
        self.assertEqual(w2.examine(claim_two), 'CONTESTED')

    def test_a_model_that_fails_leaves_every_source_unverified(self):
        def broken(prompt):
            raise RuntimeError('model offline')

        w = World(llm=broken)
        claim_id = w.claim_with([URL_ROADS, URL_ENGINEER])
        self.assertEqual(w.examine(claim_id), 'INCONCLUSIVE')
        flags = [f['flag'] for f in w.exam('EXM-0001')['findings']]
        self.assertEqual(flags, ['model_unavailable'] * 2)

    def test_garbage_from_the_model_is_unverified_not_fatal(self):
        for reply in ('not json at all', {'unexpected': 1}, None, 42, {'sources': 'x'}, {'sources': [None, 3, 'x']}):
            with self.subTest(reply=reply):
                w = World(llm=fixed_llm(reply))
                claim_id = w.claim_with([URL_ROADS, URL_ENGINEER])
                self.assertEqual(w.examine(claim_id), 'INCONCLUSIVE')

    def test_prose_around_json_is_tolerated_by_the_parser_but_a_json_mode_model_never_sends_it(self):
        fenced = 'Sure! ```json\n' + json.dumps(model_reply([answer('S1', 'SILENT')])) + '\n```'
        self.assertEqual(w_module()._coerce_json(fenced), model_reply([answer('S1', 'SILENT')]))
        self.assertIsNone(w_module()._coerce_json('no braces'))
        self.assertIsNone(w_module()._coerce_json('{broken'))
        self.assertIsNone(w_module()._coerce_json('[1,2]'))
        self.assertIsNone(w_module()._coerce_json(None))
        w = World(llm=fixed_llm(fenced))
        claim_id = w.claim_with([URL_ROADS, URL_ENGINEER])
        self.assertEqual(w.examine(claim_id), 'INCONCLUSIVE')

    def test_the_model_may_answer_with_an_object_keyed_by_source(self):
        reply = {'sources': {'S1': {'stance': 'SUPPORTS', 'excerpt': SUPPORT_ROADS}, 'S2': {'stance': 'SUPPORTS', 'excerpt': SUPPORT_ENGINEER}}}
        w = World(llm=fixed_llm(reply))
        claim_id = w.claim_with([URL_ROADS, URL_ENGINEER])
        self.assertEqual(w.examine(claim_id), 'CORROBORATED')


if __name__ == '__main__':
    unittest.main()
