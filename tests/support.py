"""Shared helpers for the Triangulate test suite. Standard library only."""

from __future__ import annotations

import calendar
import importlib.util
import json
import os
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

import gensim
from gensim import Address, Env, Message, RUNTIME, UserError

ROOT = Path(__file__).resolve().parent.parent
CONTRACT_PATH = Path(os.environ.get('TRIANGULATE_CONTRACT', str(ROOT / 'contracts' / 'triangulate.py')))
SCENARIOS_PATH = ROOT / 'scenarios' / 'scenarios.json'


def addr(number: int) -> Address:
    return Address('0x' + format(number, '040x'))


ALICE = addr(0xA11CE)
BOB = addr(0xB0B)
CAROL = addr(0xCA401)
DAVE = addr(0xDA7E)
CONTRACT = addr(0xC0417AC7)


def load_contract_module() -> Any:
    """Execute the real contract file against the simulated SDK."""
    gensim.install()
    spec = importlib.util.spec_from_file_location('triangulate_contract_under_test', CONTRACT_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# ------------------------------------------------------------------------------ a fictional case

TITLE = 'Meridian Bridge facts'
STATEMENT = 'The Meridian Bridge spans 1,280 metres between its two main towers and opened to traffic in 1964.'
ANCHORS = ['Meridian Bridge', ['1,280 metres', '1,280 m', '1280 metres'], '1964']
ANCHORS_JSON = json.dumps(ANCHORS)

# Four unrelated publishers, one page each.
URL_ROADS = 'https://roads-authority.example/bridges/meridian'
URL_ENGINEER = 'https://engineering-weekly.example/features/meridian-bridge'
URL_NEWS = 'https://citynews.example/2026/meridian-bridge-explained'
URL_SOCIETY = 'https://historysociety.example/landmarks/meridian'
URL_BLOG = 'https://spanfan.blogspot.com/2026/meridian'

SUPPORT_ROADS = 'Official record: the Meridian Bridge opened in 1964 and its main span measures 1,280 metres between the towers.'
SUPPORT_ENGINEER = 'Engineers note that the Meridian Bridge, which opened to traffic in 1964, spans 1,280 metres.'
SUPPORT_NEWS = 'Local reporters confirm the Meridian Bridge spans 1,280 metres and first carried cars in 1964.'
SUPPORT_SOCIETY = 'The society records that the Meridian Bridge, with a main span of 1,280 metres, opened in 1964.'
CONTRADICTION_BLOG = 'Contrary to popular belief the Meridian Bridge spans only 1,180 metres, and it opened in 1965.'


def page(*paragraphs: str, title: str = 'Page', links: Optional[List[str]] = None, extra_head: str = '') -> str:
    """A small HTML page. Every paragraph becomes a block, so the contract sees sentences in order."""
    body = ''.join('<p>%s</p>' % paragraph for paragraph in paragraphs)
    anchors = ''.join('<a href="%s">link</a>' % link for link in (links or []))
    return '<html><head><title>%s</title>%s</head><body><h1>%s</h1>%s%s</body></html>' % (
        title,
        extra_head,
        title,
        body,
        anchors,
    )


FILLER = {
    'roads': 'The authority maintains more than four hundred structures across the region and publishes inspection summaries every spring.',
    'engineer': 'Our magazine covers structural design, materials science and the people who keep large structures standing for decades.',
    'news': 'The newsroom has covered the harbour district since the nineteen fifties and runs a weekly column on local landmarks.',
    'society': 'The society was founded by volunteers who catalogue landmarks, collect photographs and give guided walks every month.',
    'blog': 'This hobby blog shares photographs of spans and viaducts that its author has visited over the years.',
}


def standard_web() -> Dict[str, Any]:
    """Four supporting pages from four unrelated publishers and one contradicting blog."""
    return {
        URL_ROADS: (200, page(SUPPORT_ROADS, FILLER['roads'], title='Meridian Bridge')),
        URL_ENGINEER: (200, page(SUPPORT_ENGINEER, FILLER['engineer'], title='Meridian Bridge feature')),
        URL_NEWS: (200, page(SUPPORT_NEWS, FILLER['news'], title='Meridian Bridge explained')),
        URL_SOCIETY: (200, page(SUPPORT_SOCIETY, FILLER['society'], title='Landmark record')),
        URL_BLOG: (200, page(CONTRADICTION_BLOG, FILLER['blog'], title='Span fan')),
    }


# ------------------------------------------------------------------------------------- models


def answer(source_id: str, stance: str, excerpt: str = '', reason: str = 'because') -> Dict[str, str]:
    return {'id': source_id, 'stance': stance, 'excerpt': excerpt, 'reason': reason}


def model_reply(items: List[Dict[str, str]]) -> Dict[str, Any]:
    """Shape a model reply the way the prompt asks for it."""
    return {'sources': items}


def fixed_llm(reply: Any) -> Callable[[str], Any]:
    """A model that ignores the prompt and always gives the same answer."""

    def respond(prompt: str) -> Any:
        return reply

    return respond


def blocks_of(prompt: str) -> Dict[str, str]:
    """The source windows a prompt shows, by source id."""
    found: Dict[str, str] = {}
    marker = '=== BEGIN SOURCE '
    position = 0
    while True:
        start = prompt.find(marker, position)
        if start == -1:
            return found
        head_end = prompt.index(' (untrusted text) ===\n', start)
        source_id = prompt[start + len(marker):head_end]
        body_start = head_end + len(' (untrusted text) ===\n')
        body_end = prompt.index('\n=== END SOURCE ' + source_id + ' ===', body_start)
        found[source_id] = prompt[body_start:body_end]
        position = body_end


def claim_of(prompt: str) -> str:
    start = prompt.index('=== BEGIN CLAIM (untrusted) ===\n') + len('=== BEGIN CLAIM (untrusted) ===\n')
    return prompt[start:prompt.index('\n=== END CLAIM ===')]


def anchors_of(prompt: str) -> List[List[str]]:
    tail = prompt.split('ANCHORS (specifics a supporting excerpt must show; alternatives are separated by |):\n', 1)[1]
    lines = []
    for line in tail.split('\n'):
        if not line.startswith('- '):
            break
        lines.append([part.strip() for part in line[2:].split(' | ')])
    return lines


def ideal_llm(prompt: str) -> Dict[str, Any]:
    """
    A careful stand-in for a good model. For every source window it finds the sentence about the
    claim's first anchor and classifies it: all anchors shown -> SUPPORTS; an explicit negation or a
    different figure for the same quantity -> CONTRADICTS; the subject without the specifics ->
    QUALIFIES; nothing -> SILENT. It reads only the prompt, like a real model would.
    """
    groups = anchors_of(prompt)
    subjects = [spelling.casefold() for spelling in groups[0]]
    items = []
    for source_id, window in blocks_of(prompt).items():
        sentences = [s.strip() for s in window.replace('\n', ' ').split('. ') if s.strip()]
        picked: Optional[str] = None
        stance = 'SILENT'
        for sentence in sentences:
            lowered = sentence.casefold()
            if not any(subject in lowered for subject in subjects):
                continue
            shown = all(any(spelling.casefold() in lowered for spelling in group) for group in groups)
            if shown and not any(word in lowered for word in (' not ', 'contrary', 'myth', 'false')):
                picked, stance = sentence, 'SUPPORTS'
                break
            if any(word in lowered for word in (' not ', 'contrary', 'myth', 'false', 'only')):
                picked, stance = sentence, 'CONTRADICTS'
                break
            if picked is None:
                picked, stance = sentence, 'QUALIFIES'
        items.append(answer(source_id, stance, picked or '', 'ideal'))
    return model_reply(items)


# -------------------------------------------------------------------------------------- world


class World:
    """One deployed contract, a controllable clock, and a network of nodes."""

    def __init__(
        self,
        web: Optional[Dict[str, Any]] = None,
        llm: Optional[Callable[[str], Any]] = None,
        validators: int = 4,
    ) -> None:
        self.module = load_contract_module()
        self.contract = self.module.Triangulate()
        self.web: Dict[str, Any] = web if web is not None else standard_web()
        self.llm = llm if llm is not None else ideal_llm
        self.validators = validators
        self._clock = calendar.timegm((2026, 10, 26, 10, 0, 0))
        self.last_prompts: List[str] = []
        self.last_requests: List[str] = []
        self.last_rounds: List[List[bool]] = []

    # ------------------------------------------------------------------ clock

    def advance(self, seconds: int) -> None:
        self._clock += seconds

    def _stamp(self) -> str:
        return time.strftime('%Y-%m-%dT%H:%M:%S', time.gmtime(self._clock)) + '.000000Z'

    @property
    def now(self) -> int:
        return self._clock

    # ---------------------------------------------------------------- execution

    def tx(
        self,
        method: str,
        *args: Any,
        sender: Address = ALICE,
        web: Optional[Dict[str, Any]] = None,
        llm: Optional[Callable[[str], Any]] = None,
        validator_envs: Optional[List[Env]] = None,
    ) -> Any:
        """Run a write method as a transaction. On any exception the storage is rolled back."""
        self.advance(30)
        RUNTIME.reset()
        leader = Env(web if web is not None else self.web, llm if llm is not None else self.llm)
        RUNTIME.env = leader
        RUNTIME.validator_envs = validator_envs if validator_envs is not None else [leader] * self.validators
        gensim.GL.message = Message(sender, CONTRACT)
        gensim.GL.message_raw = {'datetime': self._stamp()}

        before = gensim.snapshot(self.contract)
        try:
            return getattr(self.contract, method)(*args)
        except BaseException:
            gensim.restore(self.contract, before)
            raise
        finally:
            self.last_prompts = list(RUNTIME.prompts)
            self.last_requests = list(RUNTIME.requests)
            self.last_rounds = [list(votes) for votes in RUNTIME.rounds]

    def view(self, method: str, *args: Any) -> Any:
        RUNTIME.reset()
        gensim.GL.message = Message(ALICE, CONTRACT)
        gensim.GL.message_raw = {'datetime': self._stamp()}
        return getattr(self.contract, method)(*args)

    def jview(self, method: str, *args: Any) -> Any:
        return json.loads(self.view(method, *args))

    # ---------------------------------------------------------------- shortcuts

    def open(self, **overrides: Any) -> str:
        params = {
            'title': TITLE,
            'statement': STATEMENT,
            'topic': 'society',
            'anchors_json': ANCHORS_JSON,
        }
        params.update(overrides)
        sender = params.pop('sender', ALICE)
        return self.tx('open_claim', params['title'], params['statement'], params['topic'], params['anchors_json'], sender=sender)

    def add(self, claim_id: str, url: str, sender: Address = ALICE) -> str:
        return self.tx('add_source', claim_id, url, sender=sender)

    def claim_with(self, urls: List[str], sender: Address = ALICE) -> str:
        claim_id = self.open(sender=sender)
        for url in urls:
            self.add(claim_id, url, sender=sender)
        return claim_id

    def examine(self, claim_id: str, **kwargs: Any) -> str:
        return self.tx('examine', claim_id, **kwargs)

    def claim(self, claim_id: str) -> Dict[str, Any]:
        return self.jview('get_claim_bundle', claim_id)['claim']

    def exam(self, exam_id: str) -> Dict[str, Any]:
        return self.jview('get_examination_bundle', exam_id)['examination']


def expect_user_error(test: Any, fragment: str) -> Any:
    """assertRaises for UserError, also checking the message."""

    class _Context:
        def __enter__(self) -> '_Context':
            return self

        def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> bool:
            test.assertIsNotNone(exc_type, 'expected the call to be rejected')
            test.assertTrue(issubclass(exc_type, UserError), 'expected UserError, got %r' % (exc,))
            test.assertIn(fragment.lower(), exc.message.lower())
            return True

    return _Context()


MODULE = load_contract_module()
