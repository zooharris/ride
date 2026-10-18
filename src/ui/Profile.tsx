import type { WorkoutBlock } from '../engine/types';
import { flattenSteps } from '../engine/workout';
import { powerZone } from '../engine/zones';

export const ZONE_VAR = ['var(--z1)', 'var(--z2)', 'var(--z3)', 'var(--z4)', 'var(--z5)', 'var(--z6)', 'var(--z7)'];

/**
 * The zone-coloured silhouette of a workout. Width is time, height is intensity.
 * Used at every size from a calendar chip to the Today hero; `hero` adds the one
 * animated reveal in the app.
 */
export function WorkoutProfile({ blocks, height = 72, hero = false, ratio = 6 }: { blocks: WorkoutBlock[]; height?: number; hero?: boolean; ratio?: number }) {
  const steps = flattenSteps(blocks);
  const total = steps.reduce((s, st) => s + st.seconds, 0) || 1;
  const H = height;
  const W = Math.round(H * ratio);
  const maxI = Math.max(1.25, ...steps.map((s) => s.intensityHigh ?? s.intensity));
  let x = 0;
  const rects = steps.map((st, i) => {
    const w = (st.seconds / total) * W;
    const top = Math.max(st.intensity, st.intensityHigh ?? 0);
    const h = Math.max(2, (top / maxI) * H);
    const r = <rect key={i} x={x} y={H - h} width={Math.max(w, 0.6)} height={h} fill={ZONE_VAR[powerZone(st.intensity) - 1]} style={hero ? { animationDelay: `${Math.min(i, 40) * 8}ms` } : undefined} />;
    x += w;
    return r;
  });
  return (
    <div class={`profile${hero ? ' hero' : ''}`}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        {/* threshold line */}
        <line x1="0" x2={W} y1={H - (1 / maxI) * H} y2={H - (1 / maxI) * H} stroke="var(--line-2)" stroke-dasharray="3 4" />
        {rects}
      </svg>
    </div>
  );
}
