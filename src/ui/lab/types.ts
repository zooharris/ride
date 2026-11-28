import type { ComponentChildren } from 'preact';
import type { LabData } from './useLab';

/**
 * The Lab's designed charts (27 Nov 2026). Each has a tile on the Lab's front page, drawn from the rider's own data,
 * and a screen of its own. `ready` says whether the rider has what the chart needs: enough to draw it, some of it
 * (the tile then shows the real points and how far along they are), or none (the empty frame and the reason).
 */
export type Ready = { state: 'ok' } | { state: 'some'; so: string } | { state: 'none'; why: string };

export interface LabChart {
  id: string;
  name: string;
  /** One line under the name on the tile. */
  about: string;
  ready: (L: LabData) => Ready;
  /** The tile's picture (the rider's own chart in miniature) and its one headline figure. */
  tile: (L: LabData) => { mini: ComponentChildren; figure?: string; label?: string };
  Page: (p: { L: LabData }) => preact.JSX.Element;
  /** The Insights question this chart bears on, for "What does this mean?". */
  question?: string;
  /** The chart keeps its own period (a Progress card brought in whole), so the Lab's picker is not shown on its page. */
  ownPeriod?: boolean;
  /** Words to find it by, beside its name. */
  words?: string;
}
