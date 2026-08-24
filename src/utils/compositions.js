// ==========================================
// MOTEUR DE RECOMMANDATION DE COMPOSITIONS
// ==========================================
// À partir des matchs, calcule le pool d'agents (maîtrise) de chaque joueur,
// puis pour une map donnée propose des compos-types méta et assigne le meilleur
// agent à chaque joueur — en évitant les doublons et en couvrant tous les rôles.

export const AGENT_ROLES = {
    Jett: 'Duelist', Phoenix: 'Duelist', Reyna: 'Duelist', Raze: 'Duelist', Yoru: 'Duelist', Neon: 'Duelist', Iso: 'Duelist',
    Brimstone: 'Controller', Viper: 'Controller', Omen: 'Controller', Astra: 'Controller', Harbor: 'Controller', Clove: 'Controller',
    Sova: 'Initiator', Breach: 'Initiator', Skye: 'Initiator', 'KAY/O': 'Initiator', Fade: 'Initiator', Gekko: 'Initiator', Tejo: 'Initiator',
    Killjoy: 'Sentinel', Cypher: 'Sentinel', Sage: 'Sentinel', Chamber: 'Sentinel', Deadlock: 'Sentinel', Vyse: 'Sentinel',
};

export const ROLE_COLORS = {
    Duelist: '#ef4444', Initiator: '#eab308', Controller: '#3b82f6', Sentinel: '#10b981',
};

// Compositions méta par map (rôles + agents recommandés par slot, du plus au moins méta).
// Une compo = 5 slots ; chaque slot liste les agents viables pour ce rôle sur cette map.
// Source : méta ranked classique (adaptable). "flex" = slot laissé au meilleur choix.
const MAP_COMPS = {
    Ascent: [
        { slot: 'Controller', agents: ['Omen', 'Astra'] },
        { slot: 'Initiator', agents: ['Sova', 'KAY/O'] },
        { slot: 'Initiator', agents: ['Fade', 'Gekko'] },
        { slot: 'Sentinel', agents: ['Killjoy', 'Cypher'] },
        { slot: 'Duelist', agents: ['Jett', 'Raze', 'Iso'] },
    ],
    Bind: [
        { slot: 'Controller', agents: ['Brimstone', 'Astra'] },
        { slot: 'Initiator', agents: ['Skye', 'Fade', 'Gekko'] },
        { slot: 'Sentinel', agents: ['Cypher', 'Vyse'] },
        { slot: 'Duelist', agents: ['Raze', 'Yoru', 'Jett'] },
        { slot: 'Initiator', agents: ['KAY/O', 'Sova'] },
    ],
    Haven: [
        { slot: 'Controller', agents: ['Omen', 'Astra', 'Brimstone'] },
        { slot: 'Initiator', agents: ['Sova', 'Fade'] },
        { slot: 'Sentinel', agents: ['Killjoy', 'Cypher'] },
        { slot: 'Duelist', agents: ['Jett', 'Phoenix'] },
        { slot: 'Initiator', agents: ['Breach', 'KAY/O', 'Gekko'] },
    ],
    Split: [
        { slot: 'Controller', agents: ['Omen', 'Astra'] },
        { slot: 'Sentinel', agents: ['Cypher', 'Killjoy', 'Sage'] },
        { slot: 'Initiator', agents: ['Sova', 'Skye', 'Fade'] },
        { slot: 'Duelist', agents: ['Raze', 'Jett'] },
        { slot: 'Initiator', agents: ['Breach', 'KAY/O'] },
    ],
    Lotus: [
        { slot: 'Controller', agents: ['Omen', 'Harbor', 'Astra'] },
        { slot: 'Initiator', agents: ['Fade', 'Skye'] },
        { slot: 'Initiator', agents: ['Gekko', 'Sova', 'KAY/O'] },
        { slot: 'Sentinel', agents: ['Killjoy', 'Cypher', 'Vyse'] },
        { slot: 'Duelist', agents: ['Raze', 'Jett', 'Neon'] },
    ],
    Sunset: [
        { slot: 'Controller', agents: ['Omen', 'Clove'] },
        { slot: 'Initiator', agents: ['Fade', 'Sova'] },
        { slot: 'Sentinel', agents: ['Cypher', 'Killjoy'] },
        { slot: 'Duelist', agents: ['Raze', 'Jett', 'Phoenix'] },
        { slot: 'Initiator', agents: ['Gekko', 'Breach', 'KAY/O'] },
    ],
    Icebox: [
        { slot: 'Controller', agents: ['Viper', 'Harbor'] },
        { slot: 'Sentinel', agents: ['Killjoy', 'Sage'] },
        { slot: 'Initiator', agents: ['Sova', 'Fade'] },
        { slot: 'Duelist', agents: ['Jett', 'Reyna'] },
        { slot: 'Initiator', agents: ['Kay/O', 'Gekko', 'Breach'] },
    ],
    Breeze: [
        { slot: 'Controller', agents: ['Viper', 'Harbor'] },
        { slot: 'Initiator', agents: ['Sova', 'Fade'] },
        { slot: 'Sentinel', agents: ['Cypher', 'Vyse'] },
        { slot: 'Duelist', agents: ['Jett', 'Neon'] },
        { slot: 'Initiator', agents: ['Gekko', 'KAY/O'] },
    ],
    Fracture: [
        { slot: 'Controller', agents: ['Brimstone', 'Viper'] },
        { slot: 'Initiator', agents: ['Breach', 'Fade'] },
        { slot: 'Initiator', agents: ['Sova', 'Gekko', 'KAY/O'] },
        { slot: 'Sentinel', agents: ['Killjoy', 'Cypher'] },
        { slot: 'Duelist', agents: ['Raze', 'Neon'] },
    ],
    Pearl: [
        { slot: 'Controller', agents: ['Astra', 'Harbor', 'Omen'] },
        { slot: 'Initiator', agents: ['Fade', 'Sova'] },
        { slot: 'Sentinel', agents: ['Killjoy', 'Cypher'] },
        { slot: 'Duelist', agents: ['Jett', 'Neon'] },
        { slot: 'Initiator', agents: ['KAY/O', 'Gekko'] },
    ],
    Abyss: [
        { slot: 'Controller', agents: ['Omen', 'Clove', 'Astra'] },
        { slot: 'Initiator', agents: ['Sova', 'Fade'] },
        { slot: 'Sentinel', agents: ['Cypher', 'Killjoy'] },
        { slot: 'Duelist', agents: ['Neon', 'Raze', 'Jett'] },
        { slot: 'Initiator', agents: ['Gekko', 'KAY/O'] },
    ],
};

export const AVAILABLE_MAPS = Object.keys(MAP_COMPS);

// Calcule le pool d'agents (maîtrise) de chaque joueur à partir des matchs ranked.
// Maîtrise = score composite games joués + winrate, borné.
export const computeAgentPools = (matches, playersConfig) => {
    const pools = {}; // playerId -> { agentName -> { games, wins, mastery } }
    playersConfig.forEach(p => { pools[p.id] = {}; });

    matches.forEach(m => {
        if (m.type !== 'ranked' || !m.agent || !pools[m.playerId]) return;
        const a = m.agent;
        if (!AGENT_ROLES[a]) return;
        const pool = pools[m.playerId];
        if (!pool[a]) pool[a] = { games: 0, wins: 0 };
        pool[a].games++;
        if (m.result === 'WIN') pool[a].wins++;
    });

    // Score de maîtrise : expérience (log des games) pondérée par le winrate.
    Object.values(pools).forEach(pool => {
        Object.values(pool).forEach(s => {
            const wr = s.games > 0 ? s.wins / s.games : 0.5;
            s.mastery = Math.log2(s.games + 1) * (0.6 + 0.8 * wr); // games comptent + WR ajuste
            s.winrate = Math.round(wr * 100);
        });
    });
    return pools;
};

// Maîtrise d'un joueur pour un agent (0 si jamais joué → léger malus mais pas rédhibitoire).
const masteryOf = (pool, agent) => pool[agent]?.mastery ?? 0;

/**
 * Recommande une compo pour une map et un ensemble de joueurs présents.
 * Résout l'assignation (joueur → agent) pour maximiser la maîtrise totale
 * en couvrant chaque slot de la compo méta, sans doublon d'agent.
 *
 * Algorithme : back-tracking glouton sur ≤5 joueurs (espace minuscule),
 * on garde la meilleure combinaison par somme de maîtrise.
 */
export const recommendComposition = (map, presentPlayers, pools) => {
    const comp = MAP_COMPS[map];
    if (!comp || presentPlayers.length === 0) return null;

    const slots = comp.slice(0, presentPlayers.length); // si <5 joueurs, on prend les 1ers slots
    let best = null;

    // Essaie d'assigner chaque joueur à un slot (permutations joueurs↔slots).
    const assignRec = (slotIdx, remainingPlayers, usedAgents, acc, score) => {
        if (slotIdx === slots.length) {
            if (!best || score > best.score) best = { assignments: [...acc], score };
            return;
        }
        const slot = slots[slotIdx];
        for (let i = 0; i < remainingPlayers.length; i++) {
            const player = remainingPlayers[i];
            const pool = pools[player.id] || {};
            // Meilleur agent de ce slot que ce joueur peut prendre (non déjà utilisé)
            let bestAgent = null, bestM = -1;
            for (const agent of slot.agents) {
                if (usedAgents.has(agent)) continue;
                const m = masteryOf(pool, agent);
                if (m > bestM) { bestM = m; bestAgent = agent; }
            }
            if (!bestAgent) continue; // ce joueur ne peut rien prendre ici
            const rest = remainingPlayers.filter((_, j) => j !== i);
            usedAgents.add(bestAgent);
            acc.push({ player, agent: bestAgent, role: slot.slot, mastery: bestM, fromPool: bestM > 0, winrate: pool[bestAgent]?.winrate ?? null, games: pool[bestAgent]?.games ?? 0 });
            assignRec(slotIdx + 1, rest, usedAgents, acc, score + bestM);
            acc.pop();
            usedAgents.delete(bestAgent);
        }
    };
    assignRec(0, presentPlayers, new Set(), [], 0);

    if (!best) return null;

    // Bilan de rôles + détection des trous (ex: pas de sentinelle)
    const roleCount = { Duelist: 0, Initiator: 0, Controller: 0, Sentinel: 0 };
    best.assignments.forEach(a => { roleCount[a.role]++; });
    const warnings = [];
    if (roleCount.Controller === 0) warnings.push("Aucun contrôleur — les fumigènes vont manquer pour prendre les sites.");
    if (roleCount.Sentinel === 0 && presentPlayers.length >= 4) warnings.push("Aucune sentinelle — les flancs seront vulnérables.");
    if (roleCount.Duelist === 0 && presentPlayers.length >= 4) warnings.push("Aucun duelliste — personne pour ouvrir les rounds.");
    if (roleCount.Initiator === 0 && presentPlayers.length >= 4) warnings.push("Aucun initiateur — peu d'infos pour attaquer.");

    // Joueurs sur un agent hors de leur pool (à surveiller)
    const stretched = best.assignments.filter(a => !a.fromPool).map(a => a.player.name);

    return { map, assignments: best.assignments, roleCount, warnings, stretched };
};
