

// Progression thresholds and targets
export const RANK_CONFIG = {
  Amateur: { minRxp: 200, ratingUpgradeRxp: 300, maxRxp: 350, baseRating: 6.0, midRating: 6.5, nextRank: "Contender" },
  Contender: { minRxp: 400, ratingUpgradeRxp: 500, maxRxp: 600, baseRating: 7.0, midRating: 7.5, nextRank: "Comp" },
  Comp: { minRxp: 600, ratingUpgradeRxp: 700, maxRxp: 850, baseRating: 7.0, midRating: 8.0, nextRank: "Elite" },
};

/**
 * Returns RXP display format (e.g. "RXP : 200/350") based on player's current rank
 */
export function getRxpDisplay(rank, rxp) {
  const config = RANK_CONFIG[rank];
  if (!config) return `${rxp} / 100`; // Fallback for ranks outside defined config
  return `${rxp}/${config.maxRxp}`;
}

/**
 * Evaluates player RXP updates, auto-upgrades ratings at milestones, and promotes rank
 */
export function checkRankProgression(playerData) {
  let { rank, rxp, rating } = playerData;
  const config = RANK_CONFIG[rank];

  if (!config) return { rank, rxp, rating };

  // 1. Check Mid-Rank Rating Upgrades
  if (rxp >= config.ratingUpgradeRxp && rxp < config.maxRxp) {
    if (rating < config.midRating) {
      rating = config.midRating; // Upgrade rating at threshold
    }
  }

  // 2. Check Rank Promotions
  if (rxp >= config.maxRxp && config.nextRank) {
    const nextConfig = RANK_CONFIG[config.nextRank];
    rank = config.nextRank;
    if (nextConfig) {
      rating = nextConfig.baseRating; // Set starting rating for the new rank
    }
  }

  return { rank, rxp, rating };
}
