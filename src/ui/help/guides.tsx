import { useState } from 'preact/hooks';
import { checkSetup, diagnosticReport, type SetupLine } from './setup';

/** Help's two working parts (26 Nov 2026): Check my setup, and the report a rider can send. The articles are in articles.tsx. */

/** Check my setup: one button, each connection tried or read, each result in words with where to go next. */
export function CheckSetup() {
  const [lines, setLines] = useState<SetupLine[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function run() {
    setBusy(true); setErr(null);
    try { setLines(await checkSetup()); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  const mark = { ok: '✓', note: '•', bad: '!', off: '–' } as const;
  const said = { ok: 'Fine', note: 'Worth knowing', bad: 'Needs you', off: 'Not set up' } as const;
  return (
    <div class="setup-check">
      <button class="btn primary" onClick={run} disabled={busy}>{busy ? 'Checking…' : lines ? 'Check again' : 'Check my setup'}</button>
      {err && <div class="msg err" style="margin-top:10px">The check could not finish: {err}</div>}
      {lines && (
        <ul class="setup-lines" aria-live="polite">
          {lines.map((l) => (
            <li key={l.what} class={`s-${l.state}`}>
              <span class="setup-mark" aria-hidden="true">{mark[l.state]}</span>
              <div>
                <b>{l.what}</b> <span class="setup-said">{said[l.state]}</span>
                <p>{l.words}</p>
                {(l.help || l.go) && <p class="setup-go">{l.help && <a href={`#/help?s=${l.help}`}>{l.state === 'bad' ? 'How to fix it' : 'More about this'}</a>}{l.help && l.go && ' · '}{l.go && <a href={l.go.href}>{l.go.label}</a>}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Get help: the report a rider can read and copy, and where to send it once there is somewhere. */
export function GetHelp() {
  const [report, setReport] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  async function make() { setBusy(true); try { setReport(await diagnosticReport()); } finally { setBusy(false); } }
  async function copy() {
    if (!report) return;
    try { await navigator.clipboard.writeText(report); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { /* the text is there to select by hand */ }
  }
  return (
    <div>
      <button class="btn" onClick={make} disabled={busy}>{busy ? 'Making the report…' : report ? 'Make it again' : 'Make a report'}</button>
      {report && (
        <div style="margin-top:10px">
          <textarea class="setup-report" aria-label="The report" rows={12} value={report} onInput={(e) => setReport((e.target as HTMLTextAreaElement).value)} />
          <div class="row" style="gap:8px;margin-top:8px"><button class="btn primary sm" onClick={copy}>{copied ? 'Copied' : 'Copy the report'}</button></div>
        </div>
      )}
    </div>
  );
}
