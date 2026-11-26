import type { ComponentChildren } from 'preact';

/**
 * A flow diagram in Help (25 Nov 2026): steps down the page joined by arrows, with a fork where the rider chooses.
 * Drawn with the page's own boxes and colours, so it reads in dark and light and on a phone.
 */
export interface FlowStep {
  /** 'ask' is a question the rider answers; 'end' is where a path finishes. */
  kind?: 'do' | 'ask' | 'end';
  title: string;
  text?: ComponentChildren;
  /** After a question: the answers, each with the steps it leads to. */
  paths?: Array<{ answer: string; steps: FlowStep[] }>;
}

function Steps({ steps }: { steps: FlowStep[] }) {
  return (
    <ol class="flow-steps">
      {steps.map((s, i) => (
        <li key={i} class={`flow-step k-${s.kind ?? 'do'}`}>
          <div class="flow-box">
            <b>{s.title}</b>
            {s.text && <span>{s.text}</span>}
          </div>
          {s.paths && (
            <div class="flow-paths" style={`--paths:${s.paths.length}`}>
              {s.paths.map((p) => (
                <div class="flow-path" key={p.answer}>
                  <span class="flow-answer">{p.answer}</span>
                  <Steps steps={p.steps} />
                </div>
              ))}
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

export function Flow({ label, steps }: { label: string; steps: FlowStep[] }) {
  return <div class="flow" role="group" aria-label={label}><Steps steps={steps} /></div>;
}
