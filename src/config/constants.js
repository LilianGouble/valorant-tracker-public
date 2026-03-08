// Détection intelligente de l'URL de l'API. 
// 1. Cherche une variable d'environnement VITE_API_URL (Pour la prod personnalisée)
// 2. Sinon, en mode DEV, tape sur localhost:3001
// 3. Sinon, en PROD, suppose que le backend est sur le même domaine (ex: proxy Nginx)
export const LOCAL_SERVER_URL = import.meta.env.VITE_API_URL || 
  (import.meta.env.MODE === 'development' ? "http://localhost:3001" : window.location.origin);

// UUID Actuel et stable pour les icônes de rang (Épisode 5+ avec le rang Ascendant)
const TIER_UUID = "03621f52-342b-cf4e-4f86-9350a49c6d04";

// --- RANKS (Utilisé pour le système de valeurs/graphiques) ---
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

// Mapping précis pour récupérer l'icône exacte (ex: Diamant 2, Plat 3, etc.)
const EXACT_TIER_INDEX = {
    'UNRATED': 0,
    'IRON 1': 3, 'IRON 2': 4, 'IRON 3': 5,
    'BRONZE 1': 6, 'BRONZE 2': 7, 'BRONZE 3': 8,
    'SILVER 1': 9, 'SILVER 2': 10, 'SILVER 3': 11,
    'GOLD 1': 12, 'GOLD 2': 13, 'GOLD 3': 14,
    'PLATINUM 1': 15, 'PLATINUM 2': 16, 'PLATINUM 3': 17,
    'DIAMOND 1': 18, 'DIAMOND 2': 19, 'DIAMOND 3': 20,
    'ASCENDANT 1': 21, 'ASCENDANT 2': 22, 'ASCENDANT 3': 23,
    'IMMORTAL 1': 24, 'IMMORTAL 2': 25, 'IMMORTAL 3': 26,
    'RADIANT': 27
};

export const getRankIcon = (tierName) => {
    if (!tierName || typeof tierName !== 'string') return RANK_TIERS[0].icon;
    
    // On met en majuscules (ex: "Diamond 2" devient "DIAMOND 2")
    const cleanName = tierName.toUpperCase().trim();

    // 1. On vérifie si on a une correspondance exacte dans notre dictionnaire
    if (EXACT_TIER_INDEX[cleanName] !== undefined) {
        return `https://media.valorant-api.com/competitivetiers/${TIER_UUID}/${EXACT_TIER_INDEX[cleanName]}/largeicon.png`;
    }

    // 2. Si ça échoue (ex: on reçoit juste "PLATINUM"), on fait le comportement de secours (fallback)
    const baseName = cleanName.replace(/[0-9 ]/g, '');
    const found = RANK_TIERS.find(t => t.label === baseName);
    return found ? found.icon : RANK_TIERS[0].icon;
};