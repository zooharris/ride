import { useEffect, useState } from 'preact/hooks';
import { db } from '../../data/db';
import { checkNumbers, checkText, type MetricCheck } from '../../sync/checkNumbers';
import { watchChangeOver, type ChangeOverState } from '../../sync/ownService';
import { PageHead } from '../PageHead';
import { toast } from '../Toast';

/**
 * TEMPORARY (22 Nov 2026): the one-time check of Antogo's numbers against Intervals.icu's on this device's history,
 * opened only by its address (#/check-numbers). Not linked from the app; removed in the follow-up build.
 */
export function CheckNumbers() {
  const [res, setRes] = useState<{ cs: MetricCheck[]; n: number } | null>(null);
  const [co, setCo] = useState<ChangeOverState>({ running: false, done: 0, total: 0 });
  const run = async () => {
    const rides = await db.rides.toArray(), recs = await db.own.toArray();
    setRes({ cs: checkNumbers(rides, recs), n: Math.min(200, rides.filter((r) => r.ownNumbers && recs.find((x) => x.id === r.id)?.came).length) });
  };
  useEffect(() => { void run(); return watchChangeOver((s) => { setCo(s); if (!s.running) void run(); }); }, []);
  const copy = async () => {
    if (!res) return;
    const text = checkText(res.cs, res.n);
    const ok = await Promise.race([navigator.clipboard?.writeText(text).then(() => true, () => false) ?? Promise.resolve(false), new Promise<boolean>((r) => setTimeout(() => r(false), 2000))]);
    if (ok) toast({ ok: true, text: 'Results copied.' }); else window.prompt('Copy the results:', text);
  };
  return (
    <div>
      <PageHead back={{ label: 'Settings', href: '#/settings' }} title="Check Antogo's numbers" />
      <p class="prose" style="margin-top:0">A one-time check for this build: Antogo's own numbers beside Intervals.icu's, over your latest 200 activities that have both. This page is temporary and will be removed.</p>
      {co.running && <p class="small muted">Still working out your activities' numbers: {co.done} of {co.total}. The check fills in as it goes.</p>}
      {res && (
        <div class="panel"><div class="stack" style="gap:8px">
          {res.cs.map((c) => (
            <div key={c.key} class="small">
              <b>{c.label}</b>: {c.n ? <>{c.within} of {c.n} agree{c.medianPct != null ? <span class="faint"> · median difference {c.medianPct}%</span> : null}</> : <span class="faint">none to compare</span>}
              {c.worst.length > 0 && <div class="faint">Most different: {c.worst.map((w) => <span key={w.id}><a href={`#/rides/${w.id}`}>{w.date} {w.name}</a> (Intervals.icu {w.came}, Antogo {w.own}) </span>)}</div>}
            </div>
          ))}
        </div>
        <button class="btn primary sm" style="margin-top:12px" onClick={copy}>Copy the results</button></div>
      )}
    </div>
  );
}
