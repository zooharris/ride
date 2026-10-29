/**
 * The Antogo logo as SVG, so it is crisp at every size and needs no font
 * download. Drawn from the approved files in art/antogo/ (Oct 2026): the 2F2
 * rider (teal rear wheel, blue back and front wheel, orange head) and the
 * "antógo" wordmark in Figtree Black outlines, "anto" in ink, "go" in blue,
 * with an orange acute over the first o. The acute lives only in these
 * pictures: everything typed says "Antogo". Colours come from the --logo-*
 * variables, so the logo adapts to the light and dark themes. `mono` draws
 * it in currentColor.
 */
import { ACUTE, ANTO, BACK, FRONT, GO, HEAD, REAR, TAG_BELOW, TAG_BESIDE, WORD_W } from './brandPaths';
import { APP_NAME } from '../appName';

const C = {
  teal: 'var(--logo-teal, #00B5DB)',
  blue: 'var(--logo-blue, #0575F6)',
  orange: 'var(--logo-orange, #FD8C23)',
  anto: 'var(--logo-anto, #0A2552)',
  go: 'var(--logo-go, #0575F6)',
  tag: 'var(--logo-tag, #5A6A85)',
};
const MONO = { teal: 'currentColor', blue: 'currentColor', orange: 'currentColor', anto: 'currentColor', go: 'currentColor', tag: 'currentColor' };
type Colours = typeof C;

/** The rider's shapes in its own units (box x 100–330, y 15–133). `thick` adds an outline so the thin tails survive small sizes. */
function Rider({ c, thick }: { c: Colours; thick: number }) {
  const st = (col: string) => (thick ? { stroke: col, 'stroke-width': thick, 'stroke-linejoin': 'round' as const } : {});
  return (
    <>
      <path d={REAR} fill={c.teal} {...st(c.teal)} />
      <path d={BACK} fill={c.blue} {...st(c.blue)} />
      <path d={FRONT} fill={c.blue} {...st(c.blue)} />
      <circle cx={HEAD.cx} cy={HEAD.cy} r={HEAD.r + thick * 0.6} fill={c.orange} />
    </>
  );
}

/** "antógo" in its own units: baseline at 0, x from 0 to WORD_W. */
function Word({ c }: { c: Colours }) {
  return (
    <>
      <path d={ANTO} fill={c.anto} />
      <path d={GO} fill={c.go} />
      <path d={ACUTE} fill={c.orange} stroke={c.orange} stroke-width="16" stroke-linejoin="round" />
    </>
  );
}

const MARK_ASPECT = 232 / 120;

/** The rider alone; `size` is its height (its width is about twice that). */
export function Mark({ size = 24, title = APP_NAME, mono = false }: { size?: number; title?: string; mono?: boolean }) {
  return (
    <svg viewBox="99 14 232 120" width={size * MARK_ASPECT} height={size} role="img" aria-label={title || undefined} aria-hidden={title ? undefined : true} style={{ display: 'block', flex: `0 0 ${size * MARK_ASPECT}px` }}>
      <Rider c={mono ? MONO : C} thick={size <= 48 ? 2.2 : 0} />
    </svg>
  );
}

// The horizontal lockup, in wordmark units (as antogo-logo-*.svg): the rider at
// 5.6×, a gap, then the wordmark; its top is at y −800, the baseline at 0.
const SC = 5.6, MW = 230 * SC, GAP = 110, WX = MW + GAP, RIGHT = WX + WORD_W;
const TAG_SIZE = 0.29;                           // the tag beneath: 290 units, right-aligned under the wordmark
const BESIDE_SIZE = 0.44, DIV_X = RIGHT + 170;   // the tag beside: after a thin divider
const BESIDE_X = DIV_X + 190;

/**
 * The rider and wordmark side by side; `height` is the whole picture's height.
 * `tag` adds "CYCLING": "below" (sidebar, ride player) or "beside", after a
 * thin divider (the phone's top bar, where there is width but no height).
 */
export function Logo({ height = 26, tag, mono = false }: { height?: number; tag?: 'below' | 'beside'; mono?: boolean }) {
  const c = mono ? MONO : C;
  let w = RIGHT + 60, h = 1030, extra = null;
  if (tag === 'below') {
    h = 1370;
    extra = <path d={TAG_BELOW.d} fill={c.tag} transform={`translate(${RIGHT - TAG_BELOW.w * TAG_SIZE} 520) scale(${TAG_SIZE})`} />;
  } else if (tag === 'beside') {
    h = 1050; w = BESIDE_X + TAG_BESIDE.w * BESIDE_SIZE + 60;
    extra = (
      <>
        <rect x={DIV_X} y={-600} width={22} height={700} rx={11} fill={c.tag} opacity={0.55} />
        <path d={TAG_BESIDE.d} fill={c.tag} transform={`translate(${BESIDE_X} -96) scale(${BESIDE_SIZE})`} />
      </>
    );
  }
  return (
    <svg viewBox={`-20 -800 ${w} ${h}`} width={(height * w) / h} height={height} role="img" aria-label={APP_NAME} style={{ display: 'block', overflow: 'visible' }}>
      <g transform={`translate(0 -560) scale(${SC}) translate(-100 -15)`}><Rider c={c} thick={2.2} /></g>
      <g transform={`translate(${WX} 0)`}><Word c={c} /></g>
      {extra}
    </svg>
  );
}

// The stacked lockup (as antogo-logo-stacked-tagline.svg, without the tagline,
// which is set as text beneath): the rider above, the wordmark, "CYCLING".
const ST_SC = 8.7, ST_MX = WORD_W * 0.17, ST_TOP = -880 - 118 * ST_SC + 40, ST_TAG = 0.21;

/** The stacked logo for the welcome screen and Help › About; `width` is the picture's width. */
export function StackedLogo({ width = 220 }: { width?: number }) {
  const w = 3250, h = 580 - ST_TOP;
  return (
    <svg viewBox={`-60 ${ST_TOP} ${w} ${h}`} width={width} height={(width * h) / w} role="img" aria-label={APP_NAME} style={{ display: 'block' }}>
      <g transform={`translate(${ST_MX} ${-880 - 118 * ST_SC + 60}) scale(${ST_SC}) translate(-100 -15)`}><Rider c={C} thick={0} /></g>
      <Word c={C} />
      <path d={TAG_BELOW.d} fill={C.tag} transform={`translate(${WORD_W / 2 - (TAG_BELOW.w * ST_TAG) / 2} 520) scale(${ST_TAG})`} />
    </svg>
  );
}
