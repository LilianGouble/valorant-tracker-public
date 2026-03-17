import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import cron from 'node-cron';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3001;
const DB_FILE = path.join(__dirname, 'database.sqlite');
const API_BASE = "https://api.henrikdev.xyz/valorant";

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));

let db;

// --- INITIALISATION DE LA BASE DE DONNÉES ---
(async () => {
    db = await open({ filename: DB_FILE, driver: sqlite3.Database });
    
    // Création de toutes les tables nécessaires
    await db.exec(`
        CREATE TABLE IF NOT EXISTS matches (
            id TEXT PRIMARY KEY,
            player_id TEXT,
            date INTEGER,
            data TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_player ON matches(player_id);
        CREATE INDEX IF NOT EXISTS idx_date ON matches(date);

        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password_hash TEXT,
            needs_password_change INTEGER DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS config (
            key TEXT PRIMARY KEY,
            value TEXT
        );

        CREATE TABLE IF NOT EXISTS players (
            id TEXT PRIMARY KEY,
            name TEXT,
            tag TEXT,
            region TEXT,
            color TEXT
        );

        CREATE TABLE IF NOT EXISTS api_keys (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key TEXT UNIQUE
        );

        CREATE TABLE IF NOT EXISTS tournaments (
            id TEXT PRIMARY KEY,
            name TEXT,
            date TEXT,
            players TEXT,
            bracket TEXT
        );
    `);

    // 1. Initialiser le secret JWT s'il n'existe pas
    let jwtSecretRow = await db.get("SELECT value FROM config WHERE key = 'jwt_secret'");
    if (!jwtSecretRow) {
        const secret = crypto.randomBytes(64).toString('hex');
        await db.run("INSERT INTO config (key, value) VALUES ('jwt_secret', ?)", [secret]);
    }

    // 2. Initialiser le compte Admin par défaut (admin / admin) s'il n'y a aucun utilisateur
    const adminUser = await db.get("SELECT * FROM users WHERE username = 'admin'");
    if (!adminUser) {
        const hash = await bcrypt.hash('admin', 10);
        await db.run("INSERT INTO users (username, password_hash, needs_password_change) VALUES (?, ?, 1)", ['admin', hash]);
        console.log("🔒 Compte administrateur par défaut créé (admin / admin).");
    }

    // 3. Configurations par défaut manquantes
    await db.run("INSERT OR IGNORE INTO config (key, value) VALUES ('webhook_url', '')");
    await db.run("INSERT OR IGNORE INTO config (key, value) VALUES ('app_url', 'http://localhost:5173')");
    await db.run("INSERT OR IGNORE INTO config (key, value) VALUES ('challenge_start_date', '2024-01-01T00:00')");

    // 4. NETTOYAGE DES FAUX MATCHS SKIRMISH (Dû au bug de l'API)
    await db.run("DELETE FROM matches WHERE data LIKE '%\"type\":\"skirmish\"%'");
    console.log("🧹 Base de données nettoyée des matchs Skirmish corrompus.");

    console.log("✅ Connecté à la base SQLite & Initialisation terminée.");
    
    setTimeout(() => {
        syncAllPlayers();
    }, 5000);
})();

// --- HELPERS BASE DE DONNÉES ---
const getConfig = async (key, defaultVal = '') => {
    const row = await db.get("SELECT value FROM config WHERE key = ?", [key]);
    return row ? row.value : defaultVal;
};
const getPlayers = async () => await db.all("SELECT * FROM players");
const getApiKeys = async () => (await db.all("SELECT key FROM api_keys")).map(r => r.key);

// --- AUTHENTIFICATION MIDDLEWARE ---
const authenticateToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: "Non autorisé" });

    const secret = await getConfig('jwt_secret');
    jwt.verify(token, secret, (err, user) => {
        if (err) return res.status(403).json({ error: "Token invalide ou expiré" });
        req.user = user;
        next();
    });
};

// ==========================================
// ROUTES : AUTHENTIFICATION & CONFIG (ADMIN)
// ==========================================

app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await db.get("SELECT * FROM users WHERE username = ?", [username]);

    if (!user) return res.status(400).json({ error: "Identifiants incorrects" });

    const validPass = await bcrypt.compare(password, user.password_hash);
    if (!validPass) return res.status(400).json({ error: "Identifiants incorrects" });

    const secret = await getConfig('jwt_secret');
    const token = jwt.sign({ id: user.id, username: user.username }, secret, { expiresIn: '24h' });

    res.json({ 
        token, 
        needsPasswordChange: user.needs_password_change === 1 
    });
});

app.post('/api/auth/change-password', authenticateToken, async (req, res) => {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({ error: "Le mot de passe doit faire au moins 6 caractères" });
    }
    const hash = await bcrypt.hash(newPassword, 10);
    await db.run("UPDATE users SET password_hash = ?, needs_password_change = 0 WHERE id = ?", [hash, req.user.id]);
    res.json({ message: "Mot de passe mis à jour avec succès" });
});

// Récupération de la config publique pour le Frontend
app.get('/api/public/config', async (req, res) => {
    try {
        const players = await getPlayers();
        const appUrl = await getConfig('app_url', 'http://localhost:5173');
        const challengeStartDate = await getConfig('challenge_start_date', '2024-01-01T00:00');
        res.json({ players, appUrl, challengeStartDate });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Admin : Config Webhook & App URL
app.get('/api/admin/config', authenticateToken, async (req, res) => {
    const webhook_url = await getConfig('webhook_url');
    const app_url = await getConfig('app_url');
    const challenge_start_date = await getConfig('challenge_start_date');
    res.json({ webhook_url, app_url, challenge_start_date });
});

app.post('/api/admin/config', authenticateToken, async (req, res) => {
    const { webhook_url, app_url, challenge_start_date } = req.body;
    if (webhook_url !== undefined) await db.run("UPDATE config SET value = ? WHERE key = 'webhook_url'", [webhook_url]);
    if (app_url !== undefined) await db.run("UPDATE config SET value = ? WHERE key = 'app_url'", [app_url]);
    if (challenge_start_date !== undefined) await db.run("UPDATE config SET value = ? WHERE key = 'challenge_start_date'", [challenge_start_date]);
    res.json({ message: "Configuration sauvegardée" });
});

// Admin : Gestion des Joueurs
app.get('/api/admin/players', authenticateToken, async (req, res) => {
    const players = await getPlayers();
    res.json(players);
});

app.post('/api/admin/players', authenticateToken, async (req, res) => {
    const { name, tag, region, color } = req.body;
    const countRow = await db.get("SELECT COUNT(*) as count FROM players");
    const id = `p${countRow.count + 1}_${Date.now()}`;
    await db.run("INSERT INTO players (id, name, tag, region, color) VALUES (?, ?, ?, ?, ?)", [id, name, tag, region, color || '#ffffff']);
    res.json({ message: "Joueur ajouté", id });
});

app.delete('/api/admin/players/:id', authenticateToken, async (req, res) => {
    await db.run("DELETE FROM players WHERE id = ?", [req.params.id]);
    res.json({ message: "Joueur supprimé" });
});

// Admin : Gestion des Clés API
app.get('/api/admin/keys', authenticateToken, async (req, res) => {
    const keys = await db.all("SELECT id, key FROM api_keys");
    res.json(keys);
});

app.post('/api/admin/keys', authenticateToken, async (req, res) => {
    const { key } = req.body;
    try {
        await db.run("INSERT INTO api_keys (key) VALUES (?)", [key]);
        res.json({ message: "Clé ajoutée" });
    } catch (e) {
        res.status(400).json({ error: "Cette clé existe déjà" });
    }
});

app.delete('/api/admin/keys/:id', authenticateToken, async (req, res) => {
    await db.run("DELETE FROM api_keys WHERE id = ?", [req.params.id]);
    res.json({ message: "Clé supprimée" });
});

// ==========================================
// ROUTES : TOURNOIS
// ==========================================

app.get('/api/public/tournaments', async (req, res) => {
    try {
        const rows = await db.all("SELECT * FROM tournaments ORDER BY date DESC");
        res.json(rows.map(r => ({ ...r, players: JSON.parse(r.players), bracket: JSON.parse(r.bracket) })));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/admin/tournaments', authenticateToken, async (req, res) => {
    const rows = await db.all("SELECT * FROM tournaments ORDER BY date DESC");
    res.json(rows.map(r => ({ ...r, players: JSON.parse(r.players), bracket: JSON.parse(r.bracket) })));
});

app.post('/api/admin/tournaments', authenticateToken, async (req, res) => {
    const { name, date, players } = req.body;
    const id = `tourney_${Date.now()}`;
    
    // NOUVEL ALGO : Distribution parfaite des "BYE" pour éviter les "BYE vs BYE"
    const shuffled = [...players].sort(() => 0.5 - Math.random());
    const nextPowerOf2 = Math.pow(2, Math.ceil(Math.log2(shuffled.length)));
    const numByes = nextPowerOf2 - shuffled.length;
    
    const rounds = [];
    const round1 = [];
    let playerIdx = 0;
    
    // 1. On crée les matchs contre les "BYE"
    for(let i=0; i<numByes; i++) {
        round1.push({ player1: shuffled[playerIdx], player2: 'BYE', winner: shuffled[playerIdx], score: '' });
        playerIdx++;
    }
    // 2. On crée les matchs normaux entre joueurs restants
    while(playerIdx < shuffled.length) {
        round1.push({ player1: shuffled[playerIdx], player2: shuffled[playerIdx+1], winner: null, score: '' });
        playerIdx += 2;
    }
    
    // 3. On mélange le Round 1 pour que les BYEs ne soient pas tous en haut de l'arbre
    round1.sort(() => 0.5 - Math.random());
    rounds.push(round1);

    // 4. Génération de l'arbre vide
    let currentMatches = round1.length;
    while (currentMatches > 1) {
        currentMatches /= 2;
        const nextRound = [];
        for (let i = 0; i < currentMatches; i++) {
            nextRound.push({ player1: null, player2: null, winner: null, score: '' });
        }
        rounds.push(nextRound);
    }

    // 5. Avancement automatique des gagnants par BYE au Round 2
    if (rounds.length > 1) {
        for (let i = 0; i < rounds[0].length; i++) {
            if (rounds[0][i].winner) {
                const nextMatchIndex = Math.floor(i / 2);
                const isPlayer1 = i % 2 === 0;
                if (isPlayer1) rounds[1][nextMatchIndex].player1 = rounds[0][i].winner;
                else rounds[1][nextMatchIndex].player2 = rounds[0][i].winner;
            }
        }
    }

    await db.run("INSERT INTO tournaments (id, name, date, players, bracket) VALUES (?, ?, ?, ?, ?)",
        [id, name, date, JSON.stringify(players), JSON.stringify(rounds)]);
    res.json({ message: "Tournoi créé avec succès", id });
});

// NOUVELLE ROUTE : MISE À JOUR D'UN MATCH DE TOURNOI
app.put('/api/admin/tournaments/:id/match', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { roundIndex, matchIndex, winner, score } = req.body;

    const row = await db.get("SELECT * FROM tournaments WHERE id = ?", [id]);
    if (!row) return res.status(404).json({ error: "Tournoi non trouvé" });

    const bracket = JSON.parse(row.bracket);
    const match = bracket[roundIndex][matchIndex];

    // Mise à jour
    match.winner = winner || null;
    match.score = score || '';

    // Si on a un gagnant et qu'on n'est pas en finale, on l'envoie au round suivant
    if (winner && roundIndex + 1 < bracket.length) {
        const nextMatchIndex = Math.floor(matchIndex / 2);
        const isPlayer1 = matchIndex % 2 === 0;
        
        if (isPlayer1) {
            bracket[roundIndex + 1][nextMatchIndex].player1 = winner;
        } else {
            bracket[roundIndex + 1][nextMatchIndex].player2 = winner;
        }
    }

    await db.run("UPDATE tournaments SET bracket = ? WHERE id = ?", [JSON.stringify(bracket), id]);
    res.json({ message: "Match mis à jour", bracket });
});

app.delete('/api/admin/tournaments/:id', authenticateToken, async (req, res) => {
    await db.run("DELETE FROM tournaments WHERE id = ?", [req.params.id]);
    res.json({ message: "Tournoi supprimé" });
});

// ==========================================
// LOGIQUE DE SCAN ET DE RECUPERATION
// ==========================================

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
let currentKeyIndex = 0;

const fetchWithRetry = async (url, apiKeys, options = {}, retries = 5) => {
  if (!apiKeys || apiKeys.length === 0) throw new Error("Aucune clé API configurée.");
  if (!options.headers) options.headers = {};
  
  for (let i = 0; i < retries; i++) {
    try {
      options.headers['Authorization'] = apiKeys[currentKeyIndex];
      const res = await fetch(url, options);
      if (res.status === 429) {
        if (apiKeys.length > 1) {
          currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;
          await delay(200);
          continue;
        } else {
          if (i === retries - 1) return res;
          await delay(2000 * (i + 1));
          continue;
        }
      }
      return res;
    } catch (err) {
      if (i === retries - 1) throw err;
      await delay(1500 * (i + 1));
    }
  }
};

const fetchPlayerData = async (player, apiKeys, allConfigPlayers) => {
    const headers = { 'Content-Type': 'application/json' };
    const FETCH_SIZE = 50; 
    const encodedName = encodeURIComponent(player.name.trim());
    const encodedTag = encodeURIComponent(player.tag.trim());
    const commonParams = `&size=${FETCH_SIZE}`;
    const cacheBuster = `&_t=${Date.now()}`;
    let newMatches = [];

    // DM
    try {
      const url = `${API_BASE}/v3/matches/${player.region}/${encodedName}/${encodedTag}?filter=deathmatch${commonParams}${cacheBuster}`;
      const dmResponse = await fetchWithRetry(url, apiKeys, { headers });
      const dmData = dmResponse.ok ? await dmResponse.json().catch(() => ({ data: [] })) : { data: [] };
      const cleanDmMatches = (dmData.data || []).filter(m => m.metadata?.mode === 'Deathmatch').map(m => {
        const playerStats = m.players?.all_players?.find(p => p.name.toLowerCase() === player.name.toLowerCase() && p.tag.toLowerCase() === player.tag.toLowerCase());
        if (!playerStats) return null;
        const sortedPlayers = [...(m.players?.all_players || [])].sort((a, b) => {
          const killsA = a.stats?.kills || 0; const killsB = b.stats?.kills || 0;
          if (killsB !== killsA) return killsB - killsA;
          const scoreA = a.stats?.score || 0; const scoreB = b.stats?.score || 0;
          if (scoreB !== scoreA) return scoreB - scoreA;
          return (a.stats?.deaths || 0) - (b.stats?.deaths || 0);
        });
        const placement = sortedPlayers.findIndex(p => p.puuid === playerStats.puuid) + 1;
        const rounds = m.metadata?.rounds_played || 1;
        return {
          id: m.metadata.matchid, type: 'dm', playerId: player.id, agent: playerStats.character, agentImg: playerStats.assets?.agent?.small || null,
          kills: playerStats.stats?.kills || 0, deaths: playerStats.stats?.deaths || 0, assists: playerStats.stats?.assists || 0,
          score: playerStats.stats?.score || 0, rounds: rounds, placement: placement,
          headshots: playerStats.stats?.headshots || 0, bodyshots: playerStats.stats?.bodyshots || 0, legshots: playerStats.stats?.legshots || 0,
          totalShots: (playerStats.stats?.bodyshots || 0) + (playerStats.stats?.legshots || 0) + (playerStats.stats?.headshots || 0),
          adr: Math.round((playerStats.stats?.score || 0) / rounds),
          allPlayers: m.players.all_players, date: m.metadata.game_start_patched, timestamp: m.metadata.game_start, map: m.metadata.map
        };
      }).filter(Boolean);
      newMatches = [...newMatches, ...cleanDmMatches];
    } catch (e) {}

    await delay(500);

    // TDM
    try {
      const url = `${API_BASE}/v3/matches/${player.region}/${encodedName}/${encodedTag}?filter=teamdeathmatch${commonParams}${cacheBuster}`;
      const tdmResponse = await fetchWithRetry(url, apiKeys, { headers });
      const tdmData = tdmResponse.ok ? await tdmResponse.json().catch(() => ({ data: [] })) : { data: [] };
      const cleanTdmMatches = (tdmData.data || []).filter(m => m.metadata?.mode === 'Team Deathmatch').map(m => {
        const playerStats = m.players?.all_players?.find(p => p.name.toLowerCase() === player.name.toLowerCase() && p.tag.toLowerCase() === player.tag.toLowerCase());
        if (!playerStats) return null;
        const b = m.teams?.blue?.rounds_won || 0; const r = m.teams?.red?.rounds_won || 0;
        const isWin = playerStats.team === 'Blue' ? (b > r) : (r > b);
        let matchScore = '0 - 0';
        if (m.teams && playerStats.team) {
            const myT = playerStats.team.toLowerCase(); const oppT = myT === 'blue' ? 'red' : 'blue';
            matchScore = `${m.teams[myT]?.rounds_won || 0} - ${m.teams[oppT]?.rounds_won || 0}`;
        }
        return {
          id: m.metadata.matchid, type: 'tdm', playerId: player.id, agent: playerStats.character, agentImg: playerStats.assets?.agent?.small || null,
          kills: playerStats.stats?.kills || 0, deaths: playerStats.stats?.deaths || 0, assists: playerStats.stats?.assists || 0, score: playerStats.stats?.score || 0,
          kd: (playerStats.stats?.deaths || 0) > 0 ? (playerStats.stats?.kills || 0) / playerStats.stats?.deaths : playerStats.stats?.kills || 0,
          adr: Math.round((playerStats.damage_made || 0) / 1), acs: Math.round((playerStats.stats?.score || 0) / 1),
          rounds: 1, roundsPlayed: 1, result: isWin ? 'WIN' : 'LOSS', scoreTeam: matchScore,
          map: m.metadata.map, date: m.metadata.game_start_patched, timestamp: m.metadata.game_start, allPlayers: m.players.all_players, myTeam: playerStats.team
        };
      }).filter(Boolean);
      newMatches = [...newMatches, ...cleanTdmMatches];
    } catch (e) {}

    await delay(500);

    // SKIRMISH (Filtre strict "Custom Game")
    try {
      const url = `${API_BASE}/v3/matches/${player.region}/${encodedName}/${encodedTag}?size=20${cacheBuster}`;
      const skirmishResponse = await fetchWithRetry(url, apiKeys, { headers });
      const skirmishData = skirmishResponse.ok ? await skirmishResponse.json().catch(() => ({ data: [] })) : { data: [] };
      
      if (skirmishData.data && skirmishData.data.length > 0) {
          const modesJoues = [...new Set(skirmishData.data.map(m => m.metadata?.mode))];
          console.log(`🕵️ Noms internes des modes récents de ${player.name} :`, modesJoues);
      }

      const cleanSkirmishMatches = (skirmishData.data || [])
        .filter(m => m.metadata && m.metadata.mode && m.metadata.mode === 'Custom Game') 
        .map(m => {
          const playerStats = m.players?.all_players?.find(p => p.name.toLowerCase() === player.name.toLowerCase() && p.tag.toLowerCase() === player.tag.toLowerCase());
          if (!playerStats) return null;
          const b = m.teams?.blue?.rounds_won || 0; const r = m.teams?.red?.rounds_won || 0;
          const isWin = playerStats.team === 'Blue' ? (b > r) : (r > b);
          let matchScore = '0 - 0';
          if (m.teams && playerStats.team) {
              const myT = playerStats.team.toLowerCase(); const oppT = myT === 'blue' ? 'red' : 'blue';
              matchScore = `${m.teams[myT]?.rounds_won || 0} - ${m.teams[oppT]?.rounds_won || 0}`;
          }
          return {
            id: m.metadata.matchid, type: 'skirmish', playerId: player.id, agent: playerStats.character, agentImg: playerStats.assets?.agent?.small || null,
            kills: playerStats.stats?.kills || 0, deaths: playerStats.stats?.deaths || 0, assists: playerStats.stats?.assists || 0, score: playerStats.stats?.score || 0,
            kd: (playerStats.stats?.deaths || 0) > 0 ? (playerStats.stats?.kills || 0) / playerStats.stats?.deaths : playerStats.stats?.kills || 0,
            adr: Math.round((playerStats.damage_made || 0) / (m.metadata?.rounds_played || 1)), acs: Math.round((playerStats.stats?.score || 0) / (m.metadata?.rounds_played || 1)),
            rounds: m.metadata?.rounds_played || 1, roundsPlayed: m.metadata?.rounds_played || 1, result: isWin ? 'WIN' : 'LOSS', scoreTeam: matchScore,
            map: m.metadata.map, date: m.metadata.game_start_patched, timestamp: m.metadata.game_start, allPlayers: m.players.all_players, myTeam: playerStats.team
          };
      }).filter(Boolean);
      newMatches = [...newMatches, ...cleanSkirmishMatches];
    } catch (e) {
      console.error(`❌ Erreur Fetch Skirmish pour ${player.name}:`, e.message);
    }

    await delay(500);

    // RANKED
    try {
      const url = `${API_BASE}/v3/matches/${player.region}/${encodedName}/${encodedTag}?filter=competitive${commonParams}${cacheBuster}`;
      const compResponse = await fetchWithRetry(url, apiKeys, { headers });
      const compData = compResponse.ok ? await compResponse.json().catch(() => ({ data: [] })) : { data: [] };
      
      await delay(500);
      
      const mmrUrl = `${API_BASE}/v1/mmr-history/${player.region}/${encodedName}/${encodedTag}?size=${FETCH_SIZE}`;
      const mmrResponse = await fetchWithRetry(mmrUrl, apiKeys, { headers });
      const mmrData = mmrResponse.ok ? await mmrResponse.json().catch(() => ({ data: [] })) : { data: [] };
      
      const cleanRankedMatches = (compData.data || []).filter(m => (m.metadata?.mode ? m.metadata.mode.toLowerCase() : '') === 'competitive').map(m => {
        const playerStats = m.players?.all_players?.find(p => p.name.toLowerCase() === player.name.toLowerCase() && p.tag.toLowerCase() === player.tag.toLowerCase());
        if (!playerStats) return null;

        const relatedMmr = (mmrData.data || []).find(mmr => mmr.match_id === m.metadata.matchid) || {};
        
        const b = m.teams?.blue?.rounds_won || 0;
        const r = m.teams?.red?.rounds_won || 0;
        const isWin = playerStats.team === 'Blue' ? (b > r) : (r > b);

        let matchScore = '0 - 0';
        if (m.teams && playerStats.team) {
            const myT = playerStats.team.toLowerCase();
            const oppT = myT === 'blue' ? 'red' : 'blue';
            matchScore = `${m.teams[myT]?.rounds_won || 0} - ${m.teams[oppT]?.rounds_won || 0}`;
        }

        const rankValue = (relatedMmr.currenttier || 0) * 100 + (relatedMmr.ranking_in_tier || 0);

        const kills = playerStats.stats?.kills || 0;
        const deaths = playerStats.stats?.deaths || 0;
        const assists = playerStats.stats?.assists || 0;
        const score = playerStats.stats?.score || 0;
        const kd = deaths > 0 ? (kills / deaths) : kills;

        const allScores = (m.players?.all_players || []).map(p => p.stats?.score || 0);
        const teamScores = (m.players?.all_players || []).filter(p => p.team === playerStats.team).map(p => p.stats?.score || 0);
        const maxScoreGame = allScores.length > 0 ? Math.max(...allScores) : 0;
        const maxScoreTeam = teamScores.length > 0 ? Math.max(...teamScores) : 0;
        const isMatchMVP = score >= maxScoreGame && score > 0;
        const isTeamMVP = !isMatchMVP && score >= maxScoreTeam && score > 0;

        let roundKills = {};
        const firstBloodsMap = {};
        const allKills = m.kills || m.kill_events || [];

        allKills.forEach(k => {
          const r = k.round || 0;
          const time = k.kill_time_in_round || 999999;
          if (!firstBloodsMap[r] || time < (firstBloodsMap[r].time || 999999)) {
              firstBloodsMap[r] = { killer: k.killer_puuid, victim: k.victim_puuid, time: time, weapon: k.damage_weapon_name };
          }
          if (k.killer_puuid === playerStats.puuid) roundKills[r] = (roundKills[r] || 0) + 1;
        });

        const matchFkFd = {};
        Object.values(firstBloodsMap).forEach(fb => {
            if (!matchFkFd[fb.killer]) matchFkFd[fb.killer] = { fk: 0, fd: 0 };
            if (!matchFkFd[fb.victim]) matchFkFd[fb.victim] = { fk: 0, fd: 0 };
            matchFkFd[fb.killer].fk++;
            matchFkFd[fb.victim].fd++;
        });

        const enrichedAllPlayers = (m.players?.all_players || []).map(p => ({
            ...p,
            stats: {
                ...p.stats,
                first_kills: matchFkFd[p.puuid]?.fk || p.stats?.first_kills || 0,
                first_deaths: matchFkFd[p.puuid]?.fd || p.stats?.first_deaths || 0
            }
        }));

        let mk3 = 0, mk4 = 0, mk5 = 0;
        Object.values(roundKills).forEach(count => {
            if (count === 3) mk3++;
            if (count === 4) mk4++;
            if (count >= 5) mk5++;
        });

        const clutches = (playerStats.stats?.clutches_1v1 || 0) + (playerStats.stats?.clutches_1v2 || 0) + (playerStats.stats?.clutches_1v3 || 0) + (playerStats.stats?.clutches_1v4 || 0) + (playerStats.stats?.clutches_1v5 || 0);

        let atkRounds = 0, atkWins = 0, defRounds = 0, defWins = 0, plants = 0, defuses = 0;
        let startSide = null;
        const plantSites = { A: 0, B: 0, C: 0 };
        const roundDetails = [];
        const timeline = [];

        if (m.rounds && m.rounds.length > 0) {
          m.rounds.forEach((round, index) => {
            if (index < 12 && !startSide && round.plant_events && round.plant_events.plant_location) {
              startSide = (round.plant_events.planted_by?.team === playerStats.team) ? 'Attack' : 'Defend';
            }
          });
          if (!startSide) startSide = 'Unknown';

          m.rounds.forEach((round, index) => {
            if (round.plant_events?.planted_by?.puuid === playerStats.puuid) plants++;
            if (round.defuse_events?.defused_by?.puuid === playerStats.puuid) defuses++;
            if (round.plant_events?.plant_site) plantSites[round.plant_events.plant_site] = (plantSites[round.plant_events.plant_site] || 0) + 1;

            if (startSide !== 'Unknown' && index < 24) {
              const currentSide = index < 12 ? startSide : (startSide === 'Attack' ? 'Defend' : 'Attack');
              const roundWon = round.winning_team === playerStats.team;
              if (currentSide === 'Attack') { atkRounds++; if (roundWon) atkWins++; }
              else { defRounds++; if (roundWon) defWins++; }
              roundDetails.push({ roundNum: index + 1, side: currentSide, isGunRound: (index >= 2 && index <= 11) || (index >= 14 && index <= 23), plantSite: round.plant_events?.plant_site || null, won: roundWon });
            }

            let maxTime = 0;
            const currentRoundKills = allKills.filter(k => k.round === index);
            currentRoundKills.forEach(k => {
                if (k.kill_time_in_round > maxTime) maxTime = k.kill_time_in_round;
            });
            if (round.plant_events?.plant_time_in_round > maxTime) maxTime = round.plant_events.plant_time_in_round;
            if (round.defuse_events?.defuse_time_in_round > maxTime) maxTime = round.defuse_events.defuse_time_in_round;
            
            const durationSecs = Math.round(maxTime / 1000);

            const fbEvent = firstBloodsMap[index];
            let fbDetails = null;
            if (fbEvent) {
                const kInfo = m.players?.all_players?.find(ap => ap.puuid === fbEvent.killer);
                const vInfo = m.players?.all_players?.find(ap => ap.puuid === fbEvent.victim);
                fbDetails = {
                    killerName: kInfo ? kInfo.name : 'Inconnu',
                    killerAgent: kInfo?.assets?.agent?.small || null,
                    victimName: vInfo ? vInfo.name : 'Inconnu',
                    victimAgent: vInfo?.assets?.agent?.small || null,
                    weapon: fbEvent.weapon || 'Arme inconnue'
                };
            }

            let planterName = null; let defuserName = null;
            if (round.plant_events?.planted_by?.puuid) {
                const pInfo = m.players?.all_players?.find(ap => ap.puuid === round.plant_events.planted_by.puuid);
                planterName = pInfo ? pInfo.name : null;
            }
            if (round.defuse_events?.defused_by?.puuid) {
                const dInfo = m.players?.all_players?.find(ap => ap.puuid === round.defuse_events.defused_by.puuid);
                defuserName = dInfo ? dInfo.name : null;
            }

            let myTeamEco = 0; let enemyTeamEco = 0;
            if (round.player_stats) {
                round.player_stats.forEach(ps => {
                    if (ps.player_team === playerStats.team) {
                        myTeamEco += (ps.economy?.loadout_value || 0);
                    } else {
                        enemyTeamEco += (ps.economy?.loadout_value || 0);
                    }
                });
            }

            timeline.push({
                roundNum: index + 1,
                won: round.winning_team === playerStats.team,
                endType: round.end_type || 'Inconnu',
                planter: planterName,
                defuser: defuserName,
                plantSite: round.plant_events?.plant_site || null,
                firstBlood: fbDetails,
                myTeamEco,
                enemyTeamEco,
                duration: durationSecs
            });
          });
        }

        const weaponStats = {};
        const deathCoordinates = [];

        if (Array.isArray(allKills)) {
          allKills.forEach((k) => {
            if (k.killer_puuid === playerStats.puuid && k.damage_weapon_name) {
              if (!weaponStats[k.damage_weapon_name]) weaponStats[k.damage_weapon_name] = { kills: 0 };
              weaponStats[k.damage_weapon_name].kills++;
            }
            const victimInGroup = allConfigPlayers.find(p => p.id === k.victim_puuid || p.name.toLowerCase() === (k.victim_display_name || '').toLowerCase().split('#')[0]);
            if (victimInGroup) {
              let victimAgentImg = null;
              const vInfo = (m.players?.all_players || []).find(vp => vp.puuid === k.victim_puuid);
              victimAgentImg = vInfo?.assets?.agent?.small || null;
              
              let deathSide = 'Unknown';
              if (startSide !== 'Unknown') {
                  const roundNum = k.round || 0;
                  const isFirstHalf = roundNum < 12;
                  deathSide = isFirstHalf ? startSide : (startSide === 'Attack' ? 'Defend' : 'Attack');
              }

              deathCoordinates.push({
                x: k.victim_death_location?.x || 0,
                y: k.victim_death_location?.y || 0,
                puuid: victimInGroup.id,
                side: deathSide, 
                round: (k.round || 0) + 1, 
                agentImg: victimAgentImg 
              });
            }
          });
        }

        const rp = m.metadata?.rounds_played || 1;
        const abilities = playerStats.ability_casts || { c_cast: 0, q_cast: 0, e_cast: 0, x_cast: 0 };

        return {
          id: m.metadata.matchid, type: 'ranked', playerId: player.id, agent: playerStats.character, agentImg: playerStats.assets?.agent?.small || null,
          matchScore: matchScore,
          rrChange: relatedMmr.mmr_change_to_last_game || 0, currentRank: relatedMmr.currenttierpatched || 'Unknown', currentRR: relatedMmr.ranking_in_tier || 0, rankValue: rankValue > 0 ? rankValue : null,
          kills, deaths, assists, score, kd: Number((deaths > 0 ? kills / deaths : kills).toFixed(2)),
          isMatchMVP, isTeamMVP, mk3, mk4, mk5, 
          headshots: playerStats.stats?.headshots || 0, bodyshots: playerStats.stats?.bodyshots || 0, legshots: playerStats.stats?.legshots || 0,
          totalShots: (playerStats.stats?.bodyshots || 0) + (playerStats.stats?.legshots || 0) + (playerStats.stats?.headshots || 0),
          firstKills: matchFkFd[playerStats.puuid]?.fk || 0, 
          firstDeaths: matchFkFd[playerStats.puuid]?.fd || 0, 
          clutches,
          sides: { atkWins, atkRounds, defWins, defRounds }, plants, defuses, plantSites, weaponStats, deathCoordinates, roundDetails,
          timeline: timeline, 
          adr: Math.round((playerStats.damage_made || 0) / rp), acs: Math.round(score / rp), roundsPlayed: rp, 
          economy: { avgSpent: Math.round((playerStats.economy?.spent?.overall || 0) / rp), avgLoadoutValue: Math.round((playerStats.economy?.loadout_value?.overall || 0) / rp) },
          abilities: { ...abilities, total: (abilities.c_cast || 0) + (abilities.q_cast || 0) + (abilities.e_cast || 0) + (abilities.x_cast || 0) },
          partyId: playerStats.party_id, allPlayers: enrichedAllPlayers, teamInfo: m.teams, myTeam: playerStats.team,
          result: isWin ? 'WIN' : 'LOSS', date: m.metadata.game_start_patched, timestamp: m.metadata.game_start, map: m.metadata.map
        };
      }).filter(Boolean);
      newMatches = [...newMatches, ...cleanRankedMatches];
    } catch (e) {
        console.error(`❌ Erreur Fetch Ranked pour ${player.name}:`, e.message);
    }

    return newMatches;
};

// --- ALERTE FIN DE MATCH IMMÉDIATE (CORRECTION DISCORD & ANTI-SPAM 24H) ---
const announceNewMatches = async (newlyDiscoveredMatches, allConfigPlayers, appUrl, ignoreTimeLimit = false) => {
    if (newlyDiscoveredMatches.length === 0) return;

    const webhookUrl = await getConfig('webhook_url');
    if (!webhookUrl) {
        console.log("⚠️ [Discord] Webhook non configuré, impossible d'envoyer l'alerte.");
        return;
    }

    console.log(`🔔 [Discord] Analyse de ${newlyDiscoveredMatches.length} nouveau(x) match(s) pour envoi...`);

    const matchesById = {};
    newlyDiscoveredMatches.forEach(m => {
        if (m.type !== 'ranked') {
            console.log(`🚫 [Discord] Match ${m.id} ignoré car ce n'est pas une Ranked.`);
            return;
        }

        const matchTime = m.timestamp ? m.timestamp * 1000 : new Date(m.date).getTime();
        const hoursOld = (Date.now() - matchTime) / (1000 * 60 * 60);
        
        if (ignoreTimeLimit || hoursOld < 24) {
            if (!matchesById[m.id]) matchesById[m.id] = [];
            matchesById[m.id].push(m);
            console.log(`✅ [Discord] Match validé pour l'envoi (Vieux de ${hoursOld.toFixed(1)}h).`);
        } else {
            console.log(`🚫 [Anti-Spam] Match ignoré car il date de plus de ${hoursOld.toFixed(1)}h. Vérifiez l'heure de votre PC !`);
        }
    });

    for (const [matchId, playersInMatch] of Object.entries(matchesById)) {
        const baseMatch = playersInMatch[0]; 
        const isWin = baseMatch.result === 'WIN';
        const color = isWin ? 0x10b981 : (baseMatch.result === 'LOSS' ? 0xef4444 : 0x9ca3af);
        
        let desc = `**Score final :** ${baseMatch.matchScore} (${isWin ? 'Victoire' : 'Défaite'})\n\n`;

        const allPlayers = baseMatch.allPlayers || [];
        const globalSorted = [...allPlayers].sort((a, b) => (b.stats?.score || 0) - (a.stats?.score || 0));
        const matchMvpId = globalSorted.length > 0 ? globalSorted[0].puuid : null;

        const blueTeam = allPlayers.filter(p => p.team === 'Blue').sort((a, b) => (b.stats?.score || 0) - (a.stats?.score || 0));
        const redTeam = allPlayers.filter(p => p.team === 'Red').sort((a, b) => (b.stats?.score || 0) - (a.stats?.score || 0));

        const formatPlayerRow = (p) => {
            const isGroupMember = allConfigPlayers.find(c => c.id === p.puuid || (p.name && c.name.toLowerCase() === p.name.toLowerCase()));
            const isMvp = p.puuid === matchMvpId;
            const rounds = baseMatch.roundsPlayed || 1;
            const acs = Math.round((p.stats?.score || 0) / rounds);
            
            const agentName = (p.character || '?').substring(0, 9).padEnd(9);
            const kills = String(p.stats?.kills || 0).padStart(2, ' ');
            const deaths = String(p.stats?.deaths || 0).padStart(2, ' ');
            const assists = String(p.stats?.assists || 0).padStart(2, ' ');
            const acsStr = String(acs).padStart(3, ' ');

            let row = `\`${agentName} | ${kills}/${deaths}/${assists} | ACS: ${acsStr}\` `;

            if (isGroupMember) {
                const trackedData = playersInMatch.find(tm => tm.playerId === isGroupMember.id);
                let rrText = "";
                if (trackedData && trackedData.rrChange !== undefined && baseMatch.type === 'ranked') {
                    const rrSign = trackedData.rrChange > 0 ? '+' : '';
                    rrText = `[ ${rrSign}${trackedData.rrChange} RR ]`;
                }
                row += `**${isGroupMember.name}** **${rrText}**`;
            } else {
                row += `${p.name}`;
            }

            if (isMvp) row += ` 👑`;

            return row + `\n`;
        };

        if (blueTeam.length > 0) {
            desc += `🔵 **ÉQUIPE BLEUE**\n`;
            blueTeam.forEach(p => desc += formatPlayerRow(p));
            desc += `\n`;
        }

        if (redTeam.length > 0) {
            desc += `🔴 **ÉQUIPE ROUGE**\n`;
            redTeam.forEach(p => desc += formatPlayerRow(p));
        }

        const embed = {
            title: `🚨 FIN DE MATCH (RANKED) : ${baseMatch.map.toUpperCase()}`,
            color: color,
            description: desc,
            url: appUrl,
            footer: { text: "Tracker Custom • Alerte Rapide" }
        };

        console.log(`📤 [Discord] Envoi de l'alerte pour la map ${baseMatch.map}...`);
        await sendDiscordWebhook(webhookUrl, { embeds: [embed] });
        await delay(1500); 
    }
};

let isSyncing = false;

const syncAllPlayers = async (requestedPlayerId = 'all') => {
    if (isSyncing) return;
    isSyncing = true;
    
    try {
        const allConfigPlayers = await getPlayers();
        const apiKeys = await getApiKeys();
        const appUrl = await getConfig('app_url', 'http://localhost:5173');

        if (allConfigPlayers.length === 0) {
            console.log("⚠️ Aucun joueur configuré. Fin du scan.");
            isSyncing = false;
            return;
        }

        if (apiKeys.length === 0) {
            console.log("⚠️ Aucune clé API configurée. Fin du scan.");
            isSyncing = false;
            return;
        }

        console.log(`🔄 Démarrage du scan Riot API...`);
        const playersToFetch = requestedPlayerId === 'all' ? allConfigPlayers : allConfigPlayers.filter(p => p.id === requestedPlayerId);
        
        let allNewMatches = [];

        for (const player of playersToFetch) {
            const matches = await fetchPlayerData(player, apiKeys, allConfigPlayers);
            allNewMatches.push(...matches);
            await delay(1000); 
        }

        let totalAdded = 0;
        let newlyAddedRankedMatches = []; 

        if (allNewMatches.length > 0) {
            await db.exec('BEGIN TRANSACTION');
            for (const match of allNewMatches) {
                const uniqueId = `${match.id}_${match.playerId}`;
                const timestamp = match.timestamp ? match.timestamp * 1000 : new Date(match.date).getTime();

                const existing = await db.get(`SELECT id FROM matches WHERE id = ?`, [uniqueId]);
                const isNew = !existing;

                const result = await db.run(
                    `INSERT OR REPLACE INTO matches (id, player_id, date, data) VALUES (?, ?, ?, ?)`,
                    [uniqueId, match.playerId, timestamp, JSON.stringify(match)]
                );
                
                if (result.changes > 0) {
                    totalAdded++;
                    if (isNew && match.type === 'ranked') {
                        newlyAddedRankedMatches.push(match);
                    }
                }
            }
            await db.exec('COMMIT');
        }
        
        console.log(`✅ Fin du scan. ${totalAdded} matchs traités/sauvegardés.`);

        if (newlyAddedRankedMatches.length > 0) {
            console.log(`📢 ${newlyAddedRankedMatches.length} nouveau(x) match(s) classé(s) détecté(s).`);
            await announceNewMatches(newlyAddedRankedMatches, allConfigPlayers, appUrl);
        }

    } catch (e) {
        if (e.message && e.message.includes('SQLITE')) {
            try { await db.exec('ROLLBACK'); } catch(err) {}
        }
        console.error("❌ Erreur pendant le scan:", e);
    } finally {
        isSyncing = false;
    }
};

const sendDiscordWebhook = async (webhookUrl, payload) => {
    try {
        const res = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!res.ok) console.error("Erreur Webhook Discord:", await res.text());
    } catch (e) {
        console.error("Erreur requête Webhook:", e.message);
    }
};

const getParisDateString = (dateObj) => {
    return new Intl.DateTimeFormat('fr-FR', {
        timeZone: 'Europe/Paris',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(dateObj); 
};

// --- RAPPORT QUOTIDIEN ---
const generateDailyReport = async (isManual = false, forceDate = null) => {
    console.log(`📊 [RAPPORT] Génération (Manuel: ${isManual})...`);
    
    const webhookUrl = await getConfig('webhook_url');
    if (!webhookUrl) {
        console.log("⚠️ [RAPPORT] Aucun webhook configuré, annulation.");
        return;
    }

    const appUrl = await getConfig('app_url', 'http://localhost:5173');
    const allConfigPlayers = await getPlayers();

    const rows = await db.all('SELECT date, data FROM matches ORDER BY date DESC');
    const matches = rows.map(row => {
        const parsedData = JSON.parse(row.data);
        parsedData.dbDate = row.date; 
        return parsedData;
    });

    const targetDate = forceDate ? new Date(forceDate) : new Date();
    if (!isManual && !forceDate) {
        targetDate.setHours(targetDate.getHours() - 12); 
    }

    const dateStr = getParisDateString(targetDate);
    const dateTitle = targetDate.toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Europe/Paris' });

    const dailyRawMatches = matches.filter(m => {
        if (m.type !== 'ranked') return false;
        return getParisDateString(new Date(m.dbDate)) === dateStr;
    });

    if (dailyRawMatches.length === 0) {
        console.log("⚠️ [RAPPORT] Vide.");
        if (isManual) await sendDiscordWebhook(webhookUrl, { content: `🚫 **Rapport du ${dateStr}** : Le calme plat. Aucune game classée enregistrée.` });
        return;
    }

    const uniqueGames = {};
    const playerStats = {};

    allConfigPlayers.forEach(p => {
        playerStats[p.id] = {
            name: p.name, wins: 0, losses: 0,
            rrChange: 0, kills: 0, deaths: 0, headshots: 0, shots: 0,
            games: 0
        };
    });

    dailyRawMatches.forEach(m => {
        if (!uniqueGames[m.id]) {
            uniqueGames[m.id] = {
                id: m.id, map: m.map, result: m.result, score: m.matchScore, time: m.date, players: []
            };
        }

        const pConfig = allConfigPlayers.find(p => p.id === m.playerId);
        const playerName = pConfig ? pConfig.name : "Inconnu";
        const kd = m.deaths > 0 ? (m.kills / m.deaths).toFixed(2) : m.kills;
        const rrSign = m.rrChange > 0 ? '+' : '';
        const acs = m.acs || Math.round((m.score || 0) / (m.roundsPlayed || 1));
        const hsPct = m.totalShots > 0 ? Math.round((m.headshots / m.totalShots) * 100) : 0;

        uniqueGames[m.id].players.push({
            name: playerName, agent: m.agent || "?", rr: `${rrSign}${m.rrChange}`, kd: kd, result: m.result, acs: acs, hs: hsPct
        });

        if (playerStats[m.playerId]) {
            const p = playerStats[m.playerId];
            p.games++;
            if (m.result === 'WIN') p.wins++; else p.losses++;
            p.rrChange += m.rrChange;
            p.kills += m.kills;
            p.deaths += m.deaths;
            p.headshots += (m.headshots || 0);
            p.shots += (m.totalShots || 0);
        }
    });

    const uniqueGamesList = Object.values(uniqueGames).sort((a, b) => new Date(a.time) - new Date(b.time));
    const totalUniqueGames = uniqueGamesList.length;
    const totalWins = uniqueGamesList.filter(g => g.result === 'WIN').length;
    const globalWinrate = Math.round((totalWins / totalUniqueGames) * 100);

    let weatherEmoji = "☁️"; let weatherTitle = "Mitigé"; let color = 0x9ca3af;
    if (globalWinrate >= 60) { weatherEmoji = "☀️"; weatherTitle = "Grand Soleil"; color = 0x10b981; }
    else if (globalWinrate >= 45) { weatherEmoji = "🌤️"; weatherTitle = "Éclaircies"; color = 0xfacc15; }
    else if (globalWinrate >= 25) { weatherEmoji = "🌧️"; weatherTitle = "Averses"; color = 0x3b82f6; }
    else { weatherEmoji = "⛈️"; weatherTitle = "Tempête"; color = 0xef4444; }

    const activePlayers = Object.values(playerStats).filter(p => p.games > 0);

    const mvp = [...activePlayers].sort((a, b) => b.rrChange - a.rrChange)[0];
    const butcher = [...activePlayers].sort((a, b) => {
        const kdA = a.deaths > 0 ? a.kills/a.deaths : a.kills;
        const kdB = b.deaths > 0 ? b.kills/b.deaths : b.kills;
        return kdB - kdA;
    })[0];
    const loser = [...activePlayers].sort((a, b) => a.rrChange - b.rrChange)[0];
    const sniper = [...activePlayers].sort((a, b) => {
        const hsA = a.shots > 0 ? a.headshots/a.shots : 0;
        const hsB = b.shots > 0 ? b.headshots/b.shots : 0;
        return hsB - hsA;
    })[0];

    const fields = [];
    const totalRRDay = activePlayers.reduce((acc, p) => acc + p.rrChange, 0);

    fields.push({
        name: `${weatherEmoji} Bilan de l'Escouade`,
        value: `**Météo :** ${weatherTitle}\n**Winrate :** ${globalWinrate}% (${totalWins}W - ${totalUniqueGames - totalWins}L)\n**Rentabilité :** ${totalRRDay > 0 ? '+' : ''}${totalRRDay} RR globaux`,
        inline: false
    });

    let fameText = "";
    if (mvp && mvp.rrChange > 0) fameText += `👑 **MVP :** ${mvp.name} (*+${mvp.rrChange} RR*)\n`;
    if (butcher && butcher.name !== mvp?.name) fameText += `🔪 **Boucher :** ${butcher.name} (*${(butcher.deaths > 0 ? butcher.kills/butcher.deaths : butcher.kills).toFixed(2)} K/D*)\n`;
    if (sniper && sniper.shots > 0) fameText += `🎯 **Sniper :** ${sniper.name} (*${Math.round((sniper.headshots/sniper.shots)*100)}% HS*)\n`;
    if (loser && loser.rrChange < 0) fameText += `🤡 **Poids Mort :** ${loser.name} (*${loser.rrChange} RR*)\n`;

    fields.push({
        name: "🏆 Tableau d'Honneur",
        value: fameText || "Pas de trophées marquants aujourd'hui.",
        inline: false
    });

    let gamesLog = "";
    uniqueGamesList.forEach(g => {
        const icon = g.result === 'WIN' ? "🟢" : (g.result === 'DRAW' ? "⚪" : "🔴");
        const scoreText = g.score ? `**${g.score}**` : "";
        gamesLog += `${icon} **${g.map.toUpperCase()}** - ${scoreText}\n`;
        
        g.players.sort((a, b) => parseInt(b.rr) - parseInt(a.rr));
        
        g.players.forEach(p => {
            gamesLog += `> \`${p.agent.padEnd(9)}\` **${p.name}** : **${p.rr} RR** | ${p.kd} K/D | ${p.acs} ACS | ${p.hs}% HS\n`;
        });
        gamesLog += "\n";
    });

    if (gamesLog.length > 3900) {
        gamesLog = gamesLog.substring(0, 3900) + "\n... *[Journal tronqué par limite Discord]*";
    }

    const embed = {
        title: `📊 RAPPORT QUOTIDIEN • ${dateTitle.toUpperCase()}`,
        url: appUrl,
        color: color,
        description: `**📝 Journal des Matchs**\n\n${gamesLog || "Aucun détail de match."}`,
        fields: fields,
        thumbnail: { url: "https://media.discordapp.net/attachments/1070058980836540467/1164570087799562300/valorant-logo.png" },
        footer: { text: "Tracker Custom • Auto-généré" },
        timestamp: new Date().toISOString()
    };

    await sendDiscordWebhook(webhookUrl, { embeds: [embed] });
};

// ==========================================
// ROUTES PUBLIQUES (FRONTEND CLASSIQUE)
// ==========================================

app.get('/history', async (req, res) => {
    try {
        // On récupère les filtres temporels demandés par le site
        const { start, end } = req.query;
        let query = 'SELECT data FROM matches';
        let params = [];
        let conditions = [];

        // Si le site demande une date de début
        if (start && start !== 'null') {
            conditions.push('date >= ?');
            params.push(parseInt(start));
        }
        // Si le site demande une date de fin (pour les saisons)
        if (end && end !== 'null') {
            conditions.push('date <= ?');
            params.push(parseInt(end));
        }

        // On assemble la requête SQL
        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }
        
        query += ' ORDER BY date DESC';

        // SÉCURITÉ VITALE : Si le mode "Global" est sélectionné (sans dates), 
        // on bloque à 500 matchs max pour ne pas faire exploser les navigateurs mobiles.
        if (!start && !end) {
            query += ' LIMIT 500'; 
        }

        const rows = await db.all(query, params);
        const matches = rows.map(row => JSON.parse(row.data));
        res.json({ matches });
    } catch (e) {
        res.status(500).json({ matches: [] });
    }
});

app.post('/sync', async (req, res) => {
    const { playerId } = req.body;
    if (isSyncing) return res.status(429).send("Une synchro est déjà en cours");
    await syncAllPlayers(playerId || 'all');
    res.status(200).send("Synchronisation terminée");
});

app.get('/test-send', async (req, res) => {
    try {
        const webhookUrl = await getConfig('webhook_url');
        if (!webhookUrl) return res.status(400).send("Aucun Webhook Discord configuré dans le panel d'administration.");

        const embed = {
            title: "🔌 TEST DE CONNEXION TRACKER",
            color: 0x10b981,
            description: "La liaison entre le serveur et Discord fonctionne parfaitement ! ✅",
            footer: { text: "Test manuel via /test-send" },
            timestamp: new Date().toISOString()
        };
        await sendDiscordWebhook(webhookUrl, { embeds: [embed] });
        res.status(200).send("Message de test envoyé !");
    } catch (e) {
        res.status(500).send(e.message);
    }
});

app.get('/test-match', async (req, res) => {
    try {
        const allConfigPlayers = await getPlayers();
        const appUrl = await getConfig('app_url', 'http://localhost:5173');
        const webhookUrl = await getConfig('webhook_url');
        if (!webhookUrl) return res.status(400).send("Aucun Webhook Discord configuré.");

        const row = await db.get("SELECT data FROM matches WHERE data LIKE '%\"type\":\"ranked\"%' ORDER BY date DESC LIMIT 1");
        if (!row) return res.status(404).send("Aucun match classé en base de données pour simuler l'envoi.");
        
        const sampleMatch = JSON.parse(row.data);
        const latestMatchId = sampleMatch.id;

        const rows = await db.all("SELECT data FROM matches WHERE id LIKE ?", [`${latestMatchId}_%`]);
        const playersInLastMatch = rows.map(r => JSON.parse(r.data));

        // Le "true" permet de forcer le test en ignorant la limite d'âge de la game
        await announceNewMatches(playersInLastMatch, allConfigPlayers, appUrl, true);
        
        res.status(200).send("Faux match envoyé sur Discord avec succès ! Va vérifier ton channel !");
    } catch (e) {
        res.status(500).send(e.message);
    }
});

app.get('/test-report', async (req, res) => {
    try {
        const row = await db.get("SELECT date FROM matches WHERE data LIKE '%\"type\":\"ranked\"%' ORDER BY date DESC LIMIT 1");
        if (!row) return res.status(404).send("Aucun match classé en base de données pour faire le rapport.");
        
        await generateDailyReport(true, row.date);
        
        res.status(200).send("Faux rapport journalier envoyé sur Discord avec succès !");
    } catch (e) {
        res.status(500).send(e.message);
    }
});

app.get('/trigger-report', async (req, res) => {
    try {
        await generateDailyReport(true);
        res.sendStatus(200);
    } catch (e) {
        res.status(500).send(e.message);
    }
});

// Tâches CRON (Toutes les 5 minutes pour être plus rapide, et tous les jours à 01h00 Paris)
cron.schedule('*/5 * * * *', () => { syncAllPlayers('all'); });
cron.schedule('0 1 * * *', () => { generateDailyReport(false); }, { timezone: "Europe/Paris" });

app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Serveur Backend lancé sur le port ${PORT}`);
});