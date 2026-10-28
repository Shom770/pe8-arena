// Difficulty zones, easiest first. A room climbs one zone per round:
// round 1 draws from zone 1, round 2 from zone 2, and so on, staying in the
// last zone once it gets there.

export const ZONES = [
  {
    n: 1,
    name: 'Warm-up',
    blurb: 'One list, one pass',
    ids: [1, 2, 4, 5, 10, 12, 16, 17, 19, 21, 22, 33],
  },
  {
    n: 2,
    name: 'Contender',
    blurb: 'Trickier list logic and higher-order functions',
    ids: [6, 8, 13, 14, 18, 23, 25, 27, 29, 31, 40],
  },
  {
    n: 3,
    name: 'Title shot',
    blurb: 'Trees, sets and aliasing',
    ids: [9, 11, 15, 20, 24, 26, 28, 30, 35, 36, 39, 45],
  },
  {
    n: 4,
    name: 'Championship',
    blurb: 'Linked queues, deques and evolutionary trees',
    ids: [3, 7, 32, 34, 37, 38, 41, 42, 43, 44, 46],
  },
];

export function zoneOf(problemId) {
  return ZONES.find((z) => z.ids.includes(problemId)) || ZONES[ZONES.length - 1];
}

// The zone for the round after `roundsPlayed` rounds.
export function zoneForRound(roundsPlayed) {
  return ZONES[Math.min(roundsPlayed, ZONES.length - 1)];
}

// A random problem from the zone, avoiding ones already played in this room
// until the zone runs out.
export function pickFromZone(zone, played = []) {
  const fresh = zone.ids.filter((id) => !played.includes(id));
  const pool = fresh.length ? fresh : zone.ids;
  return pool[Math.floor(Math.random() * pool.length)];
}
