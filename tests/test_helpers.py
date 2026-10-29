"""Unit tests for the contract's pure helpers: URLs, origins, anchors, judging, grading."""

import itertools
import json
import random
import unittest

from gensim import UserError
from support import MODULE as M


def user_error(fn, *args):
    try:
        fn(*args)
    except UserError as error:
        return error.message
    raise AssertionError('expected UserError')


def source(number, origin='o%d.example', url=None):
    sid = 'S%d' % number
    return {
        'source_id': sid,
        'url': url or 'https://o%d.example/page' % number,
        'source_key': 'o%d.example/page' % number,
        'origin_key': origin % number if '%d' in origin else origin,
    }


class TextNormalisationTests(unittest.TestCase):
    def test_norm_folds_case_quotes_dashes_and_whitespace(self):
        self.assertEqual(M._norm('  It\u2019s  A \u201cTest\u201d \u2013 ok\u00a0now '), 'it\'s a "test" - ok now')

    def test_has_term_is_token_aware_for_numbers(self):
        self.assertTrue(M._has_term('spans 8,848.86 metres', '8,848.86'))
        self.assertFalse(M._has_term('spans 18,848.86 metres', '8,848.86'))
        self.assertFalse(M._has_term('spans 8,848.865 metres', '8,848.86'))

    def test_has_term_allows_a_unit_glued_to_a_number(self):
        self.assertTrue(M._has_term('it is 8,848.86m tall', '8,848.86'))

    def test_has_term_is_token_aware_for_words(self):
        self.assertTrue(M._has_term('the everest massif', 'everest'))
        self.assertFalse(M._has_term('everestian', 'everest'))
        self.assertFalse(M._has_term('', 'x'))
        self.assertFalse(M._has_term('abc', ''))

    def test_has_term_finds_a_later_valid_occurrence(self):
        self.assertTrue(M._has_term('11964 and then 1964 again', '1964'))

    def test_html_to_blocks_splits_on_block_tags_and_keeps_inline_text_together(self):
        html = '<h1>Title</h1><p>Cut by <b>40</b>% by 2030.</p><script>var x=1;</script><p>Second</p><!-- hidden -->'
        self.assertEqual(M._html_to_blocks(html), ['Title', 'Cut by 40% by 2030.', 'Second'])

    def test_html_to_text_decodes_entities(self):
        self.assertEqual(M._html_to_text('<p>A &amp; B &#233; &#x41;</p>'), 'A & B \u00e9 A')

    def test_html_to_text_ignores_nul_bytes_in_the_source(self):
        self.assertEqual(M._html_to_blocks('<p>a\x00b</p>'), ['a b'])

    def test_plain_text_is_one_block(self):
        self.assertEqual(M._html_to_blocks('just some words'), ['just some words'])

    def test_stems_keep_numbers_and_drop_stopwords(self):
        stems = M._stems('The bridge spans 1,280 metres with towers')
        self.assertIn('1,280', stems)
        self.assertIn('bridg', stems)
        self.assertNotIn('with', stems)

    def test_segments_never_cross_blocks_and_are_bounded(self):
        blocks = ['Heading', 'One sentence. Two sentence. ' + 'word ' * 200]
        pieces = M._segments(blocks)
        self.assertEqual(pieces[0], 'Heading')
        self.assertTrue(all(len(piece) <= M.SEGMENT_CHARS for piece in pieces))
        self.assertIn('One sentence.', pieces)


class UrlTests(unittest.TestCase):
    def check(self, url, fragment):
        self.assertIn(fragment, user_error(M._validate_public_https_url, url, 'url'))

    def test_accepts_an_ordinary_url_and_lowercases_the_host(self):
        self.assertEqual(M._validate_public_https_url('https://EXAMPLE.org/Path?x=1', 'url'), 'https://example.org/Path?x=1')

    def test_rejects_hostile_urls(self):
        cases = {
            'http://example.org/': 'https',
            'ftp://example.org/': 'https',
            'https://example.org/a b': 'whitespace',
            'https://example.org/a\tb': 'whitespace',
            'https://example.org/#frag': 'fragment',
            'https://example.org/a\\b': 'fragment',
            'https://user:pw@example.org/': 'credentials',
            'https://user@example.org/': 'credentials',
            'https://example.org:8443/': 'port',
            'https://127.0.0.1/': 'public DNS',
            'https://0x7f.0.0.1/': 'public DNS',
            'https://127.1/': 'public DNS',
            'https://2130706433/': 'public DNS',
            'https://[::1]/': 'port',
            'https://localhost/': 'public DNS',
            'https://printer.local/': 'public DNS',
            'https://intranet.corp/': 'public DNS',
            'https://example/': 'public DNS',
            'https://exa_mple.org/': 'public DNS',
            'https://example.org/a/../b': 'dot segments',
            'https://example.org/a/./b': 'dot segments',
            'https://example.org/a/%2e%2e/b': 'encoded',
            'https://example.org/a%2Fb': 'encoded',
            'https://example.org/a%5Cb': 'encoded',
        }
        for url, fragment in cases.items():
            with self.subTest(url=url):
                self.check(url, fragment)

    def test_rejects_non_strings_and_overlong_urls(self):
        self.check(None, 'string')
        self.check(5, 'string')
        self.check('https://example.org/' + 'a' * 600, 'too long')

    def test_query_strings_are_allowed_on_sources(self):
        self.assertEqual(M._validate_public_https_url('https://example.org/a?id=3', 'url'), 'https://example.org/a?id=3')


class OriginTests(unittest.TestCase):
    def origin(self, url):
        return M._origin_of(M._validate_public_https_url(url, 'url'))

    def test_registrable_domain_is_the_origin(self):
        self.assertEqual(self.origin('https://www.nasa.gov/a'), 'nasa.gov')
        self.assertEqual(self.origin('https://science.nasa.gov/a'), 'nasa.gov')
        self.assertEqual(self.origin('https://nasa.gov/a'), 'nasa.gov')
        self.assertEqual(self.origin('https://en.wikipedia.org/wiki/X'), 'wikipedia.org')
        self.assertEqual(self.origin('https://simple.wikipedia.org/wiki/X'), 'wikipedia.org')

    def test_two_level_public_suffixes(self):
        self.assertEqual(self.origin('https://www.bbc.co.uk/news'), 'bbc.co.uk')
        self.assertEqual(self.origin('https://news.bbc.co.uk/x'), 'bbc.co.uk')
        self.assertEqual(self.origin('https://www.ons.gov.uk/x'), 'ons.gov.uk')
        self.assertEqual(self.origin('https://abc.net.au/x'), 'abc.net.au')
        self.assertNotEqual(self.origin('https://a.co.uk/x'), self.origin('https://b.co.uk/x'))

    def test_two_publishers_under_one_public_suffix_are_distinct(self):
        self.assertNotEqual(self.origin('https://ox.ac.uk/x'), self.origin('https://cam.ac.uk/x'))

    def test_path_tenant_hosts_use_the_tenant(self):
        self.assertEqual(self.origin('https://github.com/Alice/repo'), 'github:alice')
        self.assertEqual(self.origin('https://raw.githubusercontent.com/alice/repo/main/x.md'), 'github:alice')
        self.assertEqual(self.origin('https://gist.github.com/alice/abc'), 'github:alice')
        self.assertEqual(self.origin('https://gist.githubusercontent.com/alice/abc/raw'), 'github:alice')
        self.assertNotEqual(self.origin('https://github.com/alice/r'), self.origin('https://github.com/bob/r'))
        self.assertEqual(self.origin('https://medium.com/@writer/post'), 'medium:@writer')
        self.assertEqual(self.origin('https://sites.google.com/view/team/home'), 'sites.google.com:view/team')

    def test_path_tenant_hosts_need_a_namespace(self):
        for url in ('https://github.com/', 'https://medium.com', 'https://sites.google.com/view'):
            with self.subTest(url=url):
                self.assertIn('publisher namespace', user_error(M._origin_of, url))

    def test_tenant_suffixes_use_the_subdomain(self):
        self.assertEqual(self.origin('https://alice.github.io/post'), 'github:alice')
        self.assertEqual(self.origin('https://deep.alice.github.io/post'), 'github:alice')
        self.assertEqual(self.origin('https://alice.github.io/p'), self.origin('https://github.com/Alice/repo'))
        self.assertNotEqual(self.origin('https://alice.github.io/p'), self.origin('https://bob.github.io/p'))
        self.assertEqual(self.origin('https://requests.readthedocs.io/en/latest/'), 'requests.readthedocs.io')
        self.assertEqual(self.origin('https://alice.gitlab.io/x'), 'gitlab:alice')
        self.assertEqual(self.origin('https://spanfan.blogspot.com/x'), 'spanfan.blogspot.com')
        self.assertIn('tenant subdomain', user_error(M._origin_of, 'https://github.io/x'))

    def test_hosts_that_hide_a_publisher_are_refused(self):
        for url in (
            'https://bit.ly/abc',
            'https://t.co/abc',
            'https://tinyurl.com/abc',
            'https://web.archive.org/web/2020/https://example.org/',
            'https://archive.ph/abc',
            'https://pastebin.com/raw/abc',
            'https://docs.google.com/document/d/1',
            'https://www.dropbox.com/s/abc',
            'https://sub.bit.ly/abc',
        ):
            with self.subTest(url=url):
                self.assertIn('source is on', user_error(M._origin_of, url))

    def test_every_table_entry_is_wellformed(self):
        for host, reason in M._REFUSED_HOSTS.items():
            self.assertTrue(M._HOST_RE.match(host), host)
            self.assertTrue(reason)
        for suffix in M._TWO_LEVEL_SUFFIXES:
            self.assertEqual(len(suffix.split('.')), 2, suffix)
        for host, (family, depth) in M._TENANT_HOSTS.items():
            self.assertTrue(M._HOST_RE.match(host), host)
            self.assertIn(depth, (1, 2))
        self.assertEqual(len(set(M._TWO_LEVEL_SUFFIXES)), len(M._TWO_LEVEL_SUFFIXES))
        self.assertEqual(len(set(M._TENANT_SUFFIXES)), len(M._TENANT_SUFFIXES))


class SourceKeyTests(unittest.TestCase):
    def key(self, url):
        return M._source_key(url)

    def test_equivalent_spellings_share_a_key(self):
        base = self.key('https://example.org/a/b')
        for variant in (
            'https://www.example.org/a/b',
            'https://EXAMPLE.org/A/B',
            'https://example.org/a/b/',
            'https://example.org//a//b',
            'https://example.org/a;x=1/b',
            'https://example.org/a/b/index.html',
            'https://example.org/a/b?utm_source=x&utm_medium=y',
            'https://example.org/a/b?fbclid=123',
            'https://example.org/a/%62',
        ):
            with self.subTest(variant=variant):
                self.assertEqual(self.key(variant), base)

    def test_query_order_is_folded_but_content_counts(self):
        self.assertEqual(self.key('https://example.org/a?x=1&y=2'), self.key('https://example.org/a?y=2&x=1'))
        self.assertNotEqual(self.key('https://example.org/a?x=1'), self.key('https://example.org/a?x=2'))
        self.assertNotEqual(self.key('https://example.org/a'), self.key('https://example.org/b'))

    def test_unusable_input_gives_an_empty_key(self):
        for value in ('http://example.org/', '', 'https://', 'https://a@b.org/', 'https://example.org:80/', None, 5):
            with self.subTest(value=value):
                self.assertEqual(self.key(value), '')

    def test_cited_keys_find_markup_links_and_text_urls(self):
        raw = (
            '<a href="https://www.Other.org/x/?utm_source=a">x</a> <link href="//third.org/p">'
            ' see https://fourth.org/page. and <a href="/relative">no</a> http://plain.org/z'
        )
        keys = M._cited_keys(raw)
        self.assertIn('other.org/x', keys)
        self.assertIn('third.org/p', keys)
        self.assertIn('fourth.org/page', keys)
        self.assertNotIn('relative', ' '.join(keys))

    def test_cited_keys_decode_ampersand_entities_and_are_bounded(self):
        keys = M._cited_keys('<a href="https://x.org/a?p=1&amp;q=2">l</a>')
        self.assertIn('x.org/a?p=1&q=2', keys)
        many = ' '.join('https://h%d.org/p' % i for i in range(2000))
        self.assertLessEqual(len(M._cited_keys(many)), M.MAX_LINK_CANDIDATES)


class AnchorTests(unittest.TestCase):
    STATEMENT = 'The Meridian Bridge spans 1,280 metres and opened in 1964.'

    def parse(self, value):
        return M._parse_anchors(value if isinstance(value, str) else json.dumps(value), self.STATEMENT)

    def test_accepts_strings_and_alternatives(self):
        groups = self.parse(['Meridian Bridge', ['1,280 metres', '1280 m'], '1964'])
        self.assertEqual(groups, [['Meridian Bridge'], ['1,280 metres', '1280 m'], ['1964']])

    def test_every_anchor_must_occur_in_the_statement(self):
        self.assertIn('does not occur', user_error(self.parse, ['Eiffel']))

    def test_only_the_first_spelling_has_to_occur(self):
        self.assertEqual(self.parse([['1964', '1.964']]), [['1964', '1.964']])
        self.assertIn('does not occur', user_error(self.parse, [['1.964', '1964']]))

    def test_anchor_must_be_a_whole_token_of_the_statement(self):
        self.assertIn('does not occur', user_error(self.parse, ['196']))

    def test_rejects_malformed_anchor_lists(self):
        cases = {
            'not json': 'valid JSON',
            '{}': 'non-empty',
            '[]': 'non-empty',
            '[5]': 'string or a non-empty list',
            '[[]]': 'string or a non-empty list',
            '[[5]]': 'must be a string',
            '[""]': 'too short',
            '["the"]': 'too generic',
            '["a"]': 'too generic',
            '[["1964","the"]]': 'too generic',
            '["1964","1964"]': 'duplicate anchor',
            '["Meridian Bridge","meridian  bridge"]': 'duplicate anchor',
            '[["1964","1964"]]': 'duplicate spelling',
            json.dumps(['x' * 61]): 'too long',
            json.dumps([['1964'] * 5]): 'too many alternative',
            json.dumps(['Meridian', 'Bridge', 'spans', 'metres', '1964']): 'too many anchors',
        }
        for raw, fragment in cases.items():
            with self.subTest(raw=raw[:40]):
                self.assertIn(fragment, user_error(M._parse_anchors, raw, self.STATEMENT))

    def test_rejects_oversized_json(self):
        self.assertIn('too long', user_error(M._parse_anchors, '[' + '"1964",' * 400 + '"1964"]', self.STATEMENT))

    def test_single_digit_anchor_is_allowed_but_single_letter_is_not(self):
        self.assertEqual(M._parse_anchors('["7"]', 'The count was 7 in total today.'), [['7']])

    def test_groups_present_needs_every_group(self):
        groups = [['Meridian Bridge'], ['1,280 metres', '1280 m'], ['1964']]
        self.assertTrue(M._groups_present(groups, 'The Meridian Bridge (1964) spans 1280 m.'))
        self.assertFalse(M._groups_present(groups, 'The Meridian Bridge spans 1280 m.'))
        self.assertFalse(M._groups_present(groups, 'The Meridian Bridge (1964) spans 1,180 metres.'))

    def test_commitment_ignores_case_whitespace_and_spelling_order(self):
        a = M._commitment_of('The X is 5.', [['X', 'x2'], ['5']])
        b = M._commitment_of('the   x IS 5.', [['x2', 'X'], ['5']])
        self.assertEqual(a, b)
        self.assertNotEqual(a, M._commitment_of('The X is 6.', [['X', 'x2'], ['6']]))

    def test_statement_key_ignores_case_and_spacing_only(self):
        self.assertEqual(M._statement_key('The  X is 5.'), M._statement_key('the x is 5.'))
        self.assertNotEqual(M._statement_key('The X is 5.'), M._statement_key('The X is 6.'))


STATEMENT = 'The Meridian Bridge spans 1,280 metres between its two main towers and opened to traffic in 1964.'
GROUPS = [['Meridian Bridge'], ['1,280 metres', '1,280 m'], ['1964']]
SRC = {'source_id': 'S1', 'url': 'https://a.example/x', 'source_key': 'a.example/x', 'origin_key': 'a.example'}


def judge(stance, excerpt, page, statement=STATEMENT, groups=GROUPS):
    return M._judge_source(SRC, statement, groups, {'stance': stance, 'excerpt': excerpt, 'reason': 'r'}, M._verify_text(page))


class JudgeSourceTests(unittest.TestCase):
    FULL = 'The Meridian Bridge opened to traffic in 1964 and spans 1,280 metres across the strait.'
    PAGE = 'Intro text. ' + FULL + ' Other text follows here.'

    def test_full_support_is_accepted(self):
        result = judge('SUPPORTS', self.FULL, self.PAGE)
        self.assertEqual((result['stance'], result['flag']), ('SUPPORTS', ''))

    def test_stance_is_case_insensitive_and_trimmed(self):
        self.assertEqual(judge(' supports ', self.FULL, self.PAGE)['stance'], 'SUPPORTS')

    def test_support_without_every_anchor_is_downgraded(self):
        text = 'The Meridian Bridge spans 1,280 metres across the strait.'
        result = judge('SUPPORTS', text, text)
        self.assertEqual((result['stance'], result['flag']), ('QUALIFIES', 'anchors_missing_from_support'))

    def test_excerpt_must_be_on_the_page(self):
        result = judge('SUPPORTS', self.FULL, 'A completely different page about something else entirely.')
        self.assertEqual((result['stance'], result['flag']), ('UNVERIFIED', 'excerpt_not_in_source'))
        self.assertEqual(result['excerpt'], '')

    def test_an_excerpt_survives_separators_the_model_adds_or_drops(self):
        table_page = 'Constants: speed of light in vacuum | c | 299 792 458 | m s-1 and the Meridian Bridge opened in 1964 [1].'
        quoted = 'speed of light in vacuum c 299 792 458 m s\u22121'
        self.assertEqual(judge('QUALIFIES', quoted, table_page, statement='The speed of light in vacuum is 299,792,458 metres per second.', groups=[['speed of light']])['stance'], 'QUALIFIES')
        self.assertTrue(M._on_page('the Meridian Bridge opened in 1964', M._verify_text(table_page)))
        self.assertTrue(M._on_page('Meridian Bridge opened in 1964 [1]', M._verify_text(table_page)))
        self.assertTrue(M._on_page('Bridge opened in 1964 and the end', M._verify_text('The Meridian Bridge opened in 1964[1] and the end of it.[a]')))
        self.assertTrue(M._on_page('Bridge opened in 1964[2] and the end', M._verify_text('The Meridian Bridge opened in 1964 and the end of it.')))
        self.assertFalse(M._on_page('Bridge opened in [12345] 1964 and the end', M._verify_text('The Meridian Bridge opened in 1964 and the end of it.')))

    def test_an_excerpt_must_match_whole_words_in_order(self):
        verify = M._verify_text('The Meridian Bridge opened to traffic in 1964 and spans 1,280 metres.')
        self.assertFalse(M._on_page('Meridian Bridge opened to traffic in 196', verify))
        self.assertFalse(M._on_page('idian Bridge opened to traffic in 1964', verify))
        self.assertFalse(M._on_page('Bridge Meridian opened to traffic in 1964', verify))
        self.assertFalse(M._on_page('Meridian Bridge opened to traffic in 1965', verify))
        self.assertTrue(M._on_page('MERIDIAN bridge, opened to traffic in 1964', verify))

    def test_verify_text_is_padded_and_collapses_everything_that_is_not_a_letter_or_digit(self):
        self.assertEqual(M._verify_text('A\u2013B, c_d | [1]'), ' a b c d ')
        self.assertEqual(M._verify_text(''), '  ')
        self.assertFalse(M._on_page('anything at all here', '  '))

    def test_anchors_stay_exact_even_though_excerpts_are_matched_loosely(self):
        text = 'The Meridian Bridge opened in 1964 and spans 1.280 metres across the strait.'
        result = judge('SUPPORTS', text, text)
        self.assertEqual((result['stance'], result['flag']), ('QUALIFIES', 'anchors_missing_from_support'))

    def test_short_excerpts_are_not_evidence(self):
        result = judge('SUPPORTS', '1964', self.PAGE)
        self.assertEqual(result['stance'], 'UNVERIFIED')

    def test_excerpt_matches_across_case_quotes_and_whitespace(self):
        result = judge('SUPPORTS', self.FULL.upper().replace(' ', '  '), self.PAGE)
        self.assertEqual(result['stance'], 'SUPPORTS')

    def test_an_unverified_quote_keeps_what_the_model_said_and_what_the_page_shows(self):
        page = 'Constants table: speed of light in vacuum | c | 299 792 458 | m s-1 and nothing else.'
        result = judge('SUPPORTS', 'the speed of light is exactly 299,792,458 metres', page,
                       statement='The speed of light in vacuum is 299,792,458 metres per second.', groups=[['speed of light'], ['299,792,458', '299 792 458']])
        self.assertEqual((result['stance'], result['flag'], result['excerpt']), ('UNVERIFIED', 'excerpt_not_in_source', ''))
        self.assertEqual(result['claimed'], 'the speed of light is exactly 299,792,458 metres')
        self.assertIn('speed of light in vacuum c 299 792 458', result['seen'])
        self.assertLessEqual(len(result['claimed']), M.MAX_DIAGNOSTIC_CHARS)
        self.assertLessEqual(len(result['seen']), M.MAX_DIAGNOSTIC_CHARS)

    def test_other_findings_carry_empty_diagnostics(self):
        result = judge('SUPPORTS', self.FULL, self.PAGE)
        self.assertEqual((result['claimed'], result['seen']), ('', ''))
        self.assertEqual(M._seen_near_anchor([['nowhere to be found']], M._verify_text('some page text')), '')

    def test_unrelated_excerpt_is_unverified_for_every_evidence_stance(self):
        page = 'Bananas are yellow fruits that grow in warm climates around the world.'
        for stance in ('SUPPORTS', 'QUALIFIES', 'CONTRADICTS'):
            with self.subTest(stance=stance):
                result = judge(stance, page, page)
                self.assertEqual((result['stance'], result['flag']), ('UNVERIFIED', 'excerpt_unrelated_to_claim'))

    def test_qualifies_needs_a_related_verified_excerpt(self):
        text = 'The Meridian Bridge crosses the strait near the old harbour.'
        self.assertEqual(judge('QUALIFIES', text, text)['stance'], 'QUALIFIES')

    def test_silent_needs_no_excerpt(self):
        result = judge('SILENT', '', 'whatever')
        self.assertEqual((result['stance'], result['excerpt']), ('SILENT', ''))

    def test_unknown_or_missing_stance_is_unverified(self):
        for stance in ('MAYBE', '', 'KEPT', None):
            with self.subTest(stance=stance):
                result = M._judge_source(SRC, STATEMENT, GROUPS, {'stance': stance}, 'x')
                self.assertEqual((result['stance'], result['flag']), ('UNVERIFIED', 'unusable_stance'))

    def test_contradiction_with_a_different_figure_is_accepted(self):
        text = 'The Meridian Bridge spans only 1,180 metres between the two towers.'
        self.assertEqual(judge('CONTRADICTS', text, text)['stance'], 'CONTRADICTS')

    def test_contradiction_with_every_anchor_and_no_negation_is_rejected(self):
        result = judge('CONTRADICTS', self.FULL, self.PAGE)
        self.assertEqual((result['stance'], result['flag']), ('UNVERIFIED', 'contradiction_without_signal'))

    def test_contradiction_with_every_anchor_and_a_negation_is_accepted(self):
        text = 'It is false that the Meridian Bridge opened to traffic in 1964 and spans 1,280 metres.'
        self.assertEqual(judge('CONTRADICTS', text, text)['stance'], 'CONTRADICTS')

    def test_contradiction_must_be_closely_related(self):
        text = 'Bridges in 1,180 other places are not the same.'
        result = judge('CONTRADICTS', text, text)
        self.assertEqual(result['stance'], 'UNVERIFIED')

    def test_long_fields_are_clipped(self):
        page = self.PAGE
        result = M._judge_source(SRC, STATEMENT, GROUPS, {'stance': 'SUPPORTS', 'excerpt': self.FULL, 'reason': 'x' * 1000}, M._verify_text(page))
        self.assertEqual(len(result['reason']), M.MAX_REASON_CHARS)

    def test_a_non_string_field_does_not_crash(self):
        result = M._judge_source(SRC, STATEMENT, GROUPS, {'stance': 'SUPPORTS', 'excerpt': ['x'], 'reason': {'a': 1}}, 'x')
        self.assertEqual(result['stance'], 'UNVERIFIED')


def tallies_for(**overrides):
    base = dict(
        sources=0, origins=0, echoes=0, readable_origins=0, support_origins=0, contradict_origins=0,
        qualify_origins=0, silent_origins=0, conflicted_origins=0, unresolved_origins=0, support_sources=0,
    )
    base.update(overrides)
    return base


class VerdictTableTests(unittest.TestCase):
    def verdict(self, **kw):
        t = tallies_for(**kw)
        t['readable_origins'] = kw.get(
            'readable_origins',
            t['support_origins'] + t['contradict_origins'] + t['qualify_origins'] + t['silent_origins'] + t['conflicted_origins'],
        )
        t['support_sources'] = kw.get('support_sources', t['support_origins'])
        return M._verdict_of(t)

    def test_named_cases(self):
        cases = [
            (dict(), 'INCONCLUSIVE'),
            (dict(unresolved_origins=4), 'INCONCLUSIVE'),
            (dict(support_origins=3), 'TRIANGULATED'),
            (dict(support_origins=5, silent_origins=1), 'TRIANGULATED'),
            (dict(support_origins=3, qualify_origins=1), 'TRIANGULATED'),
            (dict(support_origins=2), 'CORROBORATED'),
            (dict(support_origins=2, silent_origins=2), 'CORROBORATED'),
            (dict(support_origins=2, qualify_origins=1), 'CORROBORATED'),
            (dict(support_origins=2, qualify_origins=2), 'QUALIFIED'),
            (dict(support_origins=3, unresolved_origins=1), 'INCONCLUSIVE'),
            (dict(support_origins=2, unresolved_origins=1), 'INCONCLUSIVE'),
            (dict(support_origins=1, support_sources=3), 'ECHO_ONLY'),
            (dict(support_origins=1, support_sources=2, silent_origins=1), 'ECHO_ONLY'),
            (dict(support_origins=1), 'UNCONFIRMED'),
            (dict(support_origins=1, unresolved_origins=3), 'UNCONFIRMED'),
            (dict(silent_origins=3), 'UNCONFIRMED'),
            (dict(qualify_origins=1), 'UNCONFIRMED'),
            (dict(qualify_origins=1, silent_origins=1), 'UNCONFIRMED'),
            (dict(qualify_origins=2), 'QUALIFIED'),
            (dict(support_origins=1, qualify_origins=1), 'QUALIFIED'),
            (dict(support_origins=1, qualify_origins=1, support_sources=3), 'QUALIFIED'),
            (dict(contradict_origins=1), 'DOUBTED'),
            (dict(contradict_origins=1, silent_origins=3, qualify_origins=2), 'DOUBTED'),
            (dict(contradict_origins=2), 'REFUTED'),
            (dict(contradict_origins=4, silent_origins=1), 'REFUTED'),
            (dict(support_origins=1, contradict_origins=1), 'CONTESTED'),
            (dict(support_origins=5, contradict_origins=1), 'CONTESTED'),
            (dict(conflicted_origins=1), 'CONTESTED'),
            (dict(conflicted_origins=1, support_origins=3), 'CONTESTED'),
        ]
        for kw, expected in cases:
            with self.subTest(kw=kw):
                self.assertEqual(self.verdict(**kw), expected)

    def test_a_clean_bill_never_survives_a_contradiction_or_an_unresolved_source(self):
        for support, contradict, conflicted, unresolved in itertools.product(range(0, 6), range(0, 3), range(0, 2), range(0, 3)):
            t = tallies_for(support_origins=support, contradict_origins=contradict, conflicted_origins=conflicted, unresolved_origins=unresolved)
            t['readable_origins'] = support + contradict + conflicted
            t['support_sources'] = support
            verdict = M._verdict_of(t)
            if verdict in ('TRIANGULATED', 'CORROBORATED'):
                self.assertEqual((contradict, conflicted, unresolved), (0, 0, 0), t)
                self.assertGreaterEqual(support, 2)

    def test_every_verdict_is_reachable_and_known(self):
        seen = set()
        for support, contradict, qualify, silent, conflicted, unresolved, extra in itertools.product(
            range(0, 4), range(0, 3), range(0, 3), range(0, 2), range(0, 2), range(0, 2), range(0, 3)
        ):
            t = tallies_for(
                support_origins=support, contradict_origins=contradict, qualify_origins=qualify, silent_origins=silent,
                conflicted_origins=conflicted, unresolved_origins=unresolved,
            )
            t['readable_origins'] = support + contradict + qualify + silent + conflicted
            t['support_sources'] = support + extra
            seen.add(M._verdict_of(t))
        self.assertEqual(seen, set(M._ALL_VERDICTS))

    def test_more_support_never_turns_a_contested_claim_into_a_clean_one(self):
        for support in range(1, 8):
            self.assertEqual(self.verdict(support_origins=support, contradict_origins=1), 'CONTESTED')

    def test_origin_stance_table(self):
        S, C, Q, N, U, R = 'SUPPORTS', 'CONTRADICTS', 'QUALIFIES', 'SILENT', 'UNVERIFIED', 'UNREADABLE'
        cases = [
            ([S], 'SUPPORTS'), ([S, S], 'SUPPORTS'), ([S, Q], 'SUPPORTS'), ([S, N], 'SUPPORTS'), ([S, U], 'SUPPORTS'),
            ([C], 'CONTRADICTS'), ([C, Q], 'CONTRADICTS'), ([C, N], 'CONTRADICTS'),
            ([S, C], 'CONFLICTED'), ([C, S, Q], 'CONFLICTED'),
            ([Q], 'QUALIFIES'), ([Q, N], 'QUALIFIES'), ([Q, U], 'QUALIFIES'),
            ([N], 'SILENT'), ([N, U], 'SILENT'), ([N, R], 'SILENT'),
            ([U], 'UNRESOLVED'), ([R], 'UNRESOLVED'), ([U, R], 'UNRESOLVED'),
        ]
        for stances, expected in cases:
            with self.subTest(stances=stances):
                self.assertEqual(M._origin_stance(stances), expected)


def finding(number, stance, excerpt=''):
    return M._finding(source(number), stance, excerpt, '', '')


class GradeTests(unittest.TestCase):
    EX = 'The Meridian Bridge spans 1,280 metres.'

    def test_echoed_sources_count_once(self):
        findings = [finding(1, 'SUPPORTS', self.EX), finding(2, 'SUPPORTS', self.EX), finding(3, 'SUPPORTS', self.EX)]
        graded = M._grade(findings, [['S1', 'S2'], ['S3']])
        self.assertEqual(graded['tallies']['support_origins'], 2)
        self.assertEqual(graded['tallies']['support_sources'], 3)
        self.assertEqual(graded['tallies']['echoes'], 1)
        self.assertEqual(graded['verdict'], 'CORROBORATED')

    def test_all_echoes_is_echo_only(self):
        findings = [finding(n, 'SUPPORTS', self.EX) for n in (1, 2, 3)]
        graded = M._grade(findings, [['S1', 'S2', 'S3']])
        self.assertEqual(graded['verdict'], 'ECHO_ONLY')
        self.assertEqual(graded['tallies']['echoes'], 2)

    def test_origin_ids_follow_member_order(self):
        findings = [finding(n, 'SILENT') for n in (1, 2, 3)]
        graded = M._grade(findings, [['S1', 'S3'], ['S2']])
        self.assertEqual([o['origin_id'] for o in graded['origins']], ['O1', 'O2'])
        self.assertEqual(graded['origins'][0]['sources'], ['S1', 'S3'])

    def test_unreadable_origin_is_unresolved_and_blocks_a_clean_bill(self):
        findings = [finding(1, 'SUPPORTS', self.EX), finding(2, 'SUPPORTS', self.EX), finding(3, 'UNREADABLE')]
        graded = M._grade(findings, [['S1'], ['S2'], ['S3']])
        self.assertEqual(graded['tallies']['unresolved_origins'], 1)
        self.assertEqual(graded['verdict'], 'INCONCLUSIVE')


class EchoGraphTests(unittest.TestCase):
    STEMS = M._stems('The Meridian Bridge spans 1,280 metres between its two main towers and opened to traffic in 1964.')

    def pages(self, **texts):
        stems = self.STEMS
        out = {}
        for sid, blocks in texts.items():
            page = M._prepare_page(blocks, stems, GROUPS)
            page['cited'] = set()
            out[sid] = page
        return out

    def snapshot(self, count, origins=None):
        items = []
        for n in range(1, count + 1):
            items.append(
                {
                    'source_id': 'S%d' % n,
                    'url': 'https://h%d.example/p' % n,
                    'source_key': 'h%d.example/p' % n,
                    'origin_key': (origins or {}).get(n, 'h%d.example' % n),
                }
            )
        return items

    def kinds(self, edges):
        return sorted((e['a'], e['b'], e['kind']) for e in edges)

    def test_unrelated_pages_have_no_edges(self):
        pages = self.pages(
            S1=['The Meridian Bridge spans 1,280 metres and opened in 1964, say the roads people.'],
            S2=['Our magazine reviewed the Meridian Bridge span of 1,280 metres in an essay about steel cables.'],
        )
        self.assertEqual(M._echo_edges(self.snapshot(2), pages), [])

    def test_same_publisher_is_an_edge_even_when_unreadable(self):
        edges = M._echo_edges(self.snapshot(2, origins={1: 'x.example', 2: 'x.example'}), {})
        self.assertEqual(self.kinds(edges), [('S1', 'S2', 'SAME_ORIGIN')])

    def test_exact_citation_is_a_directed_edge(self):
        pages = self.pages(S1=['One text about something quite else entirely and unrelated to bridges at all.'], S2=['Another text about nothing in common with the first page, honest.'])
        pages['S2']['cited'] = {'h1.example/p'}
        edges = M._echo_edges(self.snapshot(2), pages)
        self.assertEqual(self.kinds(edges), [('S2', 'S1', 'CITES')])
        pages['S1']['cited'] = {'h2.example/p'}
        edges = M._echo_edges(self.snapshot(2), pages)
        self.assertEqual(self.kinds(edges), [('S1', 'S2', 'CITES'), ('S2', 'S1', 'CITES')])

    def test_a_shared_relevant_sentence_is_an_edge(self):
        shared = 'The Meridian Bridge spans 1,280 metres between its two main towers, according to the authority.'
        pages = self.pages(
            S1=['First page intro that differs completely from the other one.', shared],
            S2=['A very different opening paragraph that says other things about harbours.', shared],
        )
        edges = M._echo_edges(self.snapshot(2), pages)
        self.assertEqual(self.kinds(edges), [('S1', 'S2', 'SHARED_PASSAGE')])

    def test_a_shared_sentence_that_is_off_topic_is_boilerplate_not_an_echo(self):
        boiler = 'We use cookies to improve your experience and to show you content that you may like.'
        pages = self.pages(
            S1=['The Meridian Bridge spans 1,280 metres says one page.', boiler],
            S2=['Another outlet says the Meridian Bridge opened in 1964.', boiler],
        )
        self.assertEqual(M._echo_edges(self.snapshot(2), pages), [])

    def test_a_sentence_that_shares_only_a_common_word_is_not_an_echo(self):
        weak = 'This hobby blog shares photographs of spans and viaducts that its author has visited over the years.'
        pages = self.pages(S1=['The Meridian Bridge spans 1,280 metres says one page.', weak], S2=['Another outlet says the Meridian Bridge opened in 1964.', weak])
        self.assertEqual(M._echo_edges(self.snapshot(2), pages), [])

    def test_a_short_shared_sentence_is_not_an_echo(self):
        pages = self.pages(S1=['The Meridian Bridge spans 1,280 metres. Padding words follow here.'], S2=['The Meridian Bridge spans 1,280 metres. Different padding words here instead.'])
        self.assertEqual(M._echo_edges(self.snapshot(2), pages), [])

    def test_a_near_copy_is_an_edge(self):
        body = ' '.join('Sentence number %d says that structures need regular maintenance work.' % n for n in range(60))
        pages = self.pages(S1=[body], S2=[body + ' Plus a comment section with extra words that is not in the original text at all.'])
        edges = M._echo_edges(self.snapshot(2), pages)
        self.assertIn(('S1', 'S2', 'NEAR_COPY'), self.kinds(edges))

    def test_a_small_overlap_is_not_a_near_copy(self):
        common = ' '.join('Shared sentence %d about maintenance routines of large structures.' % n for n in range(6))
        one = ' '.join('Alpha unique sentence %d concerning cables and anchors in suspension spans.' % n for n in range(60))
        two = ' '.join('Bravo different sentence %d concerning concrete and rebar in viaduct decks.' % n for n in range(60))
        pages = self.pages(S1=[common, one], S2=[common, two])
        self.assertNotIn('NEAR_COPY', [e['kind'] for e in M._echo_edges(self.snapshot(2), pages)])

    def test_tiny_pages_never_count_as_near_copies(self):
        pages = self.pages(S1=['Meridian Bridge short page about nothing in particular here.'], S2=['Meridian Bridge short page about nothing in particular here.'])
        self.assertNotIn('NEAR_COPY', [e['kind'] for e in M._echo_edges(self.snapshot(2), pages)])

    def test_edges_are_sorted_and_components_follow_them(self):
        edges = [
            M._edge('S3', 'S4', 'SAME_ORIGIN'),
            M._edge('S1', 'S2', 'NEAR_COPY'),
            M._edge('S2', 'S3', 'CITES'),
        ]
        edges.sort(key=M._edge_order)
        self.assertEqual(M._components(['S1', 'S2', 'S3', 'S4', 'S5'], edges), [['S1', 'S2', 'S3', 'S4'], ['S5']])

    def test_components_without_edges_are_singletons_in_order(self):
        self.assertEqual(M._components(['S1', 'S2', 'S10'], []), [['S1'], ['S2'], ['S10']])

    def test_components_order_by_numeric_not_lexical_id(self):
        ids = ['S2', 'S9', 'S10']
        self.assertEqual(M._components(ids, [M._edge('S9', 'S10', 'NEAR_COPY')]), [['S2'], ['S9', 'S10']])

    def test_component_partition_is_independent_of_edge_order_and_direction(self):
        rng = random.Random(7)
        ids = ['S%d' % n for n in range(1, 7)]
        for _ in range(200):
            edges = []
            for a, b in itertools.combinations(ids, 2):
                if rng.random() < 0.25:
                    edges.append(M._edge(a, b, rng.choice(['NEAR_COPY', 'SAME_ORIGIN'])))
            shuffled = list(edges)
            rng.shuffle(shuffled)
            flipped = [M._edge(e['b'], e['a'], 'CITES') for e in shuffled]
            self.assertEqual(M._components(ids, edges), M._components(ids, flipped))


class WindowTests(unittest.TestCase):
    STEMS = M._stems(STATEMENT)

    def test_short_pages_are_shown_whole(self):
        page = M._prepare_page(['Heading', 'Short body about the Meridian Bridge here, with enough characters to count.'], self.STEMS, GROUPS)
        self.assertEqual(page['window'], 'Heading\nShort body about the Meridian Bridge here, with enough characters to count.')

    def test_long_pages_show_the_relevant_passages_not_the_start(self):
        filler = ['Cookie notice and navigation words repeated again and again. ' * 3] * 80
        relevant = 'Deep in the page the Meridian Bridge opened in 1964 and spans 1,280 metres across the strait.'
        blocks = filler[:40] + [relevant] + filler[40:]
        page = M._prepare_page(blocks, self.STEMS, GROUPS)
        self.assertIn(relevant, page['window'])
        self.assertLessEqual(len(page['window']), M.WINDOW_CHARS + 6 * M.MAX_WINDOW_LINES)

    def test_a_strong_passage_beats_many_weak_ones_when_the_budget_is_tight(self):
        weak = ['A bridge is a structure that lets people cross a river, a road or a rail line, number %d, in many places.' % n for n in range(40)]
        strong = 'The Meridian Bridge opened to traffic in 1964 and spans 1,280 metres.'
        window = M._prepare_page(weak + [strong], self.STEMS, GROUPS)['window']
        self.assertIn(strong, window)

    def test_a_table_row_is_shown_contiguously_so_a_quote_of_it_is_really_on_the_page(self):
        row = ['speed of light in vacuum', 'c', '299 792 458', 'm s-1']
        blocks = ['Navigation words. ' * 100] + row + ['Footer words. ' * 100]
        self.assertGreater(len(' '.join(blocks)), M.WINDOW_CHARS)
        stems = M._stems('The speed of light in vacuum is 299,792,458 metres per second.')
        groups = [['speed of light'], ['299,792,458', '299 792 458']]
        page = M._prepare_page(blocks, stems, groups)
        lines = page['window'].split('\n')
        start = lines.index('speed of light in vacuum')
        self.assertEqual(lines[start:start + 4], row)
        self.assertTrue(M._on_page('speed of light in vacuum c 299 792 458 m s-1', page['verify']))

    def test_pieces_that_are_not_adjacent_on_the_page_are_separated_by_a_gap_marker(self):
        blocks = ['The Meridian Bridge opened to traffic in 1964.'] + ['Padding words that say nothing at all about it. '] * 80 + ['The Meridian Bridge spans 1,280 metres.']
        window = M._prepare_page(blocks, self.STEMS, GROUPS)['window']
        self.assertIn(M.WINDOW_GAP, window.split('\n'))
        lines = window.split('\n')
        gap = lines.index(M.WINDOW_GAP)
        self.assertIn('1964', ' '.join(lines[:gap]))
        self.assertIn('1,280', ' '.join(lines[gap + 1:]))

    def test_window_never_exceeds_its_budget_even_with_neighbours(self):
        blocks = ['x. ' * 3000, 'The Meridian Bridge opened to traffic in 1964.', 'y. ' * 3000]
        window = M._prepare_page(blocks, self.STEMS, GROUPS)['window']
        self.assertLessEqual(len(window), M.WINDOW_CHARS + 6 * M.MAX_WINDOW_LINES)
        self.assertLessEqual(len(window.split('\n')), 2 * M.MAX_WINDOW_LINES)

    def test_window_keeps_page_order(self):
        blocks = ['Filler ' * 400, 'First: the Meridian Bridge opened in 1964.', 'Middle ' * 100, 'Second: the Meridian Bridge spans 1,280 metres.']
        window = M._prepare_page(blocks, self.STEMS, GROUPS)['window']
        self.assertLess(window.index('First'), window.index('Second'))

    def test_an_irrelevant_long_page_falls_back_to_its_start(self):
        blocks = ['Gardening words about tomatoes and soil. ' * 100]
        window = M._prepare_page(blocks, self.STEMS, GROUPS)['window']
        self.assertTrue(window.startswith('Gardening'))
        self.assertLessEqual(len(window), M.FALLBACK_WINDOW_CHARS)

    def test_window_text_is_always_a_subset_of_the_page(self):
        blocks = ['Intro words here. ' * 50, 'The Meridian Bridge opened in 1964.', 'Outro words here. ' * 50]
        page = M._prepare_page(blocks, self.STEMS, GROUPS)
        for line in page['window'].split('\n'):
            self.assertIn(M._norm(line), page['norm'])

    def test_preparation_is_deterministic(self):
        blocks = ['The Meridian Bridge opened in 1964. ' * 5, 'Other ' * 300, 'The Meridian Bridge spans 1,280 metres. ' * 5]
        first = M._prepare_page(blocks, self.STEMS, GROUPS)
        second = M._prepare_page(list(blocks), self.STEMS, GROUPS)
        self.assertEqual(first['window'], second['window'])
        self.assertEqual(first['passages'], second['passages'])


class OutcomeValidationTests(unittest.TestCase):
    EX = 'The Meridian Bridge opened to traffic in 1964 and spans 1,280 metres.'

    def make(self, stances, edges=(), origins=None):
        snapshot = [source(n) for n in range(1, len(stances) + 1)]
        findings = [M._finding(snapshot[i], s, self.EX if s in ('SUPPORTS', 'CONTRADICTS', 'QUALIFIES') else '', 'r', '') for i, s in enumerate(stances)]
        edge_list = sorted((M._edge(a, b, k) for a, b, k in edges), key=M._edge_order)
        graded = M._grade(findings, M._components([s['source_id'] for s in snapshot], edge_list))
        outcome = {'ok': True, 'verdict': graded['verdict'], 'tallies': graded['tallies'], 'origins': graded['origins'], 'edges': edge_list, 'findings': findings}
        return snapshot, json.loads(json.dumps(outcome))

    def test_a_consistent_outcome_passes_unchanged(self):
        snapshot, outcome = self.make(['SUPPORTS', 'SUPPORTS', 'SILENT'], [('S1', 'S2', 'NEAR_COPY')])
        checked = M._validate_outcome(snapshot, outcome)
        self.assertEqual(checked['verdict'], 'ECHO_ONLY')
        self.assertEqual(checked['tallies']['echoes'], 1)

    def test_tampering_is_refused(self):
        snapshot, good = self.make(['SUPPORTS', 'SUPPORTS', 'SUPPORTS'])
        tampers = {
            'verdict': lambda o: o.update(verdict='REFUTED'),
            'tallies': lambda o: o['tallies'].update(support_origins=9),
            'origins': lambda o: o['origins'][0].update(stance='CONTRADICTS'),
            'stance': lambda o: o['findings'][0].update(stance='CONTRADICTS'),
            'unknown stance': lambda o: o['findings'][0].update(stance='GREAT'),
            'missing finding': lambda o: o['findings'].pop(),
            'wrong id': lambda o: o['findings'][0].update(source_id='S9'),
            'not ok': lambda o: o.update(ok=False),
            'no edges field': lambda o: o.update(edges='x'),
            'edge unknown source': lambda o: o['edges'].append({'a': 'S1', 'b': 'S9', 'kind': 'NEAR_COPY'}),
            'edge unknown kind': lambda o: o['edges'].append({'a': 'S1', 'b': 'S2', 'kind': 'VIBES'}),
            'edge self loop': lambda o: o['edges'].append({'a': 'S1', 'b': 'S1', 'kind': 'NEAR_COPY'}),
            'edge reversed': lambda o: o['edges'].append({'a': 'S2', 'b': 'S1', 'kind': 'NEAR_COPY'}),
            'edge not dict': lambda o: o['edges'].append('S1-S2'),
        }
        for name, tamper in tampers.items():
            with self.subTest(tamper=name):
                outcome = json.loads(json.dumps(good))
                tamper(outcome)
                with self.assertRaises(UserError):
                    M._validate_outcome(snapshot, outcome)

    def test_a_stance_without_evidence_is_refused(self):
        snapshot, outcome = self.make(['SUPPORTS', 'SUPPORTS'])
        outcome['findings'][0]['excerpt'] = ''
        with self.assertRaises(UserError):
            M._validate_outcome(snapshot, outcome)

    def test_a_repeated_edge_is_refused(self):
        snapshot, outcome = self.make(['SILENT', 'SILENT'], [('S1', 'S2', 'NEAR_COPY')])
        outcome['edges'].append(dict(outcome['edges'][0]))
        with self.assertRaises(UserError):
            M._validate_outcome(snapshot, outcome)

    def test_publisher_edges_must_match_the_addresses_exactly(self):
        snapshot = [source(1, origin='same.example'), source(2, origin='same.example'), source(3)]
        findings = [M._finding(s, 'SILENT', '', '', '') for s in snapshot]
        ids = [s['source_id'] for s in snapshot]
        with_edge = [M._edge('S1', 'S2', 'SAME_ORIGIN')]
        graded = M._grade(findings, M._components(ids, with_edge))
        good = json.loads(json.dumps({'ok': True, 'verdict': graded['verdict'], 'tallies': graded['tallies'], 'origins': graded['origins'], 'edges': with_edge, 'findings': findings}))
        M._validate_outcome(snapshot, good)
        graded = M._grade(findings, M._components(ids, []))
        missing = json.loads(json.dumps({'ok': True, 'verdict': graded['verdict'], 'tallies': graded['tallies'], 'origins': graded['origins'], 'edges': [], 'findings': findings}))
        with self.assertRaises(UserError):
            M._validate_outcome(snapshot, missing)
        invented = json.loads(json.dumps(good))
        invented['edges'].append({'a': 'S2', 'b': 'S3', 'kind': 'SAME_ORIGIN'})
        with self.assertRaises(UserError):
            M._validate_outcome(snapshot, invented)

    def test_random_outcomes_always_validate_and_never_overcount(self):
        rng = random.Random(11)
        stances = ['SUPPORTS', 'CONTRADICTS', 'QUALIFIES', 'SILENT', 'UNVERIFIED', 'UNREADABLE']
        for _ in range(300):
            count = rng.randint(2, 6)
            chosen = [rng.choice(stances) for _ in range(count)]
            edges = [(a, b, 'NEAR_COPY') for a, b in itertools.combinations(['S%d' % n for n in range(1, count + 1)], 2) if rng.random() < 0.3]
            snapshot, outcome = self.make(chosen, edges)
            checked = M._validate_outcome(snapshot, outcome)
            self.assertLessEqual(checked['tallies']['support_origins'], checked['tallies']['support_sources'])
            self.assertEqual(checked['tallies']['origins'] + checked['tallies']['echoes'], count)
            self.assertIn(checked['verdict'], M._ALL_VERDICTS)

    def test_adding_edges_never_increases_independent_support(self):
        rng = random.Random(5)
        ids = ['S%d' % n for n in range(1, 7)]
        findings = [M._finding(source(n), 'SUPPORTS', self.EX, '', '') for n in range(1, 7)]
        pairs = list(itertools.combinations(ids, 2))
        for _ in range(100):
            subset = [p for p in pairs if rng.random() < 0.3]
            extra = [p for p in pairs if p not in subset and rng.random() < 0.3]
            few = M._grade(findings, M._components(ids, [M._edge(a, b, 'NEAR_COPY') for a, b in subset]))
            more = M._grade(findings, M._components(ids, [M._edge(a, b, 'NEAR_COPY') for a, b in subset + extra]))
            self.assertLessEqual(more['tallies']['support_origins'], few['tallies']['support_origins'])


if __name__ == '__main__':
    unittest.main()
