import { useRef, useState } from 'preact/hooks';
import type { Basis, Profile, WorkoutBlock } from '../engine/types';
import { flattenSteps, flattenStepsWithSets, stepTip } from '../engine/workout';
import { powerZone } from '../engine/zones';

export const ZONE_VAR = ['var(--z1)', 'var(--z2)', 'var(--z3)', 'var(--z4)', 'var(--z5)', 'var(--z6)', 'var(--z7)'];

/**
 * The zone-coloured silhouette of a workout. Width is time, height is intensity.
 * Used at every size from a calendar chip to the Today hero; `hero` adds the one
 * animated reveal in the app.
 *
 * `targets` (Batch 7, B): moving the pointer across the diagram shows a label
 * with what that moment of the ride asks for, the step's name, time, share of
 * FTP, watts and heart rate, from the rider's own tables (the same numbers as
 * the steps table), the rider's basis in full and the other in grey. With
 * `touch`, pressing and sliding does the same on a phone. Without `targets` the
 * diagram is exactly as it always was.
 */
export function WorkoutProfile({ blocks, height = 72, hero = false, ratio = 6, targets }: { blocks: WorkoutBlock[]; height?: number; hero?: boolean; ratio?: number; targets?: { profile: Profile; basis: Basis; touch?: boolean } }) {
  const steps = flattenSteps(blocks);
  const total = steps.reduce((s, st) => s + st.seconds, 0) || 1;
  const H = height;
  const W = Math.round(H * ratio);
  const maxI = Math.max(1.25, ...steps.map((s) => s.intensityHigh ?? s.intensity));
  const [on, setOn] = useState<{ i: number; x: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  let x = 0;
  const rects = steps.map((st, i) => {
    const w = (st.seconds / total) * W;
    const top = Math.max(st.intensity, st.intensityHigh ?? 0);
    const h = Math.max(2, (top / maxI) * H);
    const r = <rect key={i} class={on?.i === i ? 'on' : undefined} x={x} y={H - h} width={Math.max(w, 0.6)} height={h} fill={ZONE_VAR[powerZone(st.intensity) - 1]} style={hero ? { animationDelay: `${Math.min(i, 40) * 8}ms` } : undefined} />;
    x += w;
    return r;
  });

  // Which step is under the pointer: its place along the ride, by time, over the diagram's width.
  function pick(clientX: number) {
    const el = box.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width <= 0) return;
    const px = Math.max(0, Math.min(r.width, clientX - r.left));
    const at = (px / r.width) * total;
    let acc = 0, i = 0;
    for (; i < steps.length - 1; i++) { acc += steps[i].seconds; if (at < acc) break; }
    setOn({ i, x: px });
  }
  const handlers = targets ? {
    onPointerMove: (e: PointerEvent) => { if (e.pointerType === 'mouse' || targets.touch) pick(e.clientX); },
    onPointerDown: (e: PointerEvent) => { if (targets.touch && e.pointerType !== 'mouse') pick(e.clientX); },
    onPointerLeave: () => setOn(null),
    onPointerCancel: () => setOn(null),
    onPointerUp: (e: PointerEvent) => { if (e.pointerType !== 'mouse') setOn(null); },
  } : {};

  const tip = targets && on ? (() => {
    const withSets = flattenStepsWithSets(blocks);
    const s = withSets[on.i];
    if (!s) return null;
    const t = stepTip(s.step, s.set, targets.profile);
    const width = box.current?.getBoundingClientRect().width ?? 0;
    // Above the pointer, kept inside the diagram: anchored left near the start, right near the end.
    const side = on.x < width * 0.25 ? 'left' : on.x > width * 0.75 ? 'right' : 'center';
    const style = side === 'left' ? { left: `${Math.max(0, on.x - 12)}px` } : side === 'right' ? { right: `${Math.max(0, width - on.x - 12)}px` } : { left: `${on.x}px`, transform: 'translateX(-50%)' };
    return (
      <div class="profile-tip" style={style} role="status">
        <div class="pt-title"><span class="z" style={`background:${ZONE_VAR[t.zone - 1]}`} />{t.title}</div>
        <div class="pt-line"><span>{t.time}</span><span>{t.share} of FTP</span></div>
        <div class="pt-line"><span class={targets.basis === 'power' ? '' : 'faint'}>{t.watts}</span><span class={targets.basis === 'hr' ? '' : 'faint'}>{t.bpm}</span></div>
      </div>
    );
  })() : null;

  return (
    <div class={`profile${hero ? ' hero' : ''}${targets ? ' has-tip' : ''}${targets?.touch ? ' touch' : ''}`} ref={box} {...handlers}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        {/* threshold line */}
        <line x1="0" x2={W} y1={H - (1 / maxI) * H} y2={H - (1 / maxI) * H} stroke="var(--line-2)" stroke-dasharray="3 4" />
        {rects}
      </svg>
      {tip}
    </div>
  );
}
