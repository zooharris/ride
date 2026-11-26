import { useEffect, useMemo, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { ARTICLES, articleFor, TOPICS, type Article } from '../help/articles';
import { REFERENCE } from '../help/reference';
import { matches, Query, textOf } from '../help/search';
import { shotVersion } from '../help/Shot';
import { APP_SHORT_NAME, TAGLINE } from '../../appName';
import { StackedLogo } from '../Brand';
import { Icon } from '../icons';
import { PageHead } from '../PageHead';

/**
 * Help (rebuilt 26 Nov 2026 as pages). Home is a search box and a few topics. A topic is a page of cards. An article
 * is one short page: what it is for, numbered steps with the screen beside each, a few notes, and where to go next.
 * The long account of each screen is folded away at the foot of its article as "All the detail".
 *
 * Addresses: #/help (home), #/help/t-<topic> (a topic), #/help/<article> (an article). A screen's "?" opens its
 * article; the older #/help?s=<name> still leads to the right one.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ICON: Record<string, (p: any) => preact.JSX.Element> = { start: Icon.star, plan: Icon.plan, ride: Icon.ride, after: Icon.progress, devices: Icon.sync, fix: Icon.help };
const TOOLS = ['check', 'new', 'contact'];
const inTopics = ARTICLES.filter((a) => a.topic !== 'tools');
const detailOf = (a: Article) => (a.detail ? REFERENCE.find((r) => r.id === a.detail) : undefined);

function Thumb({ a }: { a: Article }) {
  if (!a.thumb) return <span class="h-card-noimg" aria-hidden="true" />;
  return <img class="h-card-img" src={`${import.meta.env.BASE_URL}help/${a.thumb}-${shotVersion()}.webp`} alt="" loading="lazy" decoding="async" />;
}

function ArticleCard({ a, children }: { a: Article; children?: ComponentChildren }) {
  return (
    <a class="h-card panel" href={`#/help/${a.id}`}>
      <Thumb a={a} />
      <span class="h-card-text"><b>{a.title}</b><span>{children ?? a.summary}</span></span>
    </a>
  );
}

/** The words of an article and its detail, for searching (made once). */
function useIndex() {
  return useMemo(() => ARTICLES.map((a) => {
    const d = detailOf(a);
    return { a, words: `${a.title}. ${a.summary}. ${textOf(<>{a.body()}</>)}`.toLowerCase(), detail: d ? textOf(d.body).toLowerCase() : '', detailBody: d?.body };
  }), []);
}

/** A few words either side of the first place the search is found. */
function around(text: string, q: string): string {
  const i = text.indexOf(q);
  if (i < 0) return '';
  const a = Math.max(0, text.lastIndexOf(' ', Math.max(0, i - 60)));
  const b = Math.min(text.length, i + q.length + 80);
  return `${a > 0 ? '… ' : ''}${text.slice(a, b).trim()}${b < text.length ? ' …' : ''}`;
}

function Results({ q }: { q: string }) {
  const index = useIndex();
  const hits = index.map((x) => {
    const inTitle = x.a.title.toLowerCase().includes(q) ? 3 : 0;
    const inWords = x.words.includes(q) ? 2 : 0;
    const inDetail = x.detail.includes(q) ? 1 : 0;
    return { ...x, score: inTitle + inWords + inDetail, snippet: around(x.words, q) || around(x.detail, q) };
  }).filter((x) => x.score > 0).sort((x, y) => y.score - x.score);
  if (!hits.length) return <div class="empty small"><b>Nothing in Help matches "{q}".</b><span class="small muted">Try a shorter word, or clear the search.</span></div>;
  return (
    <div class="h-results" aria-live="polite">
      <p class="small muted" style="margin:0 0 10px">{hits.length} {hits.length === 1 ? 'page' : 'pages'}</p>
      {hits.map(({ a, snippet }) => (
        <a class="h-result panel" key={a.id} href={`#/help/${a.id}?q=${encodeURIComponent(q)}`}>
          <b>{a.title}</b>
          <span class="small muted">{TOPICS.find((t) => t.id === a.topic)?.title ?? 'Help'}</span>
          {snippet && <span class="h-result-words">{snippet}</span>}
        </a>
      ))}
    </div>
  );
}

function Home() {
  const [search, setSearch] = useState('');
  const q = search.trim().length >= 2 ? search.trim().toLowerCase() : '';
  return (
    <div class="h-home">
      <PageHead title="Help" />
      <div class="h-search">
        <input type="search" value={search} placeholder="Search Help" aria-label="Search Help" onInput={(e) => setSearch((e.target as HTMLInputElement).value)} />
        {search && <button class="btn sm quiet" onClick={() => setSearch('')}>Clear</button>}
      </div>
      {q ? <Results q={q} /> : (
        <>
          <a class="h-hero panel" href="#/help/start">
            <span class="h-hero-text"><span class="eyebrow">New here?</span><b>What {APP_SHORT_NAME} does</b><span>The app in one page, then your first week.</span></span>
            <img src={`${import.meta.env.BASE_URL}help/today-${shotVersion()}.webp`} alt="" loading="lazy" />
          </a>
          <nav class="h-topics" aria-label="Topics">
            {TOPICS.map((t) => {
              const I = ICON[t.icon];
              return (
                <a class="h-topic panel" key={t.id} href={`#/help/t-${t.id}`}>
                  <span class="h-topic-icon" aria-hidden="true">{I({})}</span>
                  <b>{t.title}</b>
                  <span>{t.text}</span>
                  <span class="h-topic-count">{inTopics.filter((a) => a.topic === t.id).length} pages</span>
                </a>
              );
            })}
          </nav>
          <nav class="h-tools" aria-label="Tools">
            {TOOLS.map((id) => { const a = articleFor(id)!; return <a class="h-tool panel" key={id} href={`#/help/${id}`}><b>{a.title}</b><span>{a.summary}</span></a>; })}
          </nav>
          <div class="help-about"><StackedLogo width={180} /><p class="help-tagline">{TAGLINE}</p></div>
        </>
      )}
    </div>
  );
}

function Crumbs({ topic }: { topic?: { id: string; title: string } }) {
  return (
    <nav class="h-crumbs" aria-label="Where you are">
      <a href="#/help">Help</a>
      {topic && <><span aria-hidden="true">›</span><a href={`#/help/t-${topic.id}`}>{topic.title}</a></>}
    </nav>
  );
}

function TopicPage({ id }: { id: string }) {
  const t = TOPICS.find((x) => x.id === id);
  if (!t) return <Home />;
  const list = inTopics.filter((a) => a.topic === id);
  return (
    <div class="h-page">
      <Crumbs />
      <h1 class="h-title">{t.title}</h1>
      <p class="h-lead">{t.text}</p>
      <div class="h-cards">{list.map((a) => <ArticleCard key={a.id} a={a} />)}</div>
    </div>
  );
}

function ArticlePage({ a, q }: { a: Article; q: string }) {
  const topic = TOPICS.find((t) => t.id === a.topic);
  const peers = topic ? inTopics.filter((x) => x.topic === a.topic) : [];
  const at = peers.findIndex((x) => x.id === a.id);
  const prev = at > 0 ? peers[at - 1] : undefined;
  const next = at >= 0 && at < peers.length - 1 ? peers[at + 1] : undefined;
  const detail = detailOf(a);
  // The detail opens by itself when a search led here and the words are only in it.
  const openDetail = !!q && !!detail && matches(detail.body, q) > 0;
  const related = (a.related ?? []).map((id) => articleFor(id)).filter((x): x is Article => !!x);
  return (
    <article class="h-page">
      <Crumbs topic={topic} />
      <h1 class="h-title">{a.title}</h1>
      <Query.Provider value="">
        <div class="h-article">{a.body()}</div>
      </Query.Provider>
      {detail && (
        <details class="h-detail" open={openDetail}>
          <summary>All the detail</summary>
          <Query.Provider value={q}>
            <div class="prose">{detail.body}</div>
          </Query.Provider>
        </details>
      )}
      {related.length > 0 && (
        <section class="h-related">
          <h2>Related</h2>
          <div class="h-cards small-cards">{related.map((r) => <ArticleCard key={r.id} a={r} />)}</div>
        </section>
      )}
      {(prev || next) && (
        <nav class="h-prevnext" aria-label="More in this topic">
          {prev ? <a class="panel" href={`#/help/${prev.id}`}><span class="small muted">Previous</span><b>{prev.title}</b></a> : <span />}
          {next ? <a class="panel next" href={`#/help/${next.id}`}><span class="small muted">Next</span><b>{next.title}</b></a> : <span />}
        </nav>
      )}
    </article>
  );
}

export function Help({ params, page }: { params?: URLSearchParams; page?: string }) {
  // The older address (#/help?s=name) and the newer (#/help/name) both lead to the article.
  const name = page || params?.get('s') || '';
  const q = (params?.get('q') ?? '').trim().toLowerCase();
  useEffect(() => { window.scrollTo(0, 0); }, [name]);
  if (name.startsWith('t-')) return <TopicPage id={name.slice(2)} />;
  const a = articleFor(name);
  return a ? <ArticlePage key={a.id} a={a} q={q} /> : <Home />;
}

/** Every address Help answers to, for the test that each "?" and each link leads somewhere. */
export const HELP_PAGES = [...ARTICLES.map((a) => a.id), ...TOPICS.map((t) => `t-${t.id}`)];

/** The first-run checklist on Today: ticks itself as each step gets done. */
export function GettingStarted({ connected, synced, planned, sent, reviewed, onDismiss }: { connected: boolean; synced: boolean; planned: boolean; sent: boolean; reviewed: boolean; onDismiss: () => void }) {
  // With nothing connected the steps are the rider's own (25 Nov 2026); connecting is an option, not a step.
  const steps: Array<[boolean, string, string, string]> = connected ? [
    [connected, 'Connect Intervals.icu', 'Settings', '#/settings'],
    [synced, 'Sync your activities and wellness', 'Today', '#/today'],
    [planned, 'Plan my training and put it on the calendar', 'Plan', '#/plan'],
    [sent, 'Send the week to your devices', 'Calendar', '#/calendar'],
    [reviewed, 'Ride, sync, and open the activity', 'Activities', '#/rides'],
  ] : [
    [planned, 'Plan my training and put it on the calendar', 'Plan', '#/plan'],
    [synced, 'Ride a session in the ride player, or bring in an activity from its file', 'Activities', '#/rides'],
  ];
  const done = steps.filter(([ok]) => ok).length;
  return (
    <section class="panel accent" style="margin-bottom:14px">
      <div class="row between"><b>Getting started · {done} of {steps.length}</b><button class="btn sm quiet" onClick={onDismiss}>Dismiss</button></div>
      <ol class="checklist" style="margin:10px 0 0">
        {steps.map(([ok, text, where, href]) => <li key={text} class={ok ? 'done' : ''}><span class="tick">{ok ? '✓' : ''}</span><span>{text}</span>{!ok && <a href={href} class="faint small">{where} ›</a>}</li>)}
      </ol>
      <p class="faint small" style="margin:10px 0 0">The <a href="#/help">Help</a> page explains every screen and every number.</p>
    </section>
  );
}
