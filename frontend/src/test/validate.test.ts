import { describe, expect, it } from 'vitest';

import { suggestAnchors } from '../lib/suggest';
import { checkClaim, hasTerm, norm, quickUrlProblem, stems } from '../lib/validate';
import { TOPICS } from '../lib/types';

const base = {
  title: 'Speed of light',
  statement: 'The speed of light in vacuum is exactly 299,792,458 metres per second.',
  topic: 'science',
  anchors: [
    { id: 'a', spellings: ['speed of light'] },
    { id: 'b', spellings: ['299,792,458', '299 792 458'] },
  ],
};

describe('hasTerm', () => {
  it('matches whole tokens only', () => {
    expect(hasTerm('height 18,848.86 m', '8,848.86')).toBe(false);
    expect(hasTerm('height 8,848.86m', '8,848.86')).toBe(true);
    expect(hasTerm('year 12019', '2019')).toBe(false);
    expect(hasTerm('born in 2019.', '2019')).toBe(true);
    expect(hasTerm('theapache license', 'apache')).toBe(false);
  });
});

describe('norm', () => {
  it('folds typography, whitespace and case', () => {
    expect(norm('  Don’t   STOP—now ')).toBe("don't stop-now");
  });
});

describe('checkClaim', () => {
  it('accepts a good claim and writes anchors_json the contract understands', () => {
    const result = checkClaim(base, TOPICS);
    expect(result.ok).toBe(true);
    expect(JSON.parse(result.anchorsJson)).toEqual(['speed of light', ['299,792,458', '299 792 458']]);
  });
  it('requires the first spelling to occur in the statement', () => {
    const result = checkClaim({ ...base, anchors: [{ id: 'a', spellings: ['Eiffel Tower'] }] }, TOPICS);
    expect(result.ok).toBe(false);
    expect(result.errors.anchorRows.a).toMatch(/must occur in the statement/);
  });
  it('rejects generic, duplicate and missing anchors', () => {
    expect(
      checkClaim({ ...base, anchors: [{ id: 'a', spellings: ['the'] }] }, TOPICS).errors.anchorRows.a,
    ).toMatch(/too generic/);
    expect(
      checkClaim(
        {
          ...base,
          anchors: [
            { id: 'a', spellings: ['299,792,458'] },
            { id: 'b', spellings: ['299,792,458'] },
          ],
        },
        TOPICS,
      ).errors.anchorRows.b,
    ).toMatch(/Duplicate anchor/);
    expect(checkClaim({ ...base, anchors: [] }, TOPICS).errors.anchors).toMatch(/at least one anchor/);
    expect(checkClaim({ ...base, anchors: [{ id: 'a', spellings: ['  '] }] }, TOPICS).ok).toBe(false);
  });
  it('rejects duplicate spellings and too many alternatives', () => {
    expect(
      checkClaim({ ...base, anchors: [{ id: 'a', spellings: ['speed of light', 'Speed of Light'] }] }, TOPICS)
        .errors.anchorRows.a,
    ).toMatch(/Duplicate spelling/);
    expect(
      checkClaim(
        { ...base, anchors: [{ id: 'a', spellings: ['speed of light', 'a1', 'b2', 'c3', 'd4'] }] },
        TOPICS,
      ).errors.anchorRows.a,
    ).toMatch(/At most/);
  });
  it('checks title, statement length and distinctive content', () => {
    expect(checkClaim({ ...base, title: 'ab' }, TOPICS).errors.title).toBeDefined();
    expect(checkClaim({ ...base, statement: 'Too short.' }, TOPICS).errors.statement).toMatch(/at least 20/);
    expect(checkClaim({ ...base, statement: 'x'.repeat(401) }, TOPICS).errors.statement).toMatch(
      /limited to 400/,
    );
    expect(
      checkClaim(
        {
          ...base,
          statement: 'It is what it is and so on and so on',
          anchors: [{ id: 'a', spellings: ['so on'] }],
        },
        TOPICS,
      ).errors.statement,
    ).toMatch(/too little/);
    expect(checkClaim({ ...base, topic: 'nope' }, TOPICS).errors.topic).toBeDefined();
  });
});

describe('stems', () => {
  it('keeps numbers and cuts words to five letters', () => {
    expect([...stems('Metres per second 299,792,458')].sort()).toEqual(
      ['299,792,458', 'metre', 'secon'].sort(),
    );
  });
});

describe('quickUrlProblem', () => {
  it('flags the obvious problems before asking the contract', () => {
    expect(quickUrlProblem('')).not.toBe('');
    expect(quickUrlProblem('http://a.org/x')).toMatch(/https/);
    expect(quickUrlProblem('https://a.org/x y')).toMatch(/spaces/);
    expect(quickUrlProblem('https://a.org/x#frag')).toMatch(/fragment/);
    expect(quickUrlProblem('https://a.org/x')).toBe('');
  });
});

describe('suggestAnchors', () => {
  it('finds numbers and names in a statement', () => {
    expect(suggestAnchors('Mount Everest is 8,848.86 m high according to Nepal and China.')).toEqual([
      'Mount Everest',
      '8,848.86',
      'Nepal',
      'China',
    ]);
  });
  it('skips a capitalised first word', () => {
    expect(suggestAnchors('The speed of light is 299792458 m/s')).toEqual(['299792458']);
  });
});
