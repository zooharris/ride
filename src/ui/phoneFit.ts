/**
 * Does a phone's screen fit the phone? (26 Nov 2026.) What is wrong with the screen in front of the rider, in words;
 * nothing when it fits. "Room" is what the clock, the notch and the home bar leave. Used by the whole-journey check
 * (every iPhone's room, stood in for) and by the tour in Apple's simulator (the real thing), so it stands alone:
 * nothing outside this one function is used inside it.
 */
export interface Room { t: number; b: number; l: number; r: number }

export function phoneFaults({ room, side }: { room: Room; side: boolean }): string[] {
  const out: string[] = [];
  const W = innerWidth, H = innerHeight;
  if (document.documentElement.scrollHeight > H + 1) out.push(`the screen scrolls (${document.documentElement.scrollHeight} in ${H})`);
  // Only the page in front of the rider counts: its neighbours wait off to the side.
  const pager = document.querySelector('.rp-pages');
  const here = (el: Element) => { const pg = el.closest('.rp-page'); return !pg || !pager || Math.abs(pg.getBoundingClientRect().left - pager.getBoundingClientRect().left) < 2; };
  const seen = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < H && here(el) && !el.closest('.rd-overlay'); };
  const words = (el: Element) => (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
  // A page of the pager, or the screen before the ride, must not need scrolling.
  for (const el of document.querySelectorAll('.rp-page, .pp')) if (seen(el) && el.scrollHeight > el.clientHeight + 1) out.push(`${el.className} runs ${el.scrollHeight - el.clientHeight}px below its foot`);
  // Everything a rider reads or presses sits inside the room. (What is inside a list that scrolls in its own box is the box's business.)
  const boxes = '.rp-steps, .rc-eff, .rc-cues';
  for (const el of document.querySelectorAll('.pp-runs, .pp-devices > .pl-card, .pp-ride')) if (seen(el) && el.scrollHeight > el.clientHeight + 1) out.push(`${el.className} holds ${el.scrollHeight - el.clientHeight}px more than it shows`);
  let top = H, low = 0;
  for (const el of document.querySelectorAll('.player button, .player .caption, .player b, .player h1, .player h2, .player .rd-card, .player .pl-card, .player .pl-dev, .player .rp-tile, .player .rp-num, .player .pl-banner')) {
    if (!seen(el) || el.parentElement?.closest(boxes)) continue;
    const r = el.getBoundingClientRect();
    top = Math.min(top, r.top); low = Math.max(low, r.bottom);
    if (r.top < room.t - 1) out.push(`"${words(el)}" is ${Math.round(room.t - r.top)}px under the clock`);
    if (r.bottom > H - room.b + 1) out.push(`"${words(el)}" is ${Math.round(r.bottom - (H - room.b))}px under the home bar`);
    if (r.left < room.l - 1 || r.right > W - room.r + 1) out.push(`"${words(el)}" is under the notch at the side`);
    // Not cut short by the box it sits in.
    if (el.tagName === 'BUTTON' || el.tagName === 'B') for (let up = el.parentElement; up && !up.matches('.rp-page, .pp, .player'); up = up.parentElement) {
      if (getComputedStyle(up).overflowX === 'visible' && getComputedStyle(up).overflowY === 'visible') continue;
      const u = up.getBoundingClientRect();
      if (r.right > u.right + 1.5 || r.left < u.left - 1.5 || r.bottom > u.bottom + 1.5) { out.push(`"${words(el)}" is cut short by its box`); break; }
    }
  }
  // No number or label running out of its own cell into the next.
  for (const el of document.querySelectorAll('.player .rd-figs > div, .player .rp-num, .player .rp-tile, .player .pl-figures > div, .player .rp-live > div, .player .pp-pair, .player .pp-row')) {
    if (seen(el) && el.scrollWidth > el.clientWidth + 1) out.push(`"${words(el)}" runs out of its cell`);
  }
  // No words cut off with dots, but a name too long for its line: a workout's subtitle, a device's own name.
  for (const el of document.querySelectorAll<HTMLElement>('.player *')) {
    if (!seen(el) || el.matches('.rp-sub, .pp-title p, .pl-dev-name, .pl-dev-hint')) continue;
    const cs = getComputedStyle(el);
    if (cs.textOverflow === 'ellipsis' && cs.overflowX !== 'visible' && el.scrollWidth > el.clientWidth + 1) out.push(`"${words(el)}" is cut off`);
  }
  // On its side: no farther from one edge than the other, and the side margins not taken twice.
  if (side) {
    if (Math.abs(top - (H - low)) > 10) out.push(`off centre: ${Math.round(top)}px above, ${Math.round(H - low)}px below`);
    const page = [...document.querySelectorAll('.rp-page, .pp')].find(seen);
    if (page && page.getBoundingClientRect().left > room.l + 1) out.push(`the side margin is taken twice (${Math.round(page.getBoundingClientRect().left)}px)`);
  }
  return [...new Set(out)];
}
