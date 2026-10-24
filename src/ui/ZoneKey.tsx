import { ZONE_NAMES } from './glossary';
import { ZONE_VAR } from './Profile';

/** The key to the zone colours: each zone's colour beside its number and name. Under every chart or table coloured by zone. */
export function ZoneKey({ style }: { style?: string }) {
  return (
    <p class="zone-key faint small" style={style}>
      {ZONE_NAMES.map((n, i) => <span key={i}><i style={`background:${ZONE_VAR[i]}`} />Z{i + 1} {n}</span>)}
    </p>
  );
}
