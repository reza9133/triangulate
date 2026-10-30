import { motion } from 'framer-motion';

import { EDGE_EXPLAIN, EDGE_LABEL, STANCE_TONE, type Tone } from '../lib/format';
import { layoutGraph } from '../lib/graphLayout';
import type { EchoEdge, EdgeKind, Finding, OriginGroup } from '../lib/types';

const DASH: Record<EdgeKind, string | undefined> = {
  SAME_ORIGIN: undefined,
  CITES: '7 5',
  NEAR_COPY: '2 5',
  SHARED_PASSAGE: '10 4 2 4',
};
const EDGE_TONE: Record<EdgeKind, string> = {
  SAME_ORIGIN: 'var(--accent)',
  CITES: 'var(--info)',
  NEAR_COPY: 'var(--warn)',
  SHARED_PASSAGE: 'var(--mixed)',
};

const toneVar = (tone: Tone): string => `var(--${tone === 'muted' ? 'muted' : tone})`;

/** The echo graph of one examination: sources as nodes, echo edges between them, origins as bubbles. */
export function EchoGraph({
  origins,
  edges,
  findings,
}: {
  origins: OriginGroup[];
  edges: EchoEdge[];
  findings: Finding[];
}) {
  const layout = layoutGraph(origins);
  const at = new Map(layout.nodes.map((node) => [node.id, node]));
  const stance = new Map(findings.map((finding) => [finding.source_id, finding.stance]));
  const kinds = [...new Set(edges.map((edge) => edge.kind))];

  return (
    <figure style={{ margin: 0 }}>
      <svg
        className="graph"
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        role="img"
        aria-label={`Echo graph with ${layout.nodes.length} sources in ${origins.length} origins`}
      >
        <defs>
          <marker
            id="arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0 0 L10 5 L0 10 z" fill="var(--info)" />
          </marker>
        </defs>
        {layout.hulls.map((hull, index) => {
          const origin = origins[index];
          const tone = origin ? toneVar(STANCE_TONE[origin.stance]) : 'var(--muted)';
          return (
            <motion.g
              key={hull.origin}
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: index * 0.12, type: 'spring', stiffness: 120, damping: 16 }}
              style={{ transformOrigin: `${hull.x}px ${hull.y}px` }}
            >
              <circle
                cx={hull.x}
                cy={hull.y}
                r={hull.r}
                fill={tone}
                fillOpacity={0.08}
                stroke={tone}
                strokeWidth={1.5}
                strokeDasharray="4 4"
              />
              <text
                x={hull.x}
                y={hull.y - hull.r - 8}
                textAnchor="middle"
                style={{ fill: tone, fontWeight: 700 }}
              >
                {hull.origin} · {origin?.stance.toLowerCase()}
              </text>
            </motion.g>
          );
        })}
        {edges.map((edge, index) => {
          const a = at.get(edge.a);
          const b = at.get(edge.b);
          if (!a || !b) return null;
          // Edges inside a single-source bubble cannot occur; parallel edges are offset so each stays visible.
          const offset =
            edges.filter(
              (other, i) =>
                i < index &&
                ((other.a === edge.a && other.b === edge.b) || (other.a === edge.b && other.b === edge.a)),
            ).length * 5;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const length = Math.hypot(dx, dy) || 1;
          const nx = (-dy / length) * offset;
          const ny = (dx / length) * offset;
          return (
            <motion.line
              key={`${edge.a}-${edge.b}-${edge.kind}`}
              x1={a.x + nx}
              y1={a.y + ny}
              x2={b.x + nx}
              y2={b.y + ny}
              stroke={EDGE_TONE[edge.kind]}
              strokeWidth={2}
              strokeDasharray={DASH[edge.kind]}
              markerEnd={edge.kind === 'CITES' ? 'url(#arrow)' : undefined}
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 0.9 }}
              transition={{ delay: 0.4 + index * 0.08, duration: 0.6 }}
            />
          );
        })}
        {layout.nodes.map((node, index) => {
          const s = stance.get(node.id);
          const tone = s ? toneVar(STANCE_TONE[s]) : 'var(--muted)';
          return (
            <motion.g
              key={node.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + index * 0.07 }}
            >
              <circle cx={node.x} cy={node.y} r={15} fill="var(--surface)" stroke={tone} strokeWidth={3} />
              <text x={node.x} y={node.y + 4} textAnchor="middle" style={{ fontWeight: 700 }}>
                {node.id}
              </text>
            </motion.g>
          );
        })}
      </svg>
      <figcaption className="legend" style={{ marginTop: 12 }}>
        {kinds.length === 0 ? <span>No echo edges: every source is its own voice.</span> : null}
        {kinds.map((kind) => (
          <span key={kind} title={EDGE_EXPLAIN[kind]} style={{ ['--c' as string]: EDGE_TONE[kind] }}>
            <i style={{ borderTopStyle: DASH[kind] ? 'dashed' : 'solid' }} /> {EDGE_LABEL[kind]}
          </span>
        ))}
        <span className="muted">node ring colour = stance</span>
      </figcaption>
    </figure>
  );
}
