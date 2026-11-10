import type { Workout } from '../engine/types';
import { Icon } from './icons';
import { isFavorite, starLabel, toggleFavorite, useFavorites } from './favorites';

/** The favourite star on a workout card or page (9 Nov 2026). Filled when starred. */
export function Star({ w }: { w: Pick<Workout, 'id' | 'libraryId' | 'name'> }) {
  useFavorites();
  const on = isFavorite(w);
  return (
    <button class={`star-btn${on ? ' on' : ''}`} aria-pressed={on} aria-label={starLabel(on, w.name)} title={on ? 'In your favorites' : 'Add to favorites'}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); void toggleFavorite(w); }}>
      {Icon.star({ size: 18, on })}
    </button>
  );
}
