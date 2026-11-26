import { appKind, thisDevice } from '../../shell';
import { platform } from '../../player/platform';

/**
 * A picture of the real app in Help (25 Nov 2026), in the version the rider has in front of them: the iPhone's
 * picture on an iPhone, the iPad's on an iPad, a computer's in the Mac app and in a browser on a computer. The
 * pictures are made from the app's own pages by `npm run help:shots` and kept in public/help; a test checks that
 * every picture Help asks for is there in all three versions.
 */
export type ShotVersion = 'computer' | 'iphone' | 'ipad';
export const SHOT_VERSIONS: ShotVersion[] = ['computer', 'iphone', 'ipad'];

/** Every picture Help uses, by name. */
export const SHOTS = ['welcome', 'today', 'calendar', 'workout', 'player-devices', 'choose-device', 'riding', 'activity', 'progress', 'settings-devices', 'other-devices'] as const;
export type ShotName = typeof SHOTS[number];

export function shotVersion(): ShotVersion {
  if (appKind() === 'ios') return thisDevice() === 'this iPad' ? 'ipad' : 'iphone';
  if (appKind() === 'mac') return 'computer';
  const p = platform();
  return p === 'iphone' || p === 'android' ? 'iphone' : p === 'ipad' ? 'ipad' : 'computer';
}
const ON: Record<ShotVersion, string> = { computer: 'on a computer', iphone: 'on an iPhone', ipad: 'on an iPad' };

export function Shot({ name, alt, caption }: { name: ShotName; alt: string; caption?: string }) {
  const v = shotVersion();
  return (
    <figure class={`help-shot v-${v}`}>
      <img src={`${import.meta.env.BASE_URL}help/${name}-${v}.webp`} alt={`${alt}, ${ON[v]}`} loading="lazy" decoding="async" />
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}
