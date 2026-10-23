import { useEffect, useState } from 'preact/hooks';
import type { Exercise } from '../engine/types';
import { picturesFor } from '../art/pictures';

/**
 * An exercise's start and finish pictures on light tiles, with "start" and
 * "finish" under them; one tile and no caption for an exercise that holds
 * still. Tapping a picture opens it larger with its cue. Nothing at all when
 * the exercise has no picture.
 */
export function ExercisePictures({ name, exerciseId, cue }: { name: string; exerciseId?: string; cue?: string }) {
  const p = picturesFor(name, exerciseId);
  const [open, setOpen] = useState(false);
  if (!p.a) return null;
  const tile = (src: string, alt: string) => (
    <button type="button" class="ex-tile ex-tile-btn" onClick={() => setOpen(true)} aria-label={`${alt}: see it larger`}>
      <img src={src} alt={alt} width={120} height={120} decoding="async" />
    </button>
  );
  return (
    <div class="ex-pics">
      {p.b ? (
        <>
          <figure>{tile(p.a, `${name}, start`)}<figcaption>start</figcaption></figure>
          <span class="ex-arrow" aria-hidden="true">→</span>
          <figure>{tile(p.b, `${name}, finish`)}<figcaption>finish</figcaption></figure>
        </>
      ) : tile(p.a, name)}
      {open && <PictureSheet name={name} exerciseId={exerciseId} cue={cue} onClose={() => setOpen(false)} />}
    </div>
  );
}

/** The pictures as large as the sheet allows, with the cue under them. Escape or a tap outside closes it. */
export function PictureSheet({ name, exerciseId, cue, onClose }: { name: string; exerciseId?: string; cue?: string; onClose: () => void }) {
  const p = picturesFor(name, exerciseId);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  return (
    <div class="modal-bg" onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div class="modal" onClick={(e) => e.stopPropagation()} style="max-width:560px" role="dialog" aria-label={name}>
        <div class="row between" style="margin-bottom:12px;gap:12px"><h2>{name}</h2><button class="btn sm quiet" onClick={onClose}>Close</button></div>
        <div class={p.b ? 'ex-big two' : 'ex-big'}>
          {p.a && <figure><div class="ex-tile"><img src={p.a} alt={p.b ? `${name}, start` : name} width={384} height={384} /></div>{p.b && <figcaption>start</figcaption>}</figure>}
          {p.b && <figure><div class="ex-tile"><img src={p.b} alt={`${name}, finish`} width={384} height={384} /></div><figcaption>finish</figcaption></figure>}
        </div>
        {cue && <p class="small" style="margin-top:12px;line-height:1.45">{cue}</p>}
      </div>
    </div>
  );
}

/**
 * A session's exercises as a strip of start pictures: the first `max` that have
 * one, then a "+N" tile for the rest that have one. Exercises without a picture
 * are skipped. `fill` shares the width equally (Library cards); otherwise the
 * tiles are a fixed size (Today). `under` puts it on a line of its own under a
 * calendar-style row, lined up with the row's text.
 */
export function PictureStrip({ exercises, max, fill = false, under = false }: { exercises: Pick<Exercise, 'name'>[]; max: number; fill?: boolean; under?: boolean }) {
  const pics = exercises.map((e) => ({ name: e.name, src: picturesFor(e.name).a })).filter((p): p is { name: string; src: string } => !!p.src);
  if (!pics.length) return null;
  const more = pics.length - max;
  return (
    <div class={`ex-strip${fill ? ' fill' : ''}${under ? ' under' : ''}`}>
      {pics.slice(0, max).map((p, i) => <span class="ex-tile" key={i} title={p.name}><img src={p.src} alt={p.name} width={80} height={80} loading="lazy" decoding="async" /></span>)}
      {more > 0 && <span class="ex-tile ex-more" title={pics.slice(max).map((p) => p.name).join(', ')} aria-label={`and ${more} more`}>+{more}</span>}
    </div>
  );
}

/** How many of these exercises have a picture. */
export const picturedCount = (exercises: Pick<Exercise, 'name'>[]): number => exercises.filter((e) => picturesFor(e.name).a).length;
