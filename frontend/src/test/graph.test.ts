import { describe, expect, it } from 'vitest';

import {
  VERDICT_META,
  formatDuration,
  formatTime,
  relativeTime,
  shortAddress,
  verdictMeta,
} from '../lib/format';
import { layoutGraph } from '../lib/graphLayout';
import { VERDICTS, type OriginGroup } from '../lib/types';

const origins: OriginGroup[] = [
  { origin_id: 'O1', sources: ['S1', 'S2'], stance: 'SUPPORTS' },
  { origin_id: 'O2', sources: ['S3'], stance: 'SILENT' },
  { origin_id: 'O3', sources: ['S4', 'S5', 'S6'], stance: 'CONTRADICTS' },
];

describe('layoutGraph', () => {
  it('places every source exactly once and is deterministic', () => {
    const a = layoutGraph(origins);
    const b = layoutGraph(origins);
    expect(a).toEqual(b);
    expect(a.nodes.map((n) => n.id).sort()).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S6']);
    expect(a.hulls).toHaveLength(3);
  });
  it('keeps members inside their origin bubble and inside the canvas', () => {
    const layout = layoutGraph(origins);
    for (const node of layout.nodes) {
      const hull = layout.hulls.find((h) => h.origin === node.origin)!;
      expect(Math.hypot(node.x - hull.x, node.y - hull.y)).toBeLessThanOrEqual(hull.r);
      expect(node.x).toBeGreaterThan(0);
      expect(node.x).toBeLessThan(layout.width);
      expect(node.y).toBeGreaterThan(0);
      expect(node.y).toBeLessThan(layout.height);
    }
  });
  it('handles an empty and a single-origin graph', () => {
    expect(layoutGraph([]).nodes).toEqual([]);
    expect(layoutGraph([origins[1]!]).nodes).toHaveLength(1);
  });
});

describe('format', () => {
  it('describes every verdict the contract can issue', () => {
    for (const verdict of VERDICTS) {
      expect(VERDICT_META[verdict].meaning.length).toBeGreaterThan(10);
    }
    expect(verdictMeta('UNEXAMINED').tone).toBe('muted');
    expect(verdictMeta('SOMETHING_NEW').label).toBe('SOMETHING_NEW');
  });
  it('formats addresses, times and durations', () => {
    expect(shortAddress('0xE6b7836F8b8F15C4c2a369bF986845Ccb9917EC5')).toBe('0xE6b7…7EC5');
    expect(formatTime(0)).toBe('—');
    expect(formatTime(1_700_000_000)).toBe('2023-11-14 22:13 UTC');
    expect(formatDuration(3600)).toBe('1 hour');
    expect(formatDuration(7200)).toBe('2 hours');
    expect(formatDuration(90)).toBe('90 seconds');
    expect(relativeTime(0)).toBe('never');
    expect(relativeTime(1000, 1000 * 1000 + 5000 * 1000)).toBe('1 h ago');
  });
});
