import type { ComponentChildren, VNode } from 'preact';
import { createContext } from 'preact';
import { useContext } from 'preact/hooks';

/** Help's search (moved here 25 Nov 2026 so the guides and the reference sections share it). */
/** The search text, lower-cased; empty when not searching. Items that do not contain it hide themselves. */
export const Query = createContext('');

/** The plain text of a piece of JSX, for search. */
export function textOf(node: unknown): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(' ');
  const v = node as VNode<{ children?: unknown; t?: string }>;
  return `${v.props?.t ?? ''} ${textOf(v.props?.children)}`;
}
export const shows = (q: string, children: unknown, extra = '') => !q || `${extra} ${textOf(children)}`.toLowerCase().includes(q);

/** A list item that hides itself when it does not contain the search text. */
export function Li({ children }: { children: ComponentChildren }) {
  return shows(useContext(Query), children) ? <li>{children}</li> : null;
}
/** A paragraph that hides itself when searching and it does not match. */
export function P({ children }: { children: ComponentChildren }) {
  return shows(useContext(Query), children) ? <p>{children}</p> : null;
}
/** A term and its definition, shown or hidden together. */
export function Def({ t, children }: { t: string; children: ComponentChildren }) {
  return shows(useContext(Query), children, t) ? <><dt>{t}</dt><dd>{children}</dd></> : null;
}
/** How many searchable items in a section body match. */
export function matches(node: unknown, q: string): number {
  if (node == null || typeof node !== 'object') return 0;
  if (Array.isArray(node)) return node.reduce((n, x) => n + matches(x, q), 0);
  const v = node as VNode<{ children?: unknown; t?: string }>;
  if (v.type === Li || v.type === P || v.type === Def) return shows(q, v.props.children, v.props.t ?? '') ? 1 : 0;
  return matches(v.props?.children, q);
}

