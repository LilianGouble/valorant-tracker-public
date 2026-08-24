// ==========================================
// OPTIMISEUR DE SENSIBILITÉ (recherche adaptative)
// ==========================================
// Aide à trouver la sensibilité optimale via des manches "The Range Hard".
// À chaque manche l'utilisateur entre son score (kills/30) et son temps ;
// on calcule un score de performance, et l'algo propose la prochaine sens à
// tester par recherche de section dorée (golden-section) robuste au bruit humain.

const PHI = (Math.sqrt(5) - 1) / 2; // ~0.618, ratio d'or

// Score de performance d'une manche. Plus haut = meilleur.
// Combine précision (kills/30) et vitesse (bonus si rapide). 30 bots à The Range.
// perfScore ∈ [0, ~1.5] : 1.0 = 30/30 à ~30s ; >1 = 30/30 plus rapide.
export const perfScore = ({ kills, timeSec }) => {
    const accuracy = Math.max(0, Math.min(30, kills)) / 30;      // 0..1
    // Vitesse : 30s = référence (facteur 1). 20s → ~1.2, 45s → ~0.75.
    const speed = timeSec > 0 ? Math.min(1.5, 30 / timeSec) : 0;
    // La précision prime (poids 0.7), la vitesse affine (poids 0.3).
    return +(accuracy * (0.7 + 0.3 * speed)).toFixed(4);
};

// Convertit sens Valorant + DPI en eDPI (mesure comparable entre configs).
export const edpi = (sens, dpi) => Math.round((Number(sens) || 0) * (Number(dpi) || 0));

/**
 * Moteur de session d'optimisation.
 * État : { bounds:[a,b], trials:[{sens,kills,timeSec,score}], phase }
 * On repart d'une sens de départ, on borne l'intervalle de recherche autour,
 * puis on resserre via golden-section à mesure que les résultats arrivent.
 */

// Crée une nouvelle session à partir d'une sens de départ.
export const createSession = (startSens) => {
    const s = Number(startSens) || 0.4;
    // Fourchette de recherche : ±35% autour de la sens de départ (large mais réaliste).
    const a = +(s * 0.65).toFixed(3);
    const b = +(s * 1.35).toFixed(3);
    return { bounds: [a, b], trials: [], startSens: s };
};

// Enregistre le résultat d'une manche et renvoie la session mise à jour.
export const addTrial = (session, { sens, kills, timeSec }) => {
    const score = perfScore({ kills, timeSec });
    const trials = [...session.trials, { sens: +Number(sens).toFixed(3), kills, timeSec, score }];
    return { ...session, trials };
};

// Meilleure manche enregistrée (score le plus haut).
export const bestTrial = (session) => {
    if (session.trials.length === 0) return null;
    return session.trials.reduce((b, t) => (t.score > b.score ? t : b), session.trials[0]);
};

/**
 * Propose la prochaine sensibilité à tester.
 * Stratégie :
 *  - Manches 1-2 : on teste les deux points internes de golden-section (exploration).
 *  - Ensuite : on resserre l'intervalle autour du meilleur des deux points internes,
 *    façon golden-section, jusqu'à ce que la fourchette soit assez étroite.
 * Renvoie { sens, done, reason }.
 */
export const nextSens = (session) => {
    const [a, b] = session.bounds;
    const n = session.trials.length;

    // Deux points internes de la section dorée
    const c = +(b - PHI * (b - a)).toFixed(3);
    const d = +(a + PHI * (b - a)).toFixed(3);

    // Convergence : intervalle resserré à < 6% de la sens de départ → terminé.
    if ((b - a) <= session.startSens * 0.06 && n >= 4) {
        return { sens: bestTrial(session)?.sens ?? c, done: true, reason: 'Fourchette resserrée : sens optimale trouvée.' };
    }
    if (n >= 8) {
        return { sens: bestTrial(session)?.sens ?? c, done: true, reason: 'Assez de manches : on garde la meilleure.' };
    }

    // Trouve quel point interne n'a pas encore de manche proche (< 2% d'écart)
    const near = (target) => session.trials.some(t => Math.abs(t.sens - target) < session.startSens * 0.02);
    if (!near(c)) return { sens: c, done: false, reason: `Teste ${c} (borne basse de la zone d'or).` };
    if (!near(d)) return { sens: d, done: false, reason: `Teste ${d} (borne haute de la zone d'or).` };

    // Les deux points internes ont été testés : on resserre l'intervalle.
    const scoreAt = (target) => {
        const t = session.trials.filter(x => Math.abs(x.sens - target) < session.startSens * 0.03);
        if (t.length === 0) return -1;
        return t.reduce((s, x) => s + x.score, 0) / t.length; // moyenne (robuste au bruit)
    };
    const fc = scoreAt(c), fd = scoreAt(d);
    // Le max est du côté du meilleur point interne → on réduit l'intervalle opposé.
    const newBounds = fc >= fd ? [a, d] : [c, b];
    const narrowed = { ...session, bounds: newBounds };
    // On relance le calcul sur l'intervalle resserré (récursion peu profonde, sûre).
    return nextSens(narrowed);
};

// Repères de sensibilité pro (eDPI typiques par style, pour se situer).
export const EDPI_REFERENCES = [
    { label: 'Très bas (snipers, contrôle max)', min: 100, max: 200 },
    { label: 'Bas (majorité des pros)', min: 200, max: 320 },
    { label: 'Moyen (polyvalent)', min: 320, max: 450 },
    { label: 'Élevé (duellistes agressifs)', min: 450, max: 600 },
    { label: 'Très élevé (rare)', min: 600, max: 1000 },
];

export const edpiCategory = (value) => {
    const r = EDPI_REFERENCES.find(x => value >= x.min && value < x.max);
    return r ? r.label : (value < 100 ? 'Extrêmement bas' : 'Hors normes');
};
