// ==========================================
// HELPERS JOUEURS (source unique de vérité)
// ==========================================
// Centralise la correspondance puuid ↔ config joueur. Rappel d'architecture :
// players.id n'est PAS le puuid Riot (c'est p1/p2…), le vrai puuid est dans
// players.puuid. Toute résolution doit passer par ces helpers.

// Retrouve la config d'un joueur tracké à partir d'un puuid Riot.
export const findCfgByPuuid = (cfgs, puuid) => {
    if (!puuid || !cfgs) return null;
    const lp = puuid.toLowerCase();
    return cfgs.find(c =>
        (c.puuid && c.puuid.toLowerCase() === lp)
        || c.id.toLowerCase() === lp
    ) || null;
};

// Couleur d'un joueur (fallback rouge si inconnu).
export const getPlayerColor = (puuid, playersConfig) => {
    const cfg = findCfgByPuuid(playersConfig, puuid);
    return cfg ? cfg.color : '#ff0000';
};

// Un joueur (objet all_players) est-il un membre tracké de l'escouade ?
export const isTrackedPlayer = (player, playersConfig) => {
    if (!player) return false;
    return !!findCfgByPuuid(playersConfig, player.puuid)
        || (player.name && playersConfig.some(c => c.name.toLowerCase() === player.name.toLowerCase()));
};

// Taille du groupe pré-game pour un match donné.
export const getGroupSize = (match, playersConfig) => {
    if (!match.allPlayers || !playersConfig) return 1;
    const groupMembers = match.allPlayers.filter(p => isTrackedPlayer(p, playersConfig));
    if (groupMembers.length > 1) return groupMembers.length;
    if (match.partyId) return match.allPlayers.filter(p => p.party_id === match.partyId).length;
    return 1;
};
