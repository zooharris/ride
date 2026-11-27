import { useEffect, useState } from 'preact/hooks';
import { appKind } from '../shell';

/**
 * An upright iPad (26 Nov 2026): taller than wide, between a phone and a laptop across. The ride player's three
 * screens each get one screen there, laid out for that shape; turned on its side the iPad gets the wide screens a
 * Mac does. A tall, narrow window on a computer counts too. Watched, because an iPad is turned mid-ride.
 */
export const isPadUpright = (width: number, height: number): boolean => height > width && width >= 700 && width <= 1100 && height >= 950;

/**
 * A tablet held on its side (27 Nov 2026): a touch screen wider than tall, of a tablet's size, and not the Mac app.
 * It gets the ride's one-screen layout in its sideways shape; a computer's window keeps the wide screen it has.
 */
export const isPadSide = (width: number, height: number, touch: boolean): boolean => touch && width > height && width >= 950 && width <= 1400 && height >= 700;

export function usePadSide(): boolean {
  const now = () => typeof innerWidth === 'number' && isPadSide(innerWidth, innerHeight, typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0 && appKind() !== 'mac');
  const [side, setSide] = useState(now);
  useEffect(() => {
    const on = () => setSide(now());
    addEventListener('resize', on);
    return () => removeEventListener('resize', on);
  }, []);
  return side;
}

export function usePadUpright(): boolean {
  const now = () => typeof innerWidth === 'number' && isPadUpright(innerWidth, innerHeight);
  const [pad, setPad] = useState(now);
  useEffect(() => {
    const on = () => setPad(now());
    addEventListener('resize', on);
    return () => removeEventListener('resize', on);
  }, []);
  return pad;
}
