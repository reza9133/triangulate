import type { OriginGroup } from './types';

export interface GraphNode {
  id: string;
  x: number;
  y: number;
  origin: string;
}

export interface GraphHull {
  origin: string;
  x: number;
  y: number;
  r: number;
}

export interface GraphLayout {
  width: number;
  height: number;
  nodes: GraphNode[];
  hulls: GraphHull[];
}

/**
 * A deterministic layout of the echo graph: every origin is a bubble on a ring, and the sources of
 * one origin sit inside their bubble. Pure, so it can be tested and never jitters between renders.
 */
export function layoutGraph(origins: OriginGroup[], width = 720, height = 420): GraphLayout {
  const cx = width / 2;
  const cy = height / 2;
  const count = origins.length;
  const ring = count <= 1 ? 0 : Math.min(width, height) * 0.3;
  const nodes: GraphNode[] = [];
  const hulls: GraphHull[] = [];
  origins.forEach((origin, index) => {
    const angle = count <= 1 ? 0 : -Math.PI / 2 + (index / count) * Math.PI * 2;
    const ox = cx + Math.cos(angle) * ring * 1.35;
    const oy = cy + Math.sin(angle) * ring;
    const members = origin.sources.length;
    const radius = members <= 1 ? 30 : 28 + members * 14;
    hulls.push({ origin: origin.origin_id, x: ox, y: oy, r: radius });
    origin.sources.forEach((id, memberIndex) => {
      if (members <= 1) {
        nodes.push({ id, x: ox, y: oy, origin: origin.origin_id });
        return;
      }
      const a = -Math.PI / 2 + (memberIndex / members) * Math.PI * 2;
      nodes.push({
        id,
        x: ox + Math.cos(a) * (radius - 24),
        y: oy + Math.sin(a) * (radius - 24),
        origin: origin.origin_id,
      });
    });
  });
  return { width, height, nodes, hulls };
}
