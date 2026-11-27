import { useEffect, useState } from 'preact/hooks';

/**
 * An upright iPad (26 Nov 2026): taller than wide, between a phone and a laptop across. The ride player's three
 * screens each get one screen there, laid out for that shape; turned on its side the iPad gets the wide screens a
 * Mac does. A tall, narrow window on a computer counts too. Watched, because an iPad is turned mid-ride.
 */
export const isPadUpright = (width: number, height: number): boolean => height > width && width >= 700 && width <= 1100 && height >= 950;

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
