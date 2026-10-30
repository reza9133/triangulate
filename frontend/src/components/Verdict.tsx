import { STANCE_TONE, verdictMeta, type Tone } from '../lib/format';

export function Chip({
  tone,
  children,
  title,
  dot = true,
}: {
  tone: Tone;
  children: React.ReactNode;
  title?: string;
  dot?: boolean;
}) {
  return (
    <span className={`chip tone-${tone}${dot ? '' : ' nodot'}`} title={title}>
      {children}
    </span>
  );
}

export function VerdictChip({ verdict }: { verdict: string }) {
  const meta = verdictMeta(verdict);
  return (
    <Chip tone={meta.tone} title={meta.meaning}>
      {meta.label}
    </Chip>
  );
}

export function StanceChip({ stance }: { stance: string }) {
  const tone = (STANCE_TONE as Record<string, Tone>)[stance] ?? 'muted';
  return <Chip tone={tone}>{stance.toLowerCase()}</Chip>;
}

export function StatusChip({ status }: { status: string }) {
  return <Chip tone={status === 'OPEN' ? 'info' : 'muted'}>{status.toLowerCase()}</Chip>;
}
