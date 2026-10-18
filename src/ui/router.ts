import { useEffect, useState } from 'preact/hooks';

/** Hash routing: survives refresh, works on a static host, no server config. */
export function useRoute(): { path: string; parts: string[]; params: URLSearchParams } {
  const read = () => location.hash.replace(/^#\/?/, '') || 'today';
  const [path, setPath] = useState(read);
  useEffect(() => {
    const on = () => setPath(read());
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  const [p, q] = path.split('?');
  return { path: p, parts: p.split('/'), params: new URLSearchParams(q ?? '') };
}

export function go(path: string): void {
  location.hash = '/' + path.replace(/^\//, '');
}
