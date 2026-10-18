import type { AppData } from '../store';

/**
 * The plan builder is being rebuilt as an assessment-driven planner (see the
 * design proposal). Until it lands, this screen says so rather than offering a
 * stopgap. The engine work in progress lives in src/engine/planner.ts.
 */
export function Plan(_: { data: AppData }) {
  return (
    <div>
      <a href="#/calendar" class="btn quiet sm" style="margin-left:-10px;margin-bottom:8px">‹ Calendar</a>
      <div class="page-head"><h1>Plan</h1></div>
      <div class="empty">
        <b>The plan builder is on its way.</b>
        <p class="small" style="margin-top:6px">It will take a goal, your days and hours, and your ride data, and lay a block onto the calendar that it re-checks as rides come in. Until then, add workouts to the calendar from the Library.</p>
        <a class="btn sm" href="#/library" style="margin-top:12px">Open the Library</a>
      </div>
    </div>
  );
}
