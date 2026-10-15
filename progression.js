export const RANK_CONFIG = {
  Amateur: { 
    minRxp: 200, 
    ratingUpgradeRxp: 300, 
    maxRxp: 350, 
    baseRating: 6.0, 
    midRating: 6.5, 
    nextRank: "Contender" 
  },
  Contender: { 
    minRxp: 400, 
    ratingUpgradeRxp: 500, 
    maxRxp: 600, 
    baseRating: 7.0, 
    midRating: 7.5, 
    nextRank: "Comp" 
  },
  Comp: { 
    minRxp: 600, 
    ratingUpgradeRxp: 700, 
    maxRxp: 850, 
    baseRating: 7.0, 
    midRating: 8.0, 
    nextRank: "Elite" 
  },
};

export function getRxpDisplay(rank, rxp) {
  const config = RANK_CONFIG[rank];
  if (!config) return `${rxp} / 100`;
  return `${rxp}/${config.maxRxp}`;
}

export function checkRankProgression(playerData) {
  let { rank, rxp, rating } = playerData;
  const config = RANK_CONFIG[rank];

  if (!config) return { rank, rxp, rating };

  // Mid-rank rating upgrade check
  if (rxp >= config.ratingUpgradeRxp && rxp < config.maxRxp) {
    if (rating < config.midRating) {
      rating = config.midRating;
    }
  }

  // Rank promotion check
  if (rxp >= config.maxRxp && config.nextRank) {
    const nextConfig = RANK_CONFIG[config.nextRank];
    rank = config.nextRank;
    if (nextConfig) {
      rating = nextConfig.baseRating;
    }
  }

  return { rank, rxp, rating };
}
