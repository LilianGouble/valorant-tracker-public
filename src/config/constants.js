// Détection intelligente de l'URL de l'API. 
// 1. Cherche une variable d'environnement VITE_API_URL (Pour la prod personnalisée)
// 2. Sinon, en mode DEV, tape sur localhost:3001
// 3. Sinon, en PROD, suppose que le backend est sur le même domaine (ex: proxy Nginx)
export const LOCAL_SERVER_URL = import.meta.env.VITE_API_URL || 
  (import.meta.env.MODE === 'development' ? "http://localhost:3001" : window.location.origin);

// UUID Actuel et stable pour les icônes de rang
const TIER_UUID = "564d8e28-c226-3180-6285-e48a390db8b1";

// --- RANKS ---
export const RANK_TIERS = [
    { value: 0, label: 'UNRATED', icon: `https://media.valorant-api.com/competitivetiers/${TIER_UUID}/0/largeicon.png` },
    { value: 300, label: 'IRON', icon: `https://media.valorant-api.com/competitivetiers/${TIER_UUID}/3/largeicon.png` },
    { value: 400, label: 'BRONZE', icon: `https://media.valorant-api.com/competitivetiers/${TIER_UUID}/6/largeicon.png` },
    { value: 500, label: 'SILVER', icon: `https://media.valorant-api.com/competitivetiers/${TIER_UUID}/9/largeicon.png` },
    { value: 600, label: 'GOLD', icon: `https://media.valorant-api.com/competitivetiers/${TIER_UUID}/12/largeicon.png` },
    { value: 700, label: 'PLATINUM', icon: `https://media.valorant-api.com/competitivetiers/${TIER_UUID}/15/largeicon.png` },
    { value: 800, label: 'DIAMOND', icon: `https://media.valorant-api.com/competitivetiers/${TIER_UUID}/18/largeicon.png` },
    { value: 900, label: 'ASCENDANT', icon: `https://media.valorant-api.com/competitivetiers/${TIER_UUID}/21/largeicon.png` },
    { value: 1000, label: 'IMMORTAL', icon: `https://media.valorant-api.com/competitivetiers/${TIER_UUID}/24/largeicon.png` },
    { value: 1100, label: 'RADIANT', icon: `https://media.valorant-api.com/competitivetiers/${TIER_UUID}/27/largeicon.png` }
];

export const getRankIcon = (tierName) => {
    if (!tierName || typeof tierName !== 'string') return RANK_TIERS[0].icon;
    const cleanName = tierName.toUpperCase().replace(/[0-9 ]/g, '');
    const found = RANK_TIERS.find(t => t.label === cleanName);
    return found ? found.icon : RANK_TIERS[0].icon;
};