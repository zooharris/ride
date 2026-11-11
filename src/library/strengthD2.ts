import type { StrengthSessionDef } from './strengthSessions';

/**
 * Part D, batch 2 (11 Nov 2026): sessions built around the 22 approved exercises. Bodyweight leg power on jumps
 * and hops, bodyweight upper body that really pulls (towel and table rows), bodyweight heavy legs, short
 * injury-proofing sessions, kettlebell and dumbbell power, the pull-up bar and the barbell hip thrust. The rules
 * from batch 1 stand: names say what the session does, no two share a name or the same exercises, "short" means
 * half an hour, and every session has trunk work.
 */
export const STRENGTH_D2: StrengthSessionDef[] = [
  // ── Bodyweight leg power ─────────────────────────────────────────────────────────────────────────
  { id: 'd2-power-legs-bw-jumps', name: 'Legs: power, jumps', quality: 'power', focus: 'legs', needs: [], ids: ['squat-jump', 'split-jump', 'glute-bridge', 'step-up', 'pogo-hops', 'dead-bug'], fast: ['glute-bridge', 'step-up'],
    purpose: 'Squat jumps and split jumps while the legs are fresh, then quick hip drives and step-ups: real power with no equipment.' },
  { id: 'd2-power-legs-bw-hops', name: 'Legs: power, hops and skaters', quality: 'power', focus: 'legs', needs: [], ids: ['skater-hop', 'pogo-hops', 'squat-jump', 'single-leg-bridge', 'plank'],
    purpose: 'Side-to-side skaters, quick pogo hops and squat jumps: springy legs and ankles in under forty minutes.' },
  { id: 'd2-power-legs-bw-long', name: 'Legs: power, jumps, long', quality: 'power', focus: 'legs', needs: [], ids: ['squat-jump', 'skater-hop', 'split-jump', 'pogo-hops', 'glute-bridge', 'reverse-lunge', 'calf-raise', 'side-plank'], fast: ['glute-bridge', 'reverse-lunge'],
    purpose: 'Four kinds of jump with full rest, then fast lunges and hip drives: an hour of leg power with no equipment.' },
  { id: 'd2-power-legs-bw-long-b', name: 'Legs: power, split jumps and steps, long', quality: 'power', focus: 'legs', needs: [], ids: ['split-jump', 'squat-jump', 'step-up', 'lateral-lunge', 'single-leg-bridge', 'tibialis-raise', 'bear-crawl', 'dead-bug'], fast: ['step-up', 'lateral-lunge'],
    purpose: 'Split and squat jumps, fast step-ups and side lunges, the shins and the trunk: a full hour, one leg at a time where it counts.' },
  { id: 'd2-power-legs-box', name: 'Legs: power, box jumps', quality: 'power', focus: 'legs', needs: [], ids: ['box-jump', 'skater-hop', 'step-up', 'glute-bridge', 'hollow-hold'], fast: ['step-up', 'glute-bridge'],
    purpose: 'Low box jumps with a step down, skaters, then fast step-ups and hip drives: jump power that is kind to the joints.' },

  // ── Bodyweight upper body that pulls ─────────────────────────────────────────────────────────────
  { id: 'd2-heavy-upper-bw-rows', name: 'Upper body: strength, rows and presses', quality: 'heavy', focus: 'upper', needs: [], ids: ['table-row', 'pike-pushup', 'towel-row', 'pushup', 'single-leg-rdl', 'plank'],
    purpose: 'Rows under a table and with a towel, pike and ordinary push-ups: pulling and pressing strength with no equipment.' },
  { id: 'd2-heavy-upper-bw-rows-long', name: 'Upper body: strength, rows and presses, long', quality: 'heavy', focus: 'upper', needs: [], ids: ['table-row', 'pike-pushup', 'towel-row', 'pushup', 'nordic-lower', 'bear-crawl', 'side-plank', 'dead-bug'],
    purpose: 'Two rows, two presses, Nordic lowering for the hamstrings and the trunk: a full hour of bodyweight strength.' },
  { id: 'd2-power-upper-bw', name: 'Upper body: power, push and pull', quality: 'power', focus: 'upper', needs: [], ids: ['pushup', 'towel-row', 'pike-pushup', 'glute-bridge', 'bear-crawl', 'hollow-hold'], fast: ['pushup', 'towel-row', 'glute-bridge'],
    purpose: 'Fast push-ups and towel rows, a hip drive and a crawl: quick pulling and pressing with no equipment.' },
  { id: 'd2-power-upper-bw-long', name: 'Upper body: power, push and pull, long', quality: 'power', focus: 'upper', needs: [], ids: ['pushup', 'towel-row', 'table-row', 'pike-pushup', 'glute-bridge', 'russian-twist', 'hollow-hold', 'bird-dog'], fast: ['pushup', 'towel-row', 'glute-bridge'],
    purpose: 'Fast presses and rows of every kind, a twist and the trunk holds, over a full hour.' },
  { id: 'd2-endurance-upper-bw', name: 'Upper body: endurance, rows and holds', quality: 'endurance', focus: 'upper', needs: [], ids: ['towel-row', 'pushup', 'bear-crawl', 'plank', 'side-plank', 'single-leg-bridge'],
    purpose: 'Towel rows and push-ups for many reps, a crawl and long holds: the upper body that holds the position all day.' },
  { id: 'd2-endurance-upper-bw-long', name: 'Upper body: endurance, rows and holds, long', quality: 'endurance', focus: 'upper', needs: [], ids: ['towel-row', 'pushup', 'table-row', 'bear-crawl', 'plank', 'hollow-hold', 'side-plank', 'bird-dog'],
    purpose: 'Rows and push-ups for many reps, then every trunk hold: an hour for posture on long rides.' },
  { id: 'd2-stability-upper-bw', name: 'Upper body: one side at a time, rows', quality: 'stability', focus: 'upper', needs: [], ids: ['towel-row', 'bear-crawl', 'side-plank', 'bird-dog', 'pushup', 'dead-bug'],
    purpose: 'One-arm towel rows, a crawl and the side and reaching holds: the trunk steady while one side works.' },
  { id: 'd2-stability-upper-bw-long', name: 'Upper body: one side at a time, rows, long', quality: 'stability', focus: 'upper', needs: [], ids: ['towel-row', 'table-row', 'pushup', 'bear-crawl', 'side-plank', 'bird-dog', 'dead-bug', 'single-leg-rdl'],
    purpose: 'Rows, push-ups and slow one-sided holds over an hour: a steady trunk and shoulders.' },

  // ── Bodyweight heavy legs ────────────────────────────────────────────────────────────────────────
  { id: 'd2-heavy-legs-bw-nordic', name: 'Legs: strength, single-leg squat and Nordic', quality: 'heavy', focus: 'legs', needs: [], ids: ['sl-box-squat', 'nordic-lower', 'split-squat', 'single-leg-bridge', 'tibialis-raise', 'plank'],
    purpose: 'The hardest bodyweight leg strength: a single-leg squat to the bench and Nordic lowering, then a split squat and the shins.' },
  { id: 'd2-heavy-legs-bw-sl', name: 'Legs: strength, one leg, no weights', quality: 'heavy', focus: 'legs', needs: [], ids: ['sl-box-squat', 'single-leg-rdl', 'reverse-lunge', 'nordic-lower', 'calf-raise', 'side-plank'],
    purpose: 'Every hard single-leg movement with no weights, and the hamstrings strong while lengthening.' },
  { id: 'd2-endurance-legs-bw-shins', name: 'Legs: endurance, squats, lunges and shins', quality: 'endurance', focus: 'legs', needs: [], ids: ['bw-squat', 'walking-lunge', 'glute-bridge', 'tibialis-raise', 'calf-raise', 'side-plank'],
    purpose: 'Many squats, lunges and bridges, with the shins and calves that balance each other: legs that last.' },

  // ── Injury-proofing, short ──────────────────────────────────────────────────────────────────────
  { id: 'd2-prehab-legs-short', name: 'Legs: injury-proofing, short', quality: 'stability', focus: 'legs', needs: [], ids: ['nordic-lower', 'copenhagen-plank', 'tibialis-raise', 'reverse-lunge'],
    purpose: 'The hamstrings, the inner thigh and the shins, in half an hour: the places sprinting riders get hurt.' },
  { id: 'd2-prehab-bands', name: 'Legs: hips and hamstrings, bands', quality: 'stability', focus: 'legs', needs: ['band'], ids: ['band-kickback', 'band-march', 'single-leg-rdl', 'reverse-lunge', 'side-plank'],
    purpose: 'Glutes and hip flexors against a band, a single-leg hinge and a lunge: hips that stay level and pull the pedal up.' },
  { id: 'd2-prehab-db-short', name: 'Legs: injury-proofing with dumbbells, short', quality: 'stability', focus: 'legs', needs: ['dumbbells', 'bench'], ids: ['db-suitcase-deadlift', 'copenhagen-plank', 'tibialis-raise', 'split-squat'],
    purpose: 'A one-sided deadlift, the inner thigh, the shins and a split squat, in half an hour.' },

  // ── Kettlebell and dumbbell power ────────────────────────────────────────────────────────────────
  { id: 'd2-power-legs-kb-clean', name: 'Legs: power, swings and cleans', quality: 'power', focus: 'legs', needs: ['kettlebell'], ids: ['kb-swing', 'kb-clean', 'kb-goblet-squat', 'kb-rack-lunge', 'kb-halo', 'dead-bug'], fast: ['kb-goblet-squat', 'kb-rack-lunge'],
    purpose: 'Swings and cleans first, then a fast squat and racked lunge: hip power carried up into the trunk.' },
  { id: 'd2-power-full-kb-snatch', name: 'Whole body: power, kettlebell snatches (advanced)', quality: 'power', focus: 'full', needs: ['kettlebell'], ids: ['kb-snatch', 'kb-clean', 'kb-goblet-squat', 'kb-press', 'kb-row', 'hollow-hold'], fast: ['kb-goblet-squat', 'kb-press'],
    purpose: 'For riders who already swing and clean well: snatches, cleans, a squat, a press and a row, the whole body moving fast.' },
  { id: 'd2-power-legs-db-clean', name: 'Legs: power, hang cleans and jumps', quality: 'power', focus: 'legs', needs: ['dumbbells'], ids: ['db-hang-clean', 'squat-jump', 'reverse-lunge', 'db-rdl', 'goblet-squat', 'plank'], fast: ['reverse-lunge', 'goblet-squat'],
    purpose: 'Dumbbell hang cleans and squat jumps while fresh, then fast lunges and squats: power for a sprint.' },
  { id: 'd2-power-upper-db-clean', name: 'Upper body: power, hang cleans and presses', quality: 'power', focus: 'upper', needs: ['dumbbells'], ids: ['db-hang-clean', 'db-overhead', 'bent-row', 'pike-pushup', 'russian-twist', 'suitcase-carry'], fast: ['db-overhead', 'bent-row'],
    purpose: 'A hang clean, then a fast press and row: the arms and back that pull on the bars in a sprint.' },

  // ── The pull-up bar ─────────────────────────────────────────────────────────────────────────────
  { id: 'd2-heavy-upper-chinup', name: 'Upper body: strength, chin-ups', quality: 'heavy', focus: 'upper', needs: ['pullup-bar'], ids: ['chin-up', 'pike-pushup', 'dead-hang', 'pushup', 'single-leg-rdl', 'hollow-hold'],
    purpose: 'Chin-ups and pike push-ups for strength, a hang for the grip, and a hinge and trunk hold.' },
  { id: 'd2-upper-bar-first-steps', name: 'Upper body: pull-up bar, first steps', quality: 'endurance', focus: 'upper', needs: ['pullup-bar'], ids: ['dead-hang', 'chin-up', 'towel-row', 'pushup', 'plank'],
    purpose: 'For a rider who cannot yet do a pull-up: hangs, slow lowering from the top of a chin-up, rows and push-ups.' },

  // ── The barbell hip thrust ──────────────────────────────────────────────────────────────────────
  { id: 'd2-heavy-legs-gym-thrust', name: 'Heavy legs, hip thrust and squat', quality: 'heavy', focus: 'legs', needs: ['barbell', 'bench'], ids: ['bb-hip-thrust', 'back-squat', 'split-squat', 'nordic-lower', 'calf-raise', 'plank'],
    purpose: 'The heaviest glute work and the back squat, then a split squat and Nordic lowering: the gym leg day.' },
  { id: 'd2-power-legs-gym-jump', name: 'Legs: power, box jumps and barbell', quality: 'power', focus: 'legs', needs: ['barbell', 'bench'], ids: ['box-jump', 'back-squat', 'bb-hip-thrust', 'skater-hop', 'hollow-hold'], fast: ['back-squat', 'bb-hip-thrust'],
    purpose: 'Box jumps while fresh, then a moderate back squat and hip thrust moved fast.' },
];
