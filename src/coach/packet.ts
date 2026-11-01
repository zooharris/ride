import { addDays } from '../engine/load';
import type { SessionKind } from '../engine/types';

/**
 * The re-check thinks (1 Nov 2026), Part B: everything the coach's judgment is
 * made from, in labelled plain-English sections. Pure: the app assembles the
 * input (src/ui/judgeService.ts), this lays it out and keeps it within budget.
 * Built for whoever is signed in; nothing in it is set for one rider.
 */
export interface PacketActivity { date: string; name: string; planned: boolean; words: string[] }

export interface PacketSession {
  /** A short reference the coach uses to name this calendar entry ("C3"). */
  ref: string;
  date: string;
  kind: SessionKind;
  name: string;
  minutes: number;
  tss?: number;
  purpose?: string;
  status: 'to do' | 'done' | 'missed';
  /** Placed or changed by the rider by hand: the coach may suggest changing it, and the rider is offered it, never auto-selected. */
  handPlaced: boolean;
}

export interface PacketOption { ref: string; name: string; kind: SessionKind; minutes: number; tss?: number; family?: string }
/** One line per day: "Tuesday 3 November (2026-11-03): 1.5 h available, rides indoors; may hold ride, strength, mobility." */
export interface PacketDay { date: string; header: string }
/** The Library once, grouped by kind (and ride family), each group spread across lengths. */
export interface PacketGroup { label: string; items: PacketOption[] }

export interface PacketInput {
  date: string;
  rider: string[];
  morning: string[];
  notes: string[];
  activities: PacketActivity[];
  week: string[];
  calendar: PacketSession[];
  plan: string[];
  params: string[];
  days: PacketDay[];
  catalogue: PacketGroup[];
  appView: string[];
}

/** About how many words the packet may run to before it is trimmed. */
export const PACKET_WORDS = 12_000;

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

function section(title: string, lines: string[], empty: string): string {
  return `## ${title}\n${lines.length ? lines.map((l) => `- ${l}`).join('\n') : `- ${empty}`}`;
}

function sessionLine(s: PacketSession): string {
  return `${s.ref} · ${s.date} · ${s.kind} · ${s.name} · ${s.minutes} min${s.tss != null ? ` · planned load ${s.tss} TSS` : ''} · ${s.status}${s.handPlaced ? ' · placed or changed by the rider by hand' : ''}${s.purpose ? ` · purpose: ${s.purpose}` : ''}`;
}

function optionLine(o: PacketOption): string {
  return `${o.ref} ${o.name} (${o.minutes} min${o.tss != null ? `, ${o.tss} TSS` : ''})`;
}

function render(input: PacketInput, perGroup: number, activityDays: number): string {
  const from = addDays(input.date, -activityDays);
  const acts = input.activities.filter((a) => a.date > from);
  const actLines = acts.map((a) => `${a.date} · ${a.name} · ${a.planned ? 'on the plan' : 'not on the plan'} · ${a.words.join(' ')}`);
  const days = input.days.map((d) => `- ${d.header}`);
  const groups = input.catalogue.filter((g) => g.items.length).map((g) => `- ${g.label}: ${spread(g.items, perGroup).map(optionLine).join('; ')}`);
  return [
    `# Evidence for ${input.date}`,
    section('1. The rider', input.rider, 'nothing known'),
    section('2. This morning', input.morning, 'no overnight numbers'),
    section("3. The rider's notes, today and the last 14 days", input.notes, 'none'),
    section(`4. Recent activities, last ${activityDays} days, newest first`, actLines, 'none'),
    section('5. The week so far and the week intended', input.week, 'no plan this week'),
    section('6. The calendar, today through 14 days ahead (refs C…)', input.calendar.map(sessionLine), 'nothing on the calendar'),
    section('7. The plan', input.plan, 'no plan in force: the calendar is whatever the rider placed there'),
    section('8. The rider\'s parameters (fixed: never go outside them)', input.params, 'none set'),
    `## 9. The next 7 days, and the Library workouts you may name (refs W…; name only these, on a day that allows the kind and has the hours)\n${days.join('\n') || '- none'}\n${groups.join('\n') || '- no Library workouts fit'}`,
    section("10. The app's own view (its algorithm's suggestions, for you to consider or set aside)", input.appView, 'the app suggests no changes'),
  ].join('\n\n');
}

/** Up to `n` items spread across lengths: the shortest, the longest and evenly between. */
function spread(items: PacketOption[], n: number): PacketOption[] {
  const sorted = [...items].sort((a, b) => a.minutes - b.minutes);
  if (sorted.length <= n) return sorted;
  const out: PacketOption[] = [];
  for (let i = 0; i < n; i++) out.push(sorted[Math.round((i * (sorted.length - 1)) / Math.max(1, n - 1))]);
  return [...new Map(out.map((o) => [o.ref, o])).values()];
}

/**
 * The packet as text. Over budget, Library options are trimmed first (fewer
 * per group, down to one), then recent activities (7 days instead of 14).
 */
export function buildPacket(input: PacketInput, budget = PACKET_WORDS): string {
  for (const days of [14, 7]) {
    for (const per of [8, 5, 3, 1]) {
      const text = render(input, per, days);
      if (words(text) <= budget) return text;
    }
  }
  return render(input, 1, 7);
}
