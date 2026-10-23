/**
 * Every library ride is named for a place: where you would turn around on an
 * out-and-back from Old Town Herndon at the ride's intensity. Outdoor-shaped
 * rides go west on the W&OD into Loudoun (long rides named for the trail towns,
 * interval rides for the roads and landmarks off the trail); core rides go east
 * toward Washington; indoor rides take the loops near home, shortest first.
 * Tests keep their plain names. The descriptive name becomes the subtitle.
 *
 * Unused names (23 Oct 2026, after Batch 6): Sterling (2.5) and Ashburn (7) on the west trail;
 * Shirlington (20) and Jones Point (27) east. They are kept in SPARE_NAMES below for the rides a plan
 * adds to the Library. More names are needed for more rides.
 */
export const RIDE_NAMES: Record<string, string> = {
  // West, long rides on the trail
  'trail-long-90': 'Goose Creek',
  'trail-long-120': 'Leesburg',
  'trail-long-135': 'Paeonian Springs',
  'trail-long-150': 'Clarke’s Gap',
  'trail-long-165': 'Hamilton',
  'trail-long-180': 'Purcellville',
  'trail-long-195': 'Round Hill',
  'trail-long-240': 'Snickers Gap',
  'trail-long-270': 'Bluemont',
  'trail-long-300': 'Berryville',
  'trail-long-360': 'Harpers Ferry',
  'trail-century-sim': 'Winchester',
  // West, interval rides off the trail
  'trail-ss-3x10': 'River Creek',
  'trail-vo2-4x4': 'Brambleton',
  'trail-vo2-6x3': 'Bles Park',
  'trail-thr-3x8': 'Ida Lee',
  'trail-tempo-2x20': 'Ball’s Bluff',
  'trail-tempo-40': 'Red Rock',
  'trail-vo2-5x4': 'Morven Park',
  'trail-ss-3x12': 'Oatlands',
  'trail-thr-2x15': 'White’s Ferry',
  'trail-thr-3x10': 'Waterford',
  'trail-thr-4x8': 'Lucketts',
  'trail-ss-4x10': 'Aldie',
  'trail-ss-2x20': 'Lincoln',
  'trail-ss-3x15': 'Hillsboro',
  'trail-ss-3x20': 'Middleburg',
  'trail-tempo-3x20': 'Philomont',
  'trail-ss-4x15': 'Upperville',
  'trail-thr-3x15': 'Taylorstown',
  'trail-long-tempo-180': 'Lovettsville',
  'trail-long-ss-210': 'Point of Rocks',
  'trail-group-150': 'Unison',
  // East, core rides toward the city
  'lib-spin-30': 'Reston',
  'lib-opener': 'Lake Anne',
  'lib-vo2-30-30': 'Wolf Trap',
  'lib-vo2-5x3': 'Clarks Crossing',
  'lib-z2-60': 'Hunter Mill',
  'lib-force-3x8': 'Difficult Run',
  'lib-anaerobic-6x1': 'Meadowlark',
  'lib-sprints': 'Vienna',
  'lib-ss-3x10': 'Tysons',
  'lib-tempo-2x20': 'Cedar Lane',
  'lib-over-under': 'Merrifield',
  'lib-ss-2x20': 'Gallows Road',
  'lib-ss-3x15': 'Dunn Loring',
  'lib-ss-long': 'Idylwood',
  'lib-z2-90': 'Falls Church',
  'lib-thr-2x20': 'East Falls Church',
  'lib-long-150': 'Roosevelt Island',
  'lib-spin-45': 'Reston Town Center',
  'lib-z2-120': 'Bluemont Junction',
  'lib-long-180': 'Georgetown',
  'lib-long-210': 'Gravelly Point',
  'lib-long-240': 'Old Town Alexandria',
  'lib-long-300': 'Mount Vernon',
  'lib-tempo-3x15': 'Lake Fairfax',
  'lib-thr-3x12': 'Ballston',
  'lib-vo2-4x5': 'Rosslyn',
  // Indoor, the loops near home
  'in-rollr-45': 'Runnymede',
  'in-spinups': 'Bready Park',
  'in-vo2-40-20': 'Chandon',
  'in-thr-progressive': 'Worldgate',
  'in-thr-2x12': 'Sugarland Run',
  'in-vo2-hard-start': 'Route 28',
  'in-vo2-4x4': 'Dranesville',
  'in-ss-4x8': 'Frying Pan',
  'in-z2-cadence-60': 'Herndon Centennial',
  'in-ss-bursts': 'Cascades',
  'in-thr-3x10': 'Algonkian',
  'in-race-sim': 'Lowes Island',
  'in-z2-surges-75': 'Great Falls',
  'in-ss-pyramid': 'Riverbend',
  'in-z2-90': 'Seneca',
  'in-z2-120': 'Claude Moore',
  'in-ss-2x30': 'Potomac Falls',
  'in-tempo-60': 'Floris',
  'in-recovery-30': 'Elden Street',
  // 23 Oct 2026 (Batch 6, B6)
  'lib-z2-105': 'Belmont Ridge',
  'lib-ss-2x12': 'One Loudoun',
  'lib-tempo-2x12': 'Lansdowne',
  'lib-thr-3x6': 'Broad Run',
  'in-recovery-60': 'Fox Mill',
  'in-ss-3x8': 'Dulles',
  'in-vo2-5x2': 'Church Road',
};

/**
 * Names not yet used, for the rides a plan adds to the Library when nothing
 * there is close enough (Batch 6, B1), by the same rule: long and endurance
 * rides take trail towns west, interval rides the roads and landmarks, easy
 * rides the local loops. When a group runs out the others are used, and when
 * all are used the ride keeps its descriptive name.
 */
export const SPARE_NAMES: { long: string[]; interval: string[]; easy: string[] } = {
  long: ['Ashburn', 'Sterling'],
  interval: ['Shirlington', 'Jones Point'],
  easy: [],
};
