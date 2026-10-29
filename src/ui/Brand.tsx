/**
 * The AntoVelo mark and wordmark as SVG, so they are crisp at every size and
 * need no font download. Rebuilt by hand from the approved design board
 * (Oct 2026): the A/V ribbon (blue A, navy-to-cyan fold, teal V) and the
 * orange dot; the wordmark is DM Sans Black outlines, "anto" in ink and
 * "velo" in brand blue. The gradient stops come from CSS variables so the
 * A stays bright on the dark theme. `mono` draws it in currentColor.
 */
import { useId } from 'preact/hooks';

const A = "M80 537Q62 537 70 522L352 72Q358 62 372 62L383 62L440 192L250 522Q243 534 230 537Z";
const NAVY = "M383 62L505 62Q520 62 527 76L757 522L622 528Z";
const CYAN = "M383 62L757 522Q760 530 748 530L628 530Q616 530 610 518L430 180Z";
const V = "M790 232L922 232Q936 232 929 244L762 518Q756 528 748 522L668 420L752 256Q764 232 790 232Z";
/** The mark's box in its own units; it is wider than tall. */
const MX = 58, MY = 58, MW = 882, MH = 484;
export const MARK_ASPECT = MW / MH;

/** The mark; `size` is its height (its width is about 1.8 times that). */
export function Mark({ size = 24, title = "AntoVelo", mono = false }: { size?: number; title?: string; mono?: boolean }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const stop = (o: number, v: string, d: string) => <stop offset={o} style={{ stopColor: `var(${v}, ${d})` }} />;
  const f = (g: string) => (mono ? 'currentColor' : `url(#${id}${g})`);
  return (
    <svg viewBox={`${MX} ${MY} ${MW} ${MH}`} width={size * MARK_ASPECT} height={size} role="img" aria-label={title || undefined} aria-hidden={title ? undefined : true} style={{ display: "block", flex: `0 0 ${size * MARK_ASPECT}px` }}>
      {!mono && (
        <defs>
          <linearGradient id={`${id}a`} x1="0" y1="62" x2="0" y2="537" gradientUnits="userSpaceOnUse">{stop(0, '--mk-a1', '#0277F8')}{stop(0.5, '--mk-a2', '#0E6CE1')}{stop(0.78, '--mk-a3', '#103F86')}{stop(1, '--mk-a4', '#0C2743')}</linearGradient>
          <linearGradient id={`${id}n`} x1="450" y1="62" x2="700" y2="440" gradientUnits="userSpaceOnUse">{stop(0, '--mk-n1', '#0E2A4C')}{stop(0.45, '--mk-n2', '#1460A3')}{stop(1, '--mk-n3', '#0C9EE2')}</linearGradient>
          <linearGradient id={`${id}c`} x1="400" y1="100" x2="680" y2="530" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#1A8EF8" /><stop offset="0.45" stop-color="#16C1FC" /><stop offset="1" stop-color="#00B4E6" /></linearGradient>
          <linearGradient id={`${id}t`} x1="900" y1="232" x2="680" y2="525" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#049A90" /><stop offset="1" stop-color="#00877F" /></linearGradient>
        </defs>
      )}
      <path d={NAVY} fill={f('n')} />
      <path d={CYAN} fill={f('c')} />
      <path d={A} fill={f('a')} />
      <path d={V} fill={f('t')} opacity={mono ? 1 : 0.92} />
      <circle cx="848" cy="137" r="66" fill={mono ? 'currentColor' : '#FD8218'} />
    </svg>
  );
}

const ANTO = "M23 1.2Q16.9 1.2 12.9 -0.8Q8.8 -2.7 7 -6.1Q5.1 -9.4 5.1 -13.5Q5.1 -17.9 7.2 -21.2Q9.4 -24.6 14.1 -26.6Q18.8 -28.6 25.9 -28.6H37.7Q37.7 -31.9 36.9 -34Q36.1 -36.2 34.2 -37.2Q32.4 -38.3 29.2 -38.3Q25.8 -38.3 23.4 -36.9Q21.1 -35.6 20.5 -32.7H6.5Q7 -37.9 10 -41.8Q12.9 -45.7 17.9 -47.9Q22.8 -50.2 29.3 -50.2Q36.3 -50.2 41.4 -47.9Q46.6 -45.6 49.4 -41.2Q52.3 -36.8 52.3 -30.3V0H40.2L38.4 -7.1Q37.3 -5.2 35.9 -3.7Q34.4 -2.2 32.5 -1.1Q30.5 0 28.2 0.6Q25.9 1.2 23 1.2ZM26.6 -9.9Q29 -9.9 30.7 -10.7Q32.5 -11.5 33.7 -12.8Q35 -14.2 35.8 -16Q36.7 -17.8 37 -19.9V-20H27.6Q25.2 -20 23.6 -19.4Q22 -18.8 21.2 -17.6Q20.4 -16.4 20.4 -14.9Q20.4 -13.2 21.2 -12.1Q22.1 -11 23.5 -10.5Q24.9 -9.9 26.6 -9.9ZM59.6 0V-49H72.3L73.5 -41.1Q75.7 -45.2 79.8 -47.7Q83.9 -50.2 89.7 -50.2Q95.9 -50.2 100 -47.5Q104.2 -44.9 106.4 -40Q108.6 -35.1 108.6 -28V0H94.1V-26.6Q94.1 -32 91.8 -35Q89.5 -37.9 84.6 -37.9Q81.7 -37.9 79.3 -36.5Q76.9 -35.1 75.5 -32.5Q74.2 -29.8 74.2 -26.2V0ZM138.8 0Q133.5 0 129.4 -1.7Q125.3 -3.4 123.1 -7.3Q120.8 -11.2 120.8 -17.9V-36.8H112.5V-49H120.8L122.4 -62.8H135.4V-49H148V-36.8H135.4V-17.7Q135.4 -14.8 136.7 -13.6Q138.1 -12.3 141.3 -12.3H148V0ZM177.8 1.2Q170.7 1.2 165.1 -2.1Q159.4 -5.4 156.1 -11.2Q152.8 -17 152.8 -24.4Q152.8 -32 156.1 -37.8Q159.4 -43.6 165.1 -46.9Q170.8 -50.2 177.8 -50.2Q185 -50.2 190.7 -46.9Q196.3 -43.6 199.6 -37.8Q202.9 -32 202.9 -24.5Q202.9 -17 199.6 -11.2Q196.3 -5.4 190.7 -2.1Q185 1.2 177.8 1.2ZM177.8 -11.5Q180.7 -11.5 183 -12.9Q185.3 -14.4 186.7 -17.3Q188 -20.2 188 -24.5Q188 -28.8 186.7 -31.7Q185.3 -34.6 183.1 -36.1Q180.8 -37.5 177.9 -37.5Q175 -37.5 172.7 -36.1Q170.4 -34.6 169.1 -31.7Q167.7 -28.8 167.7 -24.5Q167.7 -20.2 169.1 -17.3Q170.4 -14.4 172.7 -12.9Q175 -11.5 177.8 -11.5Z";
const VELO = "M222.1 0 204.3 -49H219.6L231 -13.7L242.4 -49H257.5L239.8 0ZM284.6 1.2Q277 1.2 271.2 -2Q265.5 -5.2 262.3 -10.8Q259 -16.5 259 -23.9Q259 -31.5 262.2 -37.4Q265.4 -43.4 271.2 -46.8Q276.9 -50.2 284.5 -50.2Q291.9 -50.2 297.4 -47Q302.9 -43.8 306.1 -38.3Q309.3 -32.8 309.3 -25.6Q309.3 -24.6 309.2 -23.4Q309.2 -22.2 309 -20.9H273.5Q273.7 -18.3 274.8 -16.2Q276 -13.6 278.5 -12.2Q281 -10.7 284.4 -10.7Q287.6 -10.7 289.7 -12Q291.8 -13.3 292.9 -15.4H307.8Q306.4 -10.7 303.1 -7Q299.8 -3.2 295.1 -1Q290.3 1.2 284.6 1.2ZM273.8 -29.4H294.4Q294.2 -33.4 291.4 -35.9Q288.7 -38.4 284.6 -38.4Q281.5 -38.4 278.9 -36.9Q276.4 -35.5 274.9 -32.6Q274.2 -31.1 273.8 -29.4ZM315.1 0V-70H329.7V0ZM361 1.2Q353.9 1.2 348.2 -2.1Q342.6 -5.4 339.3 -11.2Q336 -17 336 -24.4Q336 -32 339.3 -37.8Q342.6 -43.6 348.3 -46.9Q354 -50.2 361 -50.2Q368.2 -50.2 373.8 -46.9Q379.5 -43.6 382.8 -37.8Q386.1 -32 386.1 -24.5Q386.1 -17 382.8 -11.2Q379.5 -5.4 373.8 -2.1Q368.2 1.2 361 1.2ZM361 -11.5Q363.9 -11.5 366.2 -12.9Q368.5 -14.4 369.8 -17.3Q371.2 -20.2 371.2 -24.5Q371.2 -28.8 369.8 -31.7Q368.5 -34.6 366.2 -36.1Q364 -37.5 361.1 -37.5Q358.2 -37.5 355.9 -36.1Q353.6 -34.6 352.2 -31.7Q350.9 -28.8 350.9 -24.5Q350.9 -20.2 352.2 -17.3Q353.6 -14.4 355.9 -12.9Q358.2 -11.5 361 -11.5Z";
const WORD_W = 390.9;

/** "antovelo" in DM Sans Black outlines; `height` is the height of the l (the tallest letter). */
export function Wordmark({ height = 16 }: { height?: number }) {
  const s = height / 70;
  return (
    <svg viewBox={`0 -70 ${WORD_W} 72`} width={WORD_W * s} height={height * 72 / 70} role="img" aria-label="AntoVelo" style={{ display: "block", overflow: "visible" }}>
      <path d={ANTO} fill="currentColor" />
      <path d={VELO} fill="var(--brand-blue, #0A74F5)" />
    </svg>
  );
}

/** Mark and wordmark side by side; `height` is the mark's height. */
export function Logo({ height = 26 }: { height?: number }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "flex-end", gap: height * 0.2 }}>
      <Mark size={height} />
      <span style={{ paddingBottom: height * 0.02 }}><Wordmark height={height * 0.62} /></span>
    </span>
  );
}
