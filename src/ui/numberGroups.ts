import type { NumberRow } from './activityNumbers';

/**
 * The Numbers section of an activity's page as compact cells in groups (22 Nov 2026, brief Part A). A change of
 * layout only: every row the list showed is a cell here, with the same value, wording and rule for when it is hidden.
 */

export const GROUPS = ['Time and distance', 'Power', 'Heart rate', 'Breathing', 'Cadence and speed', 'Conditions', 'Energy', 'About this recording'] as const;
export type GroupName = typeof GROUPS[number];

/** Which group each number belongs to. A number with no group of its own goes under About this recording. */
export const GROUP_OF: Record<string, GroupName> = {
  'Moving time': 'Time and distance',
  'Elapsed time': 'Time and distance',
  Time: 'Time and distance',
  'Moving time, as the watch judged it': 'Time and distance',
  Distance: 'Time and distance',
  'Average pace': 'Time and distance',
  'Total climbing': 'Time and distance',
  'Total descent': 'Time and distance',
  'Training load (TSS)': 'Time and distance',
  'Effort you rated': 'Time and distance',
  'Normalized power': 'Power',
  'Average power': 'Power',
  Intensity: 'Power',
  Steadiness: 'Power',
  'Work done': 'Power',
  'Work above FTP': 'Power',
  'Deepest into your reserve': 'Power',
  'FTP used for this ride': 'Power',
  Power: 'Power',
  'Heart rate': 'Heart rate',
  'Threshold heart rate used': 'Heart rate',
  'Average heart rate': 'Heart rate',
  'Max heart rate': 'Heart rate',
  'Efficiency factor': 'Heart rate',
  'Heart-rate drift': 'Heart rate',
  'Highest breathing': 'Breathing',
  'Highest breathing rate': 'Breathing',
  'Average cadence': 'Cadence and speed',
  'Time coasting': 'Cadence and speed',
  'Top speed': 'Cadence and speed',
  'Average temperature': 'Conditions',
  Weather: 'Conditions',
  Wind: 'Conditions',
  'Energy burned': 'Energy',
  'Carbohydrate used': 'Energy',
  'Power recorded for': 'Power',
  'Recorded on': 'About this recording',
  'Brought in': 'About this recording',
  Numbers: 'About this recording',
};

/** A value longer than this many characters takes two cells' width, so it is never cut short or shrunk. */
export const WIDE_AT = 18;

export interface NumberCell { label: string; value: string; explain?: string; wide: boolean }
export interface NumberGroup { name: GroupName; cells: NumberCell[] }

/** A value is shown when the list would have shown it: anything but undefined and the empty string. */
export const shown = (v: NumberRow[1]): v is string | number => v !== undefined && v !== '';

/**
 * The rows, shown ones only, in their groups and in the groups' order; within a group, in the order the list had.
 * A group left with one cell joins the group above it (the first group has none above, so it stands).
 */
export function groupNumbers(rows: NumberRow[]): NumberGroup[] {
  const by = new Map<GroupName, NumberCell[]>();
  for (const [label, v, explain] of rows) {
    if (!shown(v)) continue;
    const value = String(v);
    const g = GROUP_OF[label] ?? 'About this recording';
    // Weather with "felt like", wind with the share of the ride into it, or any long value: two cells wide.
    const wide = value.length > WIDE_AT || ((label === 'Weather' || label === 'Wind') && value.includes(','));
    by.set(g, [...(by.get(g) ?? []), { label, value, explain: explain || undefined, wide }]);
  }
  const out: NumberGroup[] = [];
  for (const name of GROUPS) {
    const cells = by.get(name);
    if (!cells?.length) continue;
    if (cells.length === 1 && out.length) out[out.length - 1].cells.push(...cells);
    else out.push({ name, cells: [...cells] });
  }
  return out;
}

/** How many cells across: two in a narrow column (a phone), three otherwise. */
export function columnsFor(width: number): 2 | 3 {
  return width < 560 ? 2 : 3;
}

/**
 * Where each cell of a group lands, as [row, column, span], laid left to right as a grid with dense packing would
 * not do (the order of the numbers is kept). A wide cell that would start in the last column moves to the next row.
 */
export function placeCells(cells: NumberCell[], cols: number): Array<{ row: number; col: number; span: number }> {
  const out: Array<{ row: number; col: number; span: number }> = [];
  let row = 0, col = 0;
  for (const c of cells) {
    const span = c.wide ? Math.min(2, cols) : 1;
    if (col + span > cols) { row++; col = 0; }
    out.push({ row, col, span });
    col += span;
    if (col >= cols) { row++; col = 0; }
  }
  return out;
}

/** How many cells' width the last row of a group leaves empty (0 when it ends level). */
export function emptyAtEnd(cells: NumberCell[], cols: number): number {
  const p = placeCells(cells, cols);
  if (!p.length) return 0;
  const last = p[p.length - 1];
  const used = last.col + last.span;
  return used >= cols ? 0 : cols - used;
}
