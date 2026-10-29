"""
Offline bridge used by tests/node/offline-chain.mjs.

It runs the REAL contract code on the in-process GenVM simulator and answers JSON requests, one per
line, on stdin/stdout. Together with the offline chain module it lets scripts/e2e.mjs execute its
whole flow (transactions, receipts, refusals, scenarios, report) with no network access.

The simulated internet serves a small synthetic page for every URL in scenarios/scenarios.json.
"""

import json
import sys

from gensim import NoConsensus, UserError
from support import ROOT, World, ideal_llm, page, Address

SCENARIOS = json.loads((ROOT / 'scenarios' / 'scenarios.json').read_text(encoding='utf-8'))['scenarios']

PAGES = {
    'https://en.wikipedia.org/wiki/Speed_of_light': (200, page(
        'The speed of light in vacuum is exactly 299,792,458 metres per second.',
        'It is a universal physical constant used throughout physics and engineering, and it is usually denoted by the letter c.',
        title='Speed of light')),
    'https://physics.nist.gov/cgi-bin/cuu/Value?c': (200, page(
        'Fundamental physical constants: the speed of light in vacuum has the value 299 792 458 m s-1 and is exact.',
        'This database lists recommended values of constants together with their standard uncertainties.',
        title='NIST constants')),
    'https://www.bipm.org/en/si-base-units/metre': (200, page(
        'The metre is defined by taking the fixed numerical value of the speed of light in vacuum c to be 299 792 458 when expressed in the unit m s-1.',
        'The International Bureau of Weights and Measures maintains the brochure that describes the system.',
        title='SI base unit: metre')),
    'https://github.com/psf/requests': (200, page(
        'Requests is a simple HTTP library for Python, released under the Apache-2.0 license.',
        'Repository pages list stars, forks, contributors and recent commits for the project.',
        title='psf/requests')),
    'https://raw.githubusercontent.com/psf/requests/main/LICENSE': (200,
        'Apache License Version 2.0, January 2004 http://www.apache.org/licenses/ TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION'),
    'https://simple.wikipedia.org/wiki/Speed_of_light': (200, page(
        'In a vacuum, light travels at 299,792,458 metres per second, which is very fast indeed.',
        'The simple English edition explains science topics with short sentences.',
        title='Speed of light')),
    'https://en.wikipedia.org/wiki/Great_Wall_of_China': (200, page(
        'It is a myth that the Great Wall is visible to the naked eye from the Moon.',
        'The wall is long but narrow, and astronauts report that it is hard to see even from low orbit.',
        title='Great Wall of China')),
    'https://www.universetoday.com/articles/can-you-see-the-great-wall-of-china-from-space': (200, page(
        'The Apollo astronauts confirmed that you can not see the Great Wall of China from the Moon with the naked eye.',
        'The article looks at where the legend began and why it persisted for so long.',
        title='Can you see the Great Wall of China from space?')),
    'https://www.bipm.org/en/measurement-units/si-base-units/metre': (200, page(
        'The metre is the length of the path travelled by light in vacuum during a time interval of 1/299 792 458 of a second.',
        'It is one of the seven base units of the International System of Units.',
        title='Metre')),
    'https://en.wikipedia.org/wiki/Metre': (200, page(
        'The metre is defined as the distance light travels in vacuum in 1/299,792,458 of a second.',
        'The unit was first defined in the eighteenth century in relation to the size of the Earth.',
        title='Metre')),
    'https://raw.githubusercontent.com/psf/requests/main/this-file-does-not-exist-triangulate.md': (404, '404: Not Found'),
}


def main() -> None:
    world = World(web=PAGES, llm=ideal_llm)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        request = json.loads(line)
        reply = {'id': request['id'], 'ok': True}
        try:
            op = request['op']
            if op == 'write':
                args = request.get('args', [])
                reply['result'] = world.tx(request['method'], *args, sender=Address(request['sender']))
            elif op == 'read':
                reply['result'] = world.view(request['method'], *request.get('args', []))
            elif op == 'page':
                entry = PAGES.get(request['url'])
                reply['result'] = {'status': entry[0], 'body': entry[1]} if entry else {'status': 404, 'body': ''}
            else:
                raise ValueError('unknown op %r' % op)
        except UserError as error:
            reply = {'id': request['id'], 'ok': False, 'kind': 'user', 'message': error.message}
        except NoConsensus as error:
            reply = {'id': request['id'], 'ok': False, 'kind': 'noconsensus', 'message': str(error)}
        except Exception as error:  # a bug in the contract or the bridge: report it loudly
            reply = {'id': request['id'], 'ok': False, 'kind': 'crash', 'message': '%s: %s' % (type(error).__name__, error)}
        sys.stdout.write(json.dumps(reply) + '\n')
        sys.stdout.flush()


if __name__ == '__main__':
    main()
