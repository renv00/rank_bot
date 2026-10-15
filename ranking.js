export function placementRank(r) {
  if (r.length !== 5) return null;
  
  // Flawless Victory (5-0 all matches)
  if (r.every(x => x.scoreFor === 5 && x.scoreAgainst === 0)) {
    return ['Contender', 7.5];
  }
  // Dominant Performance
  if (r.filter(x => x.scoreFor === 5 && [1, 2, 3].includes(x.scoreAgainst)).length >= 2) {
    return ['Contender', 7.0];
  }
  // Close Victories (Higher Tier)
  if (r.filter(x => x.scoreFor === 5 && x.scoreAgainst === 4).length >= 2) {
    return ['Amateur', 6.5];
  }
  // Close Victories (Lower Tier)
  if (r.every(x => x.scoreFor === 5 && [3, 4].includes(x.scoreAgainst))) {
    return ['Amateur', 6.0];
  }
  
  return ['Amateur', 6.0]; // Default fallback placement
}

/**
 * Calculates RXP earned from a match.
 * Min: 20 RXP, Max: 35 RXP. Returns 0 if lost (sf <= sa).
 */
export function rxp({ sf, sa, k, d, a, place }) {
  if (sf <= sa) return 0; // Losses don't earn match RXP directly (handled via /claim)

  // Base RXP depending on round differential score
  const matchBase = { 0: 15, 1: 13, 2: 11, 3: 9, 4: 7 }[sa] ?? 7;

  // Individual combat contribution (scaled down to fit 20-35 range)
  const individual = Math.min(k * 1.5, 12) + Math.min(a * 0.5, 4) - Math.min(d * 1, 6);

  // Placement bonus within the team/match
  const posBonus = place === 1 ? 8 : place === 2 ? 5 : place === 3 ? 3 : 0;

  // Sum up and clamp strictly between 20 (min) and 35 (max)
  const total = Math.round(matchBase + individual + posBonus);
  return Math.max(20, Math.min(35, total));
}
