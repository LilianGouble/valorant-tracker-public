import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import compression from 'compression';
import path from 'path';
import { fileURLToPath } from 'url';
import cron from 'node-cron';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

// --- IMPORT DU BOT DISCORD ---
import { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, REST, Routes, AttachmentBuilder } from 'discord.js';
import { buildSessionCard, buildPlayerCard, toDataUri } from './recap-generator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3001;
const DB_FILE = path.join(__dirname, 'database.sqlite');
const API_BASE = "https://api.henrikdev.xyz/valorant";

// Derrière Nginx/proxy : fait confiance au 1er proxy pour lire la vraie IP client
// (X-Forwarded-For). Indispensable pour que le rate-limiting soit par-client et
// non par-proxy (sinon tout le trafic partage une seule IP).
app.set('trust proxy', 1);

// CORS : liste blanche dynamique (localhost dev + app_url configuré).
// Rechargée au démarrage et après chaque édition admin (refreshAllowedOrigins).
let allowedOrigins = [];
const LOCALHOST_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
app.use(cors({
    origin: (origin, callback) => {
        // Pas d'origin (same-origin, curl, server-to-server) → autorisé
        if (!origin) return callback(null, true);
        if (LOCALHOST_RE.test(origin)) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        callback(new Error('CORS: origin non autorisée'));
    }
}));
// gzip pour toutes les réponses > 1KB ; gain énorme sur /history (JSON volumineux)
// SSE exclu : sinon la compression buffer les events et casse le push temps réel.
app.use(compression({
    level: 6,
    threshold: 1024,
    filter: (req, res) => {
        if (req.path === '/api/events') return false;
        return compression.filter(req, res);
    }
}));
// En-têtes de sécurité de base (équivalent minimal de Helmet, sans dépendance).
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');       // pas de MIME sniffing
    res.setHeader('X-Frame-Options', 'DENY');                 // anti-clickjacking
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-XSS-Protection', '0');                   // désactive le filtre XSS legacy (déprécié)
    res.removeHeader('X-Powered-By');                         // masque "Express"
    next();
});

// 2mb suffit largement (payload Riot ~50KB, ajouts admin ~quelques KB).
app.use(bodyParser.json({ limit: '2mb' }));

let db;

const refreshAllowedOrigins = async () => {
    try {
        const appUrl = await getConfig('app_url', '');
        if (appUrl) {
            const clean = appUrl.replace(/\/$/, '');
            allowedOrigins = [clean];
        } else {
            allowedOrigins = [];
        }
    } catch (e) { void e; allowedOrigins = []; }
};

// --- INITIALISATION DU CLIENT DISCORD ---
// Seul l'intent Guilds est nécessaire pour les slash commands + interactions.
// MessageContent retiré (commandes préfixées !stats/!ping supprimées).
const discordClient = new Client({
    intents: [GatewayIntentBits.Guilds]
});

// --- INITIALISATION DE LA BASE DE DONNÉES ---
(async () => {
    db = await open({ filename: DB_FILE, driver: sqlite3.Database });

    // Tuning SQLite pour serveur à faible RAM (447 MB).
    // - WAL : lectures concurrentes pendant les écritures
    // - synchronous=NORMAL : safe avec WAL, plus rapide que FULL
    // - cache_size négatif = KB (4 MB)
    // - mmap_size 64 MB : couvre la DB (~47 MB), réduit drastiquement les I/O disque
    // - temp_store=MEMORY : tables temporaires en RAM (très petites)
    await db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA cache_size = -4000;
        PRAGMA mmap_size = 67108864;
        PRAGMA temp_store = MEMORY;
    `);
    
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
            color TEXT,
            puuid TEXT
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

    // Migration : ajoute la colonne puuid si la table existait déjà sans (idempotent)
    try {
        const cols = await db.all("PRAGMA table_info(players)");
        if (!cols.some(c => c.name === 'puuid')) {
            await db.exec("ALTER TABLE players ADD COLUMN puuid TEXT");
            console.log("🛠️  Colonne 'puuid' ajoutée à la table players.");
        }
    } catch (e) {
        console.warn("⚠️  Migration puuid:", e.message);
    }

    // Migration : ajoute la colonne discord_id si elle n'existe pas
    try {
        const cols = await db.all("PRAGMA table_info(players)");
        if (!cols.some(c => c.name === 'discord_id')) {
            await db.exec("ALTER TABLE players ADD COLUMN discord_id TEXT");
            console.log("🛠️  Colonne 'discord_id' ajoutée à la table players.");
        }
    } catch (e) {
        console.warn("⚠️  Migration discord_id:", e.message);
    }

    // Migration : colonnes MMR temps réel (v3/mmr) — rang courant fiable + peak + crosshair
    try {
        const cols = await db.all("PRAGMA table_info(players)");
        const add = async (name, type) => {
            if (!cols.some(c => c.name === name)) {
                await db.exec(`ALTER TABLE players ADD COLUMN ${name} ${type}`);
                console.log(`🛠️  Colonne '${name}' ajoutée à la table players.`);
            }
        };
        await add('live_mmr', 'TEXT');       // snapshot JSON du v3/mmr (current, peak, seasonal)
        await add('mmr_updated_at', 'INTEGER');
        await add('crosshair_code', 'TEXT'); // code de viseur Valorant du joueur
        await add('account_card', 'TEXT');   // id de la bannière Valorant (v2/account)
        await add('account_level', 'INTEGER');
    } catch (e) {
        console.warn("⚠️  Migration MMR:", e.message);
    }

    // Migration : Architecture Hybride SQL (Extraction des colonnes clés)
    try {
        const cols = await db.all("PRAGMA table_info(matches)");
        if (!cols.some(c => c.name === 'type')) {
            console.log("🛠️ Migration vers l'architecture hybride SQL en cours...");
            await db.exec(`
                ALTER TABLE matches ADD COLUMN type TEXT;
                ALTER TABLE matches ADD COLUMN result TEXT;
                ALTER TABLE matches ADD COLUMN map TEXT;
                ALTER TABLE matches ADD COLUMN agent TEXT;
                ALTER TABLE matches ADD COLUMN kills INTEGER;
                ALTER TABLE matches ADD COLUMN deaths INTEGER;
                ALTER TABLE matches ADD COLUMN assists INTEGER;
                ALTER TABLE matches ADD COLUMN rr_change INTEGER;
                ALTER TABLE matches ADD COLUMN acs INTEGER;
                CREATE INDEX IF NOT EXISTS idx_matches_type ON matches(type);
            `);
            
            const allMatches = await db.all("SELECT id, data FROM matches");
            await db.exec('BEGIN TRANSACTION');
            let migratedCount = 0;
            for (const m of allMatches) {
                try {
                    const d = JSON.parse(m.data);
                    await db.run(`UPDATE matches SET type=?, result=?, map=?, agent=?, kills=?, deaths=?, assists=?, rr_change=?, acs=? WHERE id=?`, [d.type, d.result, d.map, d.agent, d.kills, d.deaths, d.assists, d.rrChange, d.acs, m.id]);
                    migratedCount++;
                } catch(e) {}
            }
            await db.exec('COMMIT');
            console.log(`✅ Migration hybride terminée (${migratedCount} matchs convertis) ! Le serveur est maintenant ultra optimisé.`);
        }
    } catch (e) { console.warn("⚠️ Migration hybride:", e.message); try { await db.exec('ROLLBACK'); } catch(err) {} }

    let jwtSecretRow = await db.get("SELECT value FROM config WHERE key = 'jwt_secret'");
    if (!jwtSecretRow) {
        const secret = crypto.randomBytes(64).toString('hex');
        await db.run("INSERT INTO config (key, value) VALUES ('jwt_secret', ?)", [secret]);
    }

    const adminUser = await db.get("SELECT * FROM users WHERE username = 'admin'");
    if (!adminUser) {
        const hash = await bcrypt.hash('admin', 10);
        await db.run("INSERT INTO users (username, password_hash, needs_password_change) VALUES (?, ?, 1)", ['admin', hash]);
        console.log("🔒 Compte administrateur par défaut créé (admin / admin).");
    }

    await db.run("INSERT OR IGNORE INTO config (key, value) VALUES ('discord_bot_token', '')");
    await db.run("INSERT OR IGNORE INTO config (key, value) VALUES ('discord_channel_id', '')");
    await db.run("INSERT OR IGNORE INTO config (key, value) VALUES ('app_url', 'http://localhost:5173')");
    await db.run("INSERT OR IGNORE INTO config (key, value) VALUES ('challenge_start_date', '2024-01-01T00:00')");

    console.log("✅ Connecté à la base SQLite & Initialisation terminée.");

    await refreshAllowedOrigins();

    const botToken = await getConfig('discord_bot_token');
    if (botToken && botToken.trim() !== '') {
        discordClient.login(botToken).then(() => {
            console.log(`🤖 Bot Discord connecté avec succès en tant que ${discordClient.user.tag} !`);
        }).catch(err => {
            console.error(`❌ Erreur de connexion du Bot Discord: Vérifiez votre Token dans le panel Admin.`);
        });
    }

    setTimeout(() => {
        syncAllPlayers().catch(e => console.error("Erreur de synchro initiale:", e));
    }, 5000);
})();

const getConfig = async (key, defaultVal = '') => {
    const row = await db.get("SELECT value FROM config WHERE key = ?", [key]);
    return row ? row.value : defaultVal;
};
const getPlayers = async () => await db.all("SELECT id, name, tag, region, color, puuid, discord_id, live_mmr, mmr_updated_at, crosshair_code, account_card, account_level FROM players");
const getApiKeys = async () => (await db.all("SELECT key FROM api_keys")).map(r => r.key);

// Rate-limit en mémoire pour /api/auth/login : 5 tentatives par 15 min par IP.
const loginAttempts = new Map();
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const checkLoginRateLimit = (ip) => {
    const now = Date.now();
    const entry = loginAttempts.get(ip);
    if (!entry || now - entry.firstAttempt > LOGIN_WINDOW_MS) {
        loginAttempts.set(ip, { count: 1, firstAttempt: now });
        return { allowed: true };
    }
    entry.count++;
    if (entry.count > LOGIN_MAX_ATTEMPTS) {
        return { allowed: false, retryAfter: Math.ceil((LOGIN_WINDOW_MS - (now - entry.firstAttempt)) / 1000) };
    }
    return { allowed: true };
};
const resetLoginAttempts = (ip) => loginAttempts.delete(ip);

// Rate-limiter générique par IP (middleware). Protège les routes publiques
// coûteuses (sync, scout, génération d'images) contre l'abus / le flood.
const makeRateLimiter = ({ windowMs, max, name }) => {
    const hits = new Map();
    // Purge périodique pour éviter la fuite mémoire.
    setInterval(() => {
        const now = Date.now();
        for (const [ip, e] of hits) if (now - e.first > windowMs) hits.delete(ip);
    }, windowMs).unref?.();
    return (req, res, next) => {
        const ip = req.ip || req.connection?.remoteAddress || 'unknown';
        const now = Date.now();
        const e = hits.get(ip);
        if (!e || now - e.first > windowMs) {
            hits.set(ip, { count: 1, first: now });
            return next();
        }
        e.count++;
        if (e.count > max) {
            const retryAfter = Math.ceil((windowMs - (now - e.first)) / 1000);
            res.set('Retry-After', String(retryAfter));
            return res.status(429).json({ error: `Trop de requêtes (${name}). Réessaie dans ${retryAfter}s.` });
        }
        next();
    };
};

// Limiteurs dédiés : sync coûteux (quota API), scout (appels externes), images.
const syncLimiter = makeRateLimiter({ windowMs: 60 * 1000, max: 10, name: 'sync' });
const scoutLimiter = makeRateLimiter({ windowMs: 60 * 1000, max: 20, name: 'scout' });
const imageLimiter = makeRateLimiter({ windowMs: 60 * 1000, max: 30, name: 'image' });

// Validations communes
const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;
const REGION_VALUES = new Set(['eu', 'na', 'ap', 'kr', 'latam', 'br']);
const validatePlayerInput = ({ name, tag, region, color, discord_id }) => {
    if (typeof name !== 'string' || name.trim().length < 1 || name.length > 32) return "Pseudo invalide (1 à 32 caractères)";
    if (typeof tag !== 'string' || tag.trim().length < 1 || tag.length > 8) return "Tag invalide (1 à 8 caractères)";
    if (region !== undefined && region !== '' && !REGION_VALUES.has(String(region).toLowerCase())) return "Région invalide (eu/na/ap/kr/latam/br)";
    if (color !== undefined && color !== '' && !HEX_COLOR_RE.test(color)) return "Couleur invalide (format #RRGGBB)";
    if (discord_id !== undefined && discord_id !== '' && !/^\d{15,25}$/.test(String(discord_id))) return "Discord ID invalide (15-25 chiffres)";
    return null;
};

// Caches en mémoire (faible empreinte) pour éviter de retaper la DB
// sur chaque requête publique. Invalidés par les writes admin et par les syncs.
const PUBLIC_CONFIG_TTL_MS = 30 * 1000;
let publicConfigCache = { data: null, expiry: 0 };
let lastDataChange = Date.now();

const invalidatePublicConfigCache = () => { publicConfigCache.expiry = 0; };

// SSE — push temps réel vers les clients connectés
const sseClients = new Set();
const broadcastEvent = (type, data = {}) => {
    if (sseClients.size === 0) return;
    const msg = `data: ${JSON.stringify({ type, ...data, ts: Date.now() })}\n\n`;
    for (const client of sseClients) {
        try { client.write(msg); } catch { sseClients.delete(client); }
    }
};

const markDataChanged = () => {
    lastDataChange = Math.floor(Date.now() / 1000) * 1000;
    broadcastEvent('matches_updated');
};

// Cache des splash arts de maps (valorant-api.com), TTL 24h.
// Utilisé pour illustrer les embeds Discord de fin de match.
let mapSplashCache = { byName: {}, expiry: 0 };
const getMapSplash = async (mapName) => {
    if (!mapName) return null;
    const now = Date.now();
    if (now > mapSplashCache.expiry) {
        try {
            const res = await fetch('https://valorant-api.com/v1/maps');
            const json = await res.json();
            const byName = {};
            (json.data || []).forEach(m => {
                if (m.displayName && m.splash) byName[m.displayName.toLowerCase()] = m.splash;
            });
            if (Object.keys(byName).length > 0) {
                mapSplashCache = { byName, expiry: now + 24 * 60 * 60 * 1000 };
            }
        } catch (e) {
            console.warn("⚠️ Impossible de charger les splash de maps:", e.message);
            mapSplashCache.expiry = now + 10 * 60 * 1000; // réessaie dans 10 min
        }
    }
    return mapSplashCache.byName[mapName.toLowerCase()] || null;
};

// Cache du statut serveurs Riot (v1/status), TTL 5 min. Incidents/maintenances.
let riotStatusCache = { data: null, expiry: 0 };
const getRiotStatus = async (region, apiKeys) => {
    const now = Date.now();
    if (riotStatusCache.data && now < riotStatusCache.expiry) return riotStatusCache.data;
    try {
        const res = await fetchWithRetry(`${API_BASE}/v1/status/${(region || 'eu').toLowerCase()}`, apiKeys, {}, 2);
        if (!res.ok) { riotStatusCache.expiry = now + 60 * 1000; return riotStatusCache.data; }
        const j = await res.json();
        const extract = (arr) => (arr || []).map(x => {
            const t = (x.titles || []).find(t => t.locale === 'fr_FR') || (x.titles || [])[0];
            return { title: t?.content || 'Incident', severity: x.incident_severity || x.maintenance_status || 'info' };
        });
        const data = {
            incidents: extract(j.data?.incidents),
            maintenances: extract(j.data?.maintenances),
        };
        riotStatusCache = { data, expiry: now + 5 * 60 * 1000 };
        return data;
    } catch {
        riotStatusCache.expiry = now + 60 * 1000;
        return riotStatusCache.data;
    }
};

// Cache pour le bot Discord : joueurs + app_url lus à chaque interaction.
// TTL 60s — invalide aussi lors des changements admin.
const DISCORD_CACHE_TTL_MS = 60 * 1000;
let discordDataCache = { players: null, appUrl: null, expiry: 0 };
const invalidateDiscordCache = () => { discordDataCache.expiry = 0; };
const getDiscordCachedData = async () => {
    if (discordDataCache.expiry > Date.now()) return discordDataCache;
    const [players, appUrl] = await Promise.all([
        getPlayers(),
        getConfig('app_url', 'http://localhost:5173')
    ]);
    discordDataCache = { players, appUrl, expiry: Date.now() + DISCORD_CACHE_TTL_MS };
    return discordDataCache;
};

// Matchs classés détectés mais dont le RR n'est pas encore disponible côté Riot.
// Clé : matchId (sans le suffixe _playerId). Valeur : timestamp de première détection.
// Annonce retardée jusqu'au scan suivant où le RR sera disponible, ou après 20 min max.
const pendingMatchAnnouncements = new Map();

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

// Lookup unifié : retrouve la config d'un joueur tracké à partir d'un puuid Riot.
// Tolère les anciens enregistrements où id == puuid.
const findCfgByPuuid = (cfgs, puuid) => {
    if (!puuid || !cfgs) return null;
    return cfgs.find(c => (c.puuid && c.puuid === puuid) || c.id === puuid) || null;
};

// Résout puuid manquant pour chaque joueur tracké et le persiste en DB.
// Mutation in-place sur les objets cfg passés en argument.
const ensurePuuids = async (players, apiKeys) => {
    if (!apiKeys || apiKeys.length === 0) return;
    const headers = { 'Content-Type': 'application/json' };
    for (const p of players) {
        if (p.puuid && p.puuid.length > 10) continue;
        try {
            const url = `${API_BASE}/v1/account/${encodeURIComponent(p.name.trim())}/${encodeURIComponent(p.tag.trim())}`;
            const res = await fetchWithRetry(url, apiKeys, { headers });
            if (res?.ok) {
                const data = await res.json().catch(() => null);
                const puuid = data?.data?.puuid;
                if (puuid) {
                    p.puuid = puuid;
                    await db.run("UPDATE players SET puuid = ? WHERE id = ?", [puuid, p.id]);
                    console.log(`🆔 PUUID résolu et persisté pour ${p.name}#${p.tag}`);
                }
            }
        } catch (e) {
            console.warn(`⚠️  PUUID non résolu pour ${p.name}#${p.tag}: ${e.message}`);
        }
        await delay(250);
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

const MAP_SPLASHES = {
    ascent: "https://media.valorant-api.com/maps/7eaecc1b-4337-bbf6-6ab9-04b8f06b3319/splash.png",
    split: "https://media.valorant-api.com/maps/d960549e-485c-e861-8d71-aa9d1aed12a2/splash.png",
    fracture: "https://media.valorant-api.com/maps/bbee028c-4115-4ebb-4cb1-cebb65ec83f4/splash.png",
    bind: "https://media.valorant-api.com/maps/2c9d57ec-4431-9c5e-2939-8f9ef6dd5cba/splash.png",
    breeze: "https://media.valorant-api.com/maps/2c22ca7d-411a-a8cb-3ba2-66a8775f0a0d/splash.png",
    lotus: "https://media.valorant-api.com/maps/2fe4ed3a-450a-948b-6d6b-e89a78e680a9/splash.png",
    pearl: "https://media.valorant-api.com/maps/fd267378-4d1d-484f-ff52-77821ed10dc2/splash.png",
    icebox: "https://media.valorant-api.com/maps/e2ad5c54-4114-a870-9641-8ea21279598c/splash.png",
    haven: "https://media.valorant-api.com/maps/2bee0dc9-4ffe-519b-1cbd-7fbe763a6047/splash.png",
    sunset: "https://media.valorant-api.com/maps/2c09d728-42d5-30d8-43dc-96a05ce7ce8d/splash.png",
    abyss: "https://media.valorant-api.com/maps/224b0a95-48b9-f703-1e9d-1ca6761376f5/splash.png"
};

// Remplacez les valeurs ci-dessous par vos balises d'émojis Discord (format <:nom:ID> ou de simples émojis natifs)
// Émojis natifs "universels" par défaut (ne nécessitent aucun import côté serveur).
const RANK_EMOJIS = {
    'UNRATED': '❔',
    'IRON 1': '<:IR1:1501226611284906026>', 'IRON 2': 'I2', 'IRON 3': 'I3',
    'BRONZE 1': 'B1', 'BRONZE 2': 'B2', 'BRONZE 3': 'B3',
    'SILVER 1': 'S1', 'SILVER 2': 'S2', 'SILVER 3': 'S3',
    'GOLD 1': 'G1', 'GOLD 2': 'G2', 'GOLD 3': 'G3',
    'PLATINUM 1': '<:PL1:1501227322529808656>', 'PLATINUM 2': '<:PL2:1501227372152619160>', 'PLATINUM 3': '<:PL3:1501227471897366754>',
    'DIAMOND 1': '<:DI1:1501227521117782016>', 'DIAMOND 2': '<:DI2:1501227562360377465>', 'DIAMOND 3': '<:DI3:1501227605393801216>',
    'ASCENDANT 1': '<:AS1:1501227688738951328>', 'ASCENDANT 2': '<:AS2:1501227728555216957>', 'ASCENDANT 3': '<:AS3:1501227757525405807>',
    'IMMORTAL 1': '<:IM1:1501226021385666760>', 'IMMORTAL 2': '<:IM2:1501226084732108991>', 'IMMORTAL 3': '<:IM3:1501226484592021685>',
    'RADIANT': '<:RA:1501227811103572059>'
};

// ==========================================
// BOT DISCORD : CRÉATION DU MESSAGE MATCH
// ==========================================
const buildMatchMessage = async (matchId, view, allConfigPlayers, appUrl) => {
    const rows = await db.all("SELECT data FROM matches WHERE id LIKE ?", [`${matchId}_%`]);
    if (!rows || rows.length === 0) return null;

    const playersInMatch = rows.map(r => JSON.parse(r.data));
    const baseMatch = playersInMatch[0];
    const rounds = baseMatch.roundsPlayed || 1;
    const isWin = baseMatch.result === 'WIN';

    // Enrichir les noms (l'API Riot ne renvoie plus les noms dans les données de match)
    const allPlayers = (baseMatch.allPlayers || []).map(p => {
        const cfg = findCfgByPuuid(allConfigPlayers, p.puuid);
        if (cfg) return { ...p, name: cfg.name, tag: cfg.tag };
        return p;
    });

    const blueTeam = allPlayers.filter(p => p.team === 'Blue').sort((a, b) => (b.stats?.score || 0) - (a.stats?.score || 0));
    const redTeam  = allPlayers.filter(p => p.team === 'Red').sort((a, b)  => (b.stats?.score || 0) - (a.stats?.score || 0));
    const globalSorted = [...allPlayers].sort((a, b) => (b.stats?.score || 0) - (a.stats?.score || 0));
    const matchMvpId = globalSorted[0]?.puuid || null;

    const blueScore = baseMatch.teamInfo?.blue?.rounds_won ?? 0;
    const redScore  = baseMatch.teamInfo?.red?.rounds_won  ?? 0;

    // Calcul des "groupes trackés" : tout party_id qui contient au moins un joueur tracké.
    // Les coéquipiers non-trackés mais membres d'un de ces groupes sont marqués (▎).
    const trackedPartyIds = new Set();
    allPlayers.forEach(p => {
        if (p.party_id && findCfgByPuuid(allConfigPlayers, p.puuid)) {
            trackedPartyIds.add(p.party_id);
        }
    });

    const shortRank = (rankStr) => {
        if (!rankStr) return '';
        const r = rankStr.toUpperCase().trim();
        if (RANK_EMOJIS[r]) return RANK_EMOJIS[r];
        if (r.includes('IRON'))       return 'I'  + r.replace(/[^0-9]/g, '');
        if (r.includes('BRONZE'))     return 'B'  + r.replace(/[^0-9]/g, '');
        if (r.includes('SILVER'))     return 'S'  + r.replace(/[^0-9]/g, '');
        if (r.includes('GOLD'))       return 'G'  + r.replace(/[^0-9]/g, '');
        if (r.includes('PLATINUM'))   return 'P'  + r.replace(/[^0-9]/g, '');
        if (r.includes('DIAMOND'))    return 'D'  + r.replace(/[^0-9]/g, '');
        if (r.includes('ASCENDANT'))  return 'A'  + r.replace(/[^0-9]/g, '');
        if (r.includes('IMMORTAL'))   return 'Im' + r.replace(/[^0-9]/g, '');
        if (r.includes('RADIANT'))    return 'R';
        if (r.includes('UNRATED'))    return 'NR';
        return '';
    };

    const MEDALS = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
    const formatLine = (p, idx) => {
        const cfg     = findCfgByPuuid(allConfigPlayers, p.puuid);
        const tracked = cfg ? playersInMatch.find(t => t.playerId === cfg.id) : null;
        const isMvp   = p.puuid === matchMvpId;
        const inParty = !cfg && p.party_id && trackedPartyIds.has(p.party_id);
        const name    = p.name?.trim() || p.character || '—';

        let pos       = MEDALS[idx] ?? String(idx + 1 + '.').padEnd(3, ' ');
        const nameStr = cfg ? `**${name}**` : (inParty ? `*${name}*` : name);
        const agent   = p.character || '?';
        const k = p.stats?.kills   || 0;
        const d = p.stats?.deaths  || 0;
        const a = p.stats?.assists || 0;
        const acs = Math.round((p.stats?.score || 0) / rounds);
        const rank = shortRank(p.currenttier_patched);

        const kdaStr = `\`${String(k).padStart(2, ' ')}/${String(d).padStart(2, ' ')}/${String(a).padStart(2, ' ')}\``;
        const acsStr = `\`${String(acs).padStart(3, ' ')} ACS\``;

        const parts = [];
        if (tracked?.rrChange !== undefined) {
            const sign = tracked.rrChange > 0 ? '+' : '';
            parts.push(`**${sign}${tracked.rrChange} RR**`);
        }

        const rankDisplay = rank ? `${rank} ` : '';
        const teamIndicator = view === 'global' ? (p.team === 'Blue' ? '🟦 ' : (p.team === 'Red' ? '🟥 ' : '')) : '';
        let line = `${pos} ${teamIndicator}${rankDisplay}${kdaStr} ${acsStr} · ${nameStr} (${agent})${isMvp ? ' 👑' : ''}`;
        if (parts.length > 0) {
            line += ` · ${parts.join(' · ')}`;
        }
        return line;
    };

    const formatTeam = (team) => team.map((p, i) => formatLine(p, i)).join('\n');

    const resultEmoji = isWin ? '🏆' : (baseMatch.result === 'LOSS' ? '💔' : '🤝');
    const resultText  = isWin ? 'VICTOIRE' : (baseMatch.result === 'LOSS' ? 'DÉFAITE' : 'ÉGALITÉ');
    const color = view === 'blue' ? 0x3b82f6 : (view === 'red' ? 0xef4444 : (isWin ? 0x10b981 : (baseMatch.result === 'LOSS' ? 0xef4444 : 0x9ca3af)));

    const embed = new EmbedBuilder()
        .setTitle(`${resultEmoji} ${resultText} — ${(baseMatch.map || '?').toUpperCase()}`)
        .setURL(appUrl)
        .setColor(color)
        .setFooter({ text: 'KSL Tracker  •  gras = tracké KSL  •  italique = avec l\'escouade  •  👑 = MVP' })
        .setTimestamp(baseMatch.timestamp ? baseMatch.timestamp * 1000 : new Date(baseMatch.date).getTime());
        
    // Grande image de la map (splash art façon écran de chargement).
    // Cache dynamique valorant-api (couvre les futures maps), fallback statique.
    const mapName = (baseMatch.map || '').toLowerCase();
    const splash = (await getMapSplash(baseMatch.map)) || MAP_SPLASHES[mapName] || null;
    if (splash) embed.setImage(splash);

    // Thumbnail : l'agent du meilleur joueur tracké du match.
    const topTracked = [...playersInMatch].sort((a, b) => (b.score || 0) - (a.score || 0))[0];
    if (topTracked?.agentImg) embed.setThumbnail(topTracked.agentImg);

    const blueWin   = blueScore > redScore;
    const globalLabel = `__🌐 **SCOREBOARD GLOBAL** — ${blueScore} à ${redScore}__`;
    const blueLabel = `__🟦 **ÉQUIPE BLEUE** — ${blueScore} rounds${blueWin ? ' ✅' : ''}__`;
    const redLabel  = `__🟥 **ÉQUIPE ROUGE** — ${redScore} rounds${!blueWin && blueScore !== redScore ? ' ✅' : ''}__`;

    // Récupération des joueurs trackés pour les mentionner
    const trackedConfigs = [];
    allPlayers.forEach(p => {
        const cfg = findCfgByPuuid(allConfigPlayers, p.puuid);
        if (cfg && !trackedConfigs.some(c => c.id === cfg.id)) trackedConfigs.push(cfg);
    });
    const mentionsText = trackedConfigs.map(c => c.discord_id ? `<@${c.discord_id}>` : `**${c.name}**`).join(' · ');
    const mentionsPrefix = mentionsText ? `👥 ${mentionsText}\n\n` : '';

    const headerDesc = `${mentionsPrefix}**Score : ${baseMatch.matchScore}** · Classé · ${rounds} rounds\n\n`;

    if (view === 'global') {
        let desc = `${headerDesc}${globalLabel}\n${formatTeam(globalSorted)}`;
        if (desc.length > 4096) desc = desc.substring(0, 4090) + '\n...';
        embed.setDescription(desc);
    } else if (view === 'blue') {
        embed.setDescription(`${headerDesc}${blueLabel}\n${formatTeam(blueTeam)}`);
    } else if (view === 'red') {
        embed.setDescription(`${headerDesc}${redLabel}\n${formatTeam(redTeam)}`);
    }

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`match_global_${matchId}`).setLabel('📊 Les deux équipes').setStyle(view === 'global' ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`match_blue_${matchId}`).setLabel('🟦 Équipe Bleue').setStyle(view === 'blue' ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`match_red_${matchId}`).setLabel('🟥 Équipe Rouge').setStyle(view === 'red' ? ButtonStyle.Danger : ButtonStyle.Secondary)
    );

    return { embeds: [embed], components: [row] };
};

// ==========================================
// BOT DISCORD : CRÉATION DU CLASSEMENT
// ==========================================
const buildClassementMessage = async (category, allConfigPlayers, startTs, startFr) => {
    const playerIds = allConfigPlayers.map(p => p.id);
    const placeholders = playerIds.map(() => '?').join(',');
    const allRows = await db.all(
        `SELECT player_id, data FROM matches WHERE player_id IN (${placeholders}) AND date >= ? AND type = 'ranked' ORDER BY date DESC`,
        [...playerIds, startTs]
    );
    const rowsByPlayer = {};
    allRows.forEach(r => {
        if (!rowsByPlayer[r.player_id]) rowsByPlayer[r.player_id] = [];
        rowsByPlayer[r.player_id].push(r);
    });

    const stats = allConfigPlayers.map(p => {
        const rows = rowsByPlayer[p.id] || [];
        let rrTotal = 0, wins = 0, currentRank = 'Non classé', rankValue = 0, hsTotal = 0, shotsTotal = 0;
        rows.forEach(r => {
            const m = JSON.parse(r.data);
            rrTotal += (m.rrChange || 0);
            if (m.result === 'WIN') wins++;
            hsTotal += (m.headshots || 0);
            shotsTotal += (m.totalShots || 0);
        });
        if (rows.length > 0) { const last = JSON.parse(rows[0].data); currentRank = last.currentRank || 'Non classé'; rankValue = last.rankValue || 0; }
        return {
            name: p.name, rrTotal, wins, games: rows.length,
            winrate: rows.length > 0 ? Math.round((wins / rows.length) * 100) : 0,
            hsPct: shotsTotal > 0 ? Math.round((hsTotal / shotsTotal) * 100) : 0,
            currentRank, rankValue
        };
    });

    const activePlayers = stats.filter(p => p.games > 0);
    let title = ''; let color = 0xffd700; let mapFn;

    if (category === 'rr') {
        title = '🏆 Classement — Rank Rating (RR)'; activePlayers.sort((a, b) => b.rankValue - a.rankValue || b.rrTotal - a.rrTotal); mapFn = p => `${RANK_EMOJIS[p.currentRank?.toUpperCase()] || p.currentRank} \`${(p.rrTotal > 0 ? '+' : '') + String(p.rrTotal).padStart(3, ' ')} RR\` · **${p.name}**`;
    } else if (category === 'hs') {
        title = '🎯 Classement — Headshot %'; color = 0xef4444; activePlayers.sort((a, b) => b.hsPct - a.hsPct); mapFn = p => `🎯 \`${String(p.hsPct).padStart(3, ' ')}% HS\` · **${p.name}** (${p.games} parties)`;
    } else if (category === 'winrate') {
        title = '📈 Classement — Winrate'; color = 0x10b981; activePlayers.sort((a, b) => b.winrate - a.winrate || b.games - a.games); mapFn = p => `🏆 \`${String(p.winrate).padStart(3, ' ')}% WR\` · **${p.name}** (${p.wins}W - ${p.games - p.wins}L)`;
    } else if (category === 'games') {
        title = '🕹️ Classement — Parties Jouées'; color = 0x3b82f6; activePlayers.sort((a, b) => b.games - a.games); mapFn = p => `🕹️ \`${String(p.games).padStart(3, ' ')} GAMES\` · **${p.name}**`;
    }

    const medals = ['🥇', '🥈', '🥉'];
    const lines = activePlayers.map((p, i) => {
        let pos = medals[i] ?? `${i + 1}.`;
        if (i > 2) pos = String(pos).padEnd(3, ' ');
        return `${pos} ${mapFn(p)}`;
    }).join('\n');

    const embed = new EmbedBuilder()
        .setTitle(title)
        .setColor(color)
        .setDescription(lines || '*Aucune donnée disponible.*')
        .setFooter({ text: `Depuis le ${startFr}` })
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('class_rr').setLabel('📈 RR').setStyle(category === 'rr' ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('class_hs').setLabel('🎯 HS%').setStyle(category === 'hs' ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('class_winrate').setLabel('🏆 Win').setStyle(category === 'winrate' ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('class_games').setLabel('🕹️ Games').setStyle(category === 'games' ? ButtonStyle.Success : ButtonStyle.Secondary)
    );

    return { embeds: [embed], components: [row] };
};

// ==========================================
// BOT DISCORD : CRÉATION DU RAPPORT QUOTIDIEN
// ==========================================
const buildDailyReportMessage = async (dateStr, view, allConfigPlayers, appUrl) => {
    const targetDateStr = dateStr.replace(/-/g, '/');

    // 7 jours de matchs pour le calcul de tendance + filtrage par date cible
    const sevenDaysAgoTs = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const rows = await db.all(
        "SELECT date, data FROM matches WHERE type = 'ranked' AND date >= ? ORDER BY date DESC",
        [sevenDaysAgoTs]
    );
    const allRecentMatches = rows.map(r => {
        const m = JSON.parse(r.data);
        m.dbDate = r.date;
        return m;
    });
    const dailyRawMatches = allRecentMatches.filter(m =>
        getParisDateString(new Date(m.dbDate)) === targetDateStr
    );

    if (dailyRawMatches.length === 0) return null;

    // --- Agrégation ---
    const uniqueGames = {};
    const playerStats = {};
    allConfigPlayers.forEach(p => {
        playerStats[p.id] = {
            id: p.id, name: p.name,
            wins: 0, losses: 0, rrChange: 0, rrLost: 0,
            kills: 0, deaths: 0, assists: 0, headshots: 0, shots: 0,
            acsSum: 0, games: 0, agents: {},
            bestACS: 0, bestKills: 0, worstACS: Infinity,
            bestGame: null, worstGame: null
        };
    });

    const trackedPuuids = new Set(allConfigPlayers.map(p => p.puuid).filter(Boolean));

    dailyRawMatches.forEach(m => {
        if (!uniqueGames[m.id]) {
            uniqueGames[m.id] = { id: m.id, map: m.map, result: m.result, score: m.matchScore, time: m.date, players: [], allPlayersRaw: m.allPlayers || [] };
        }
        const pConfig = allConfigPlayers.find(p => p.id === m.playerId);
        const playerName = pConfig ? pConfig.name : "Inconnu";
        const kd = (m.kills / Math.max(1, m.deaths)).toFixed(2);
        const acs = m.acs || Math.round((m.score || 0) / (m.roundsPlayed || 1));
        const hsPct = m.totalShots > 0 ? Math.round((m.headshots / m.totalShots) * 100) : 0;
        const rrSign = m.rrChange > 0 ? '+' : '';

        let trackedPartyId = null;
        if (m.allPlayers && pConfig) {
            const me = m.allPlayers.find(ap => ap.puuid === pConfig.puuid)
                || m.allPlayers.find(ap => ap.character === m.agent && ap.team === m.myTeam);
            trackedPartyId = me?.party_id || null;
        }

        const rankEmoji = RANK_EMOJIS[(m.currentRank || '').toUpperCase().trim()] || m.currentRank || '';
        uniqueGames[m.id].players.push({
            name: playerName, agent: m.agent || "?", rr: `${rrSign}${m.rrChange}`,
            kd, result: m.result, acs, hs: hsPct, partyId: trackedPartyId, rank: rankEmoji
        });

        const ps = playerStats[m.playerId];
        if (ps) {
            ps.games++;
            if (m.result === 'WIN') ps.wins++; else ps.losses++;
            ps.rrChange += m.rrChange;
            if (m.rrChange < 0) ps.rrLost += Math.abs(m.rrChange);
            ps.kills += m.kills; ps.deaths += m.deaths; ps.assists += (m.assists || 0);
            ps.headshots += (m.headshots || 0); ps.shots += (m.totalShots || 0);
            ps.acsSum += acs;
            if (m.agent) ps.agents[m.agent] = (ps.agents[m.agent] || 0) + 1;
            if (acs > ps.bestACS) { ps.bestACS = acs; ps.bestGame = { map: m.map, acs, kills: m.kills, deaths: m.deaths, rr: m.rrChange }; }
            if (m.kills > ps.bestKills) ps.bestKills = m.kills;
            // Pire match = perf individuelle la plus faible (ACS), pas le résultat collectif (RR)
            if (acs > 0 && acs < ps.worstACS) { ps.worstACS = acs; ps.worstGame = { map: m.map, acs, kills: m.kills, deaths: m.deaths, rr: m.rrChange }; }
        }
    });

    const uniqueGamesList = Object.values(uniqueGames).sort((a, b) => new Date(a.time) - new Date(b.time));
    const totalUniqueGames = uniqueGamesList.length;
    const totalWins = uniqueGamesList.filter(g => g.result === 'WIN').length;
    const globalWinrate = Math.round((totalWins / totalUniqueGames) * 100);
    const activePlayers = Object.values(playerStats).filter(p => p.games > 0);
    const totalRRDay = activePlayers.reduce((acc, p) => acc + p.rrChange, 0);

    let weatherEmoji = "☁️"; let weatherTitle = "Mitigé"; let color = 0x9ca3af;
    if (globalWinrate >= 60) { weatherEmoji = "☀️"; weatherTitle = "Grand Soleil"; color = 0x10b981; }
    else if (globalWinrate >= 45) { weatherEmoji = "🌤️"; weatherTitle = "Éclaircies"; color = 0xfacc15; }
    else if (globalWinrate >= 25) { weatherEmoji = "🌧️"; weatherTitle = "Averses"; color = 0x3b82f6; }
    else { weatherEmoji = "⛈️"; weatherTitle = "Tempête"; color = 0xef4444; }

    // K/D safe : on traite 0 mort comme 1 pour éviter qu'un 5/0 batte un 30/10
    const safeKD = (k, d) => k / Math.max(1, d);
    const SHOTS_MIN = 50; // seuil minimum pour les classements HS%

    // GLOIRE
    const mvp     = [...activePlayers].sort((a, b) => b.rrChange - a.rrChange)[0];
    const butcher = [...activePlayers].sort((a, b) => safeKD(b.kills, b.deaths) - safeKD(a.kills, a.deaths))[0];
    const sniper  = [...activePlayers].filter(p => p.shots >= SHOTS_MIN).sort((a, b) => (b.headshots/b.shots) - (a.headshots/a.shots))[0];
    const topFragger = [...activePlayers].sort((a, b) => b.kills - a.kills)[0];

    // HONTE
    const loser        = [...activePlayers].sort((a, b) => a.rrChange - b.rrChange)[0];
    const donor        = [...activePlayers].sort((a, b) => b.rrLost - a.rrLost)[0];
    const stormtrooper = [...activePlayers].filter(p => p.shots >= SHOTS_MIN).sort((a, b) => (a.headshots/a.shots) - (b.headshots/b.shots))[0];
    const tourist      = [...activePlayers].sort((a, b) => (a.games > 0 ? a.acsSum/a.games : 0) - (b.games > 0 ? b.acsSum/b.games : 0))[0];

    const embed = new EmbedBuilder()
        .setTitle(`📊 RAPPORT QUOTIDIEN • ${targetDateStr}`)
        .setURL(appUrl)
        .setColor(color)
        .setFooter({ text: "KSL Tracker • Naviguez entre les onglets" })
        .setTimestamp();

    // ───── ONGLET 1 : BILAN ─────
    if (view === 'summary') {
        embed.addFields({
            name: `${weatherEmoji} Bilan de l'Escouade`,
            value: `**Météo :** ${weatherTitle}\n**Winrate :** ${globalWinrate}% (${totalWins}V — ${totalUniqueGames - totalWins}D)\n**Rentabilité :** ${totalRRDay >= 0 ? '+' : ''}${totalRRDay} RR collectifs\n**Parties :** ${totalUniqueGames} uniques · ${activePlayers.length} joueur(s) actif(s)`,
            inline: false
        });
        // GLOIRE
        let fameText = "";
        if (mvp && mvp.rrChange > 0) fameText += `👑 \`${('+' + mvp.rrChange).padStart(4, ' ')} RR\` · **MVP :** ${mvp.name}\n`;
        if (butcher) {
            const kdVal = safeKD(butcher.kills, butcher.deaths).toFixed(2);
            fameText += `🔪 \`${kdVal.padStart(5, ' ')} K/D\` · **Boucher :** ${butcher.name}\n`;
        }
        if (sniper) fameText += `🎯 \`${String(Math.round((sniper.headshots/sniper.shots)*100)).padStart(3, ' ')}% HS\` · **Sniper :** ${sniper.name}\n`;
        if (topFragger && topFragger.kills > 0) fameText += `👊 \`${String(topFragger.kills).padStart(3, ' ')} kills\` · **Top Fraggeur :** ${topFragger.name}\n`;

        // HONTE
        let shameText = "";
        if (donor && donor.rrLost > 0) shameText += `💸 \`-${String(donor.rrLost).padStart(3, ' ')} RR\` · **Donateur :** ${donor.name}\n`;
        if (stormtrooper) shameText += `🤖 \`${String(Math.round((stormtrooper.headshots/stormtrooper.shots)*100)).padStart(3, ' ')}% HS\` · **Stormtrooper :** ${stormtrooper.name}\n`;
        if (tourist) {
            const acsAvg = tourist.games > 0 ? Math.round(tourist.acsSum/tourist.games) : 0;
            shameText += `🚶 \`${String(acsAvg).padStart(3, ' ')} ACS\` · **Touriste :** ${tourist.name}\n`;
        }
        if (loser && loser.rrChange < 0) shameText += `🤡 \`${String(loser.rrChange).padStart(4, ' ')} RR\` · **Poids Mort :** ${loser.name}\n`;

        embed.addFields({ name: "🏆 Tableau d'Honneur", value: fameText || "*Aucun trophée marquant.*", inline: false });
        embed.addFields({ name: "💩 Tableau de Honte", value: shameText || "*Personne à blâmer aujourd'hui.*", inline: false });
        embed.setDescription(`*Naviguez entre les onglets pour explorer les détails.*`);

    // ───── ONGLET 2 : JOURNAL ─────
    } else if (view === 'log') {
        let gamesLog = "";
        uniqueGamesList.forEach(g => {
            const icon = g.result === 'WIN' ? "🟢" : (g.result === 'DRAW' ? "⚪" : "🔴");
            gamesLog += `${icon} **${(g.map || '?').toUpperCase()}**${g.score ? ` **${g.score}**` : ''}\n`;
            g.players.sort((a, b) => parseInt(b.rr) - parseInt(a.rr));
            const partiesShown = new Set();
            g.players.forEach(p => {
                const rrNum = parseInt(p.rr) || 0;
                const rrStr = rrNum > 0 ? `**+${rrNum} RR**` : (rrNum < 0 ? `**${rrNum} RR**` : `±0 RR`);
                gamesLog += `> ${p.rank} \`${String(p.kd).padStart(4, ' ')} K/D\` \`${String(p.acs).padStart(3, ' ')} ACS\` · **${p.name}** (${p.agent}) — ${rrStr} · ${p.hs}% HS\n`;
                if (p.partyId && !partiesShown.has(p.partyId)) {
                    partiesShown.add(p.partyId);
                    (g.allPlayersRaw || [])
                        .filter(ap => ap.party_id === p.partyId && !trackedPuuids.has(ap.puuid))
                        .forEach(mate => {
                            gamesLog += `> ↳ *${mate.name?.trim() || mate.character || 'Inconnu'}* (${mate.character || '?'}) — groupe\n`;
                        });
                }
            });
            gamesLog += "\n";
        });
        if (gamesLog.length > 3900) gamesLog = gamesLog.substring(0, 3900) + "\n... *[tronqué]*";
        embed.setDescription(`**🎮 Journal des Matchs**\n\n${gamesLog}`);

    // ───── ONGLET 3 : JOUEURS ─────
    } else if (view === 'players') {
        const sorted = [...activePlayers].sort((a, b) => b.rrChange - a.rrChange);
        let desc = "";
        if (topFragger && topFragger.kills > 0) {
            desc += `👊 **Top Fraggeur du jour :** ${topFragger.name} — **${topFragger.kills} kills** sur ${topFragger.games} game${topFragger.games > 1 ? 's' : ''}\n\n`;
        }
        sorted.forEach((p, i) => {
            const kd = safeKD(p.kills, p.deaths).toFixed(2);
            const hsPct = p.shots > 0 ? Math.round((p.headshots / p.shots) * 100) : 0;
            const avgAcs = p.games > 0 ? Math.round(p.acsSum / p.games) : 0;
            const rrSign = p.rrChange >= 0 ? '+' : '';
            const medals = ['🥇', '🥈', '🥉'];
            const pos = medals[i] ?? `${i + 1}.`;
            const favAgent = Object.entries(p.agents).sort((a, b) => b[1] - a[1])[0];
            desc += `${pos} **${p.name}** — ${p.wins}🟢 ${p.losses}🔴 **(${rrSign}${p.rrChange} RR)**\n`;
            desc += `> \`K/D: ${kd}\` \`ACS: ${avgAcs}\` \`HS: ${hsPct}%\``;
            if (favAgent) desc += ` · ${favAgent[0]}×${favAgent[1]}`;
            desc += `\n\n`;
        });
        if (desc.length > 3900) desc = desc.substring(0, 3900) + '\n...';
        embed.setDescription(`**👤 Performances par Joueur**\n\n${desc || '*Aucune donnée.*'}`);

    // ───── ONGLET 4 : HIGHLIGHTS ─────
    } else if (view === 'highlights') {
        let bestPerfPlayer = null, bestPerfGame = null, mostKillsPlayer = null, mostKillsVal = 0;
        let worstPerfPlayer = null, worstPerfGame = null;
        activePlayers.forEach(p => {
            if (p.bestGame && p.bestACS > (bestPerfGame?.acs ?? 0)) { bestPerfPlayer = p.name; bestPerfGame = p.bestGame; }
            // Pire match : la perf individuelle la plus faible (ACS), pas le résultat collectif (RR)
            if (p.worstGame && p.worstACS < (worstPerfGame?.acs ?? Infinity)) { worstPerfPlayer = p.name; worstPerfGame = p.worstGame; }
            if (p.bestKills > mostKillsVal) { mostKillsVal = p.bestKills; mostKillsPlayer = p.name; }
        });

        const mapStats = {};
        uniqueGamesList.forEach(g => {
            if (!mapStats[g.map]) mapStats[g.map] = { wins: 0, total: 0 };
            mapStats[g.map].total++;
            if (g.result === 'WIN') mapStats[g.map].wins++;
        });
        const mapsArr = Object.entries(mapStats).map(([map, s]) => ({ map, ...s, wr: Math.round(s.wins/s.total*100) }));
        mapsArr.sort((a, b) => b.wr - a.wr);
        const bestMap = mapsArr[0]; const worstMap = mapsArr[mapsArr.length - 1];

        const totalKills = activePlayers.reduce((s, p) => s + p.kills, 0);
        const totalDeaths = activePlayers.reduce((s, p) => s + p.deaths, 0);
        const globalKD = safeKD(totalKills, totalDeaths).toFixed(2);

        let desc = "";
        if (bestPerfPlayer && bestPerfGame) {
            const kdBest = safeKD(bestPerfGame.kills, bestPerfGame.deaths).toFixed(2);
            desc += `🏆 **Meilleur match (1 game) — ${bestPerfPlayer}** sur **${(bestPerfGame.map || '?').toUpperCase()}**\n`;
            desc += `> ${bestPerfGame.kills}/${bestPerfGame.deaths} (${kdBest} K/D) · **${bestPerfGame.acs} ACS** · ${bestPerfGame.rr >= 0 ? '+' : ''}${bestPerfGame.rr} RR\n\n`;
        }
        if (mostKillsPlayer) {
            desc += `🔫 **Record de kills (1 game) — ${mostKillsPlayer}** · ${mostKillsVal} frags\n\n`;
        }
        if (worstPerfPlayer && worstPerfGame) {
            const kdWorst = safeKD(worstPerfGame.kills, worstPerfGame.deaths).toFixed(2);
            desc += `💀 **Pire match (1 game) — ${worstPerfPlayer}** sur **${(worstPerfGame.map || '?').toUpperCase()}**\n`;
            desc += `> ${worstPerfGame.kills}/${worstPerfGame.deaths} (${kdWorst} K/D) · **${worstPerfGame.acs} ACS** · ${worstPerfGame.rr >= 0 ? '+' : ''}${worstPerfGame.rr} RR\n\n`;
        }
        if (bestMap) desc += `🗺️ **Meilleure carte — ${bestMap.map?.toUpperCase()}** · ${bestMap.wins}V ${bestMap.total - bestMap.wins}D (${bestMap.wr}%)\n`;
        if (worstMap && worstMap.map !== bestMap?.map) desc += `💔 **Pire carte — ${worstMap.map?.toUpperCase()}** · ${worstMap.wins}V ${worstMap.total - worstMap.wins}D (${worstMap.wr}%)\n`;
        desc += `\n📊 K/D collectif **${globalKD}** · ${totalKills} kills / ${totalDeaths} deaths\n`;
        desc += `🕹️ ${totalUniqueGames} parties · ${totalWins}V ${totalUniqueGames - totalWins}D · **${totalRRDay >= 0 ? '+' : ''}${totalRRDay} RR collectifs**`;
        if (desc.length > 3900) desc = desc.substring(0, 3900) + '\n...';
        embed.setDescription(`**⚡ Moments Forts**\n\n${desc}`);

    // ───── ONGLET 5 : TENDANCE ─────
    } else if (view === 'trend') {
        const otherDaysMatches = allRecentMatches.filter(m =>
            getParisDateString(new Date(m.dbDate)) !== targetDateStr
        );
        const byDay = {};
        otherDaysMatches.forEach(m => {
            const d = getParisDateString(new Date(m.dbDate));
            if (!byDay[d]) byDay[d] = [];
            byDay[d].push(m);
        });
        const daysWithData = Object.keys(byDay).length;

        // RR moyen par joueur sur les autres jours (par jour de jeu)
        const playerAvgRR = {};
        allConfigPlayers.forEach(p => {
            const pm = otherDaysMatches.filter(m => m.playerId === p.id);
            if (pm.length === 0) { playerAvgRR[p.id] = null; return; }
            const totalRR = pm.reduce((s, m) => s + (m.rrChange || 0), 0);
            const uniqueDays = new Set(pm.map(m => getParisDateString(new Date(m.dbDate)))).size;
            playerAvgRR[p.id] = uniqueDays > 0 ? Math.round(totalRR / uniqueDays) : 0;
        });

        // Winrate et RR moyen par jour (7j)
        const dayMetrics = Object.values(byDay).map(dayMatches => {
            const ids = [...new Set(dayMatches.map(m => m.id))];
            const wins = ids.filter(id => dayMatches.find(m => m.id === id)?.result === 'WIN').length;
            const rrDay = dayMatches.reduce((s, m) => s + (m.rrChange || 0), 0);
            return { wr: Math.round(wins / ids.length * 100), rr: rrDay, games: ids.length };
        });
        const avgWR7d = daysWithData > 0 ? Math.round(dayMetrics.reduce((s, d) => s + d.wr, 0) / daysWithData) : null;
        const avgRR7d = daysWithData > 0 ? Math.round(dayMetrics.reduce((s, d) => s + d.rr, 0) / daysWithData) : null;

        const wrDiff = avgWR7d !== null ? globalWinrate - avgWR7d : null;
        let trendEmoji = "➡️"; let trendText = "Dans la norme";
        if (wrDiff !== null) {
            if (wrDiff >= 15) { trendEmoji = "🔥"; trendText = "EN FÊTE"; }
            else if (wrDiff >= 5) { trendEmoji = "📈"; trendText = "AU-DESSUS DE LA NORMALE"; }
            else if (wrDiff <= -15) { trendEmoji = "💀"; trendText = "EN GALÈRE"; }
            else if (wrDiff <= -5) { trendEmoji = "📉"; trendText = "EN DESSOUS DE LA NORMALE"; }
        }

        let desc = `**📈 Forme du Jour vs 7 Derniers Jours**\n\n`;
        desc += `Aujourd'hui : **${globalWinrate}% WR** · **${totalRRDay >= 0 ? '+' : ''}${totalRRDay} RR** collectifs\n`;
        if (avgWR7d !== null) {
            desc += `Moy. 7 jours : **${avgWR7d}% WR** · **${avgRR7d !== null && avgRR7d >= 0 ? '+' : ''}${avgRR7d ?? '?'} RR**/jour\n`;
            desc += `\n${trendEmoji} **${trendText}**${wrDiff !== null ? ` (${wrDiff >= 0 ? '+' : ''}${wrDiff}% WR)` : ''}\n\n`;
        } else {
            desc += `*Pas assez d'historique pour comparer (< 7 jours).*\n\n`;
        }
        desc += `**Par joueur :**\n`;
        [...activePlayers].sort((a, b) => b.rrChange - a.rrChange).forEach(p => {
            const sign = p.rrChange >= 0 ? '+' : '';
            const avg = playerAvgRR[p.id];
            if (avg !== null && avg !== undefined) {
                const diff = p.rrChange - avg;
                const arrow = diff >= 5 ? '📈' : (diff <= -5 ? '📉' : '➡️');
                desc += `> **${p.name}** — ${sign}${p.rrChange} RR ${arrow} *(moy. ${avg >= 0 ? '+' : ''}${avg}/j)*\n`;
            } else {
                desc += `> **${p.name}** — ${sign}${p.rrChange} RR\n`;
            }
        });
        if (desc.length > 3900) desc = desc.substring(0, 3900) + '\n...';
        embed.setDescription(desc);
    }

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`report_summary_${dateStr}`).setLabel('📊 Bilan').setStyle(view === 'summary' ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`report_log_${dateStr}`).setLabel('🎮 Journal').setStyle(view === 'log' ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`report_players_${dateStr}`).setLabel('👤 Joueurs').setStyle(view === 'players' ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`report_highlights_${dateStr}`).setLabel('⚡ Highlights').setStyle(view === 'highlights' ? ButtonStyle.Danger : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`report_trend_${dateStr}`).setLabel('📈 Tendance').setStyle(view === 'trend' ? ButtonStyle.Primary : ButtonStyle.Secondary)
    );

    return { embeds: [embed], components: [row] };
};

// ==========================================
// BOT DISCORD : BUILDERS /vs /map /recap
// ==========================================

const buildVsMessage = async (playerId1, playerId2, allConfigPlayers) => {
    const p1 = allConfigPlayers.find(p => p.id === playerId1);
    const p2 = allConfigPlayers.find(p => p.id === playerId2);
    if (!p1 || !p2) return { content: '❌ Joueur introuvable.' };
    if (p1.id === p2.id) return { content: '❌ Choisis deux joueurs différents.' };

    const challengeStart = await getConfig('challenge_start_date', '2024-01-01T00:00');
    const startTs = new Date(challengeStart).getTime();

    const allRows = await db.all(
        "SELECT player_id, data FROM matches WHERE player_id IN (?, ?) AND date >= ? AND type = 'ranked' ORDER BY date DESC",
        [p1.id, p2.id, startTs]
    );

    const stat = (rows) => {
        let wins = 0, kills = 0, deaths = 0, hs = 0, shots = 0, acsSum = 0, rrTotal = 0;
        let rank = 'Non classé';
        rows.forEach(r => {
            const m = JSON.parse(r.data);
            if (m.result === 'WIN') wins++;
            kills += m.kills || 0; deaths += m.deaths || 0;
            hs += m.headshots || 0; shots += m.totalShots || 0;
            acsSum += m.acs || 0;
            rrTotal += m.rrChange || 0;
        });
        if (rows.length > 0) rank = JSON.parse(rows[0].data).currentRank || 'Inconnu';
        return {
            games: rows.length, wins, losses: rows.length - wins,
            winrate: rows.length > 0 ? Math.round(wins/rows.length*100) : 0,
            kd: kills / Math.max(1, deaths),
            hsPct: shots > 0 ? Math.round(hs/shots*100) : 0,
            avgAcs: rows.length > 0 ? Math.round(acsSum/rows.length) : 0,
            rrTotal, rank
        };
    };

    const rows1 = allRows.filter(r => r.player_id === p1.id);
    const rows2 = allRows.filter(r => r.player_id === p2.id);
    const s1 = stat(rows1);
    const s2 = stat(rows2);

    // Parties jouées ensemble (party_id en commun)
    const togetherMatches = new Set();
    let wTogether = 0, lTogether = 0;
    rows1.forEach(r => {
        const m = JSON.parse(r.data);
        if (!m.partyId) return;
        const matched = rows2.find(r2 => {
            const m2 = JSON.parse(r2.data);
            return m2.id === m.id && m2.partyId === m.partyId;
        });
        if (matched) {
            togetherMatches.add(m.id);
            if (m.result === 'WIN') wTogether++; else lTogether++;
        }
    });

    const winner = (v1, v2, higherIsBetter = true) => {
        if (Math.abs(v1 - v2) < 0.001) return ['', ''];
        const p1Wins = higherIsBetter ? v1 > v2 : v1 < v2;
        return p1Wins ? ['👑', ''] : ['', '👑'];
    };

    const [wW1, wW2] = winner(s1.winrate, s2.winrate);
    const [kdW1, kdW2] = winner(s1.kd, s2.kd);
    const [hsW1, hsW2] = winner(s1.hsPct, s2.hsPct);
    const [acsW1, acsW2] = winner(s1.avgAcs, s2.avgAcs);
    const [rrW1, rrW2] = winner(s1.rrTotal, s2.rrTotal);

    const rankE1 = RANK_EMOJIS[(s1.rank || '').toUpperCase()] || s1.rank;
    const rankE2 = RANK_EMOJIS[(s2.rank || '').toUpperCase()] || s2.rank;

    const embed = new EmbedBuilder()
        .setTitle(`⚔️ ${p1.name}  vs  ${p2.name}`)
        .setColor(0xff4655)
        .setFooter({ text: `Période : depuis le ${new Date(challengeStart).toLocaleDateString('fr-FR')}` })
        .setTimestamp()
        .addFields(
            { name: `${rankE1} ${p1.name}`, value: `\`${s1.games}\` parties\n\`${s1.winrate}%\` WR ${wW1}\n\`${s1.kd.toFixed(2)}\` K/D ${kdW1}\n\`${s1.hsPct}%\` HS ${hsW1}\n\`${s1.avgAcs}\` ACS ${acsW1}\n\`${s1.rrTotal >= 0 ? '+' : ''}${s1.rrTotal}\` RR ${rrW1}`, inline: true },
            { name: `${rankE2} ${p2.name}`, value: `\`${s2.games}\` parties\n\`${s2.winrate}%\` WR ${wW2}\n\`${s2.kd.toFixed(2)}\` K/D ${kdW2}\n\`${s2.hsPct}%\` HS ${hsW2}\n\`${s2.avgAcs}\` ACS ${acsW2}\n\`${s2.rrTotal >= 0 ? '+' : ''}${s2.rrTotal}\` RR ${rrW2}`, inline: true }
        );

    if (togetherMatches.size > 0) {
        embed.addFields({
            name: '🤝 Ensemble',
            value: `**${togetherMatches.size}** parties en escouade · **${wTogether}V ${lTogether}D** (${Math.round(wTogether/(wTogether+lTogether)*100)}% WR)`,
            inline: false
        });
    }

    return { embeds: [embed] };
};

const buildMapMessage = async (mapValue, allConfigPlayers) => {
    const challengeStart = await getConfig('challenge_start_date', '2024-01-01T00:00');
    const startTs = new Date(challengeStart).getTime();
    const trackedIds = allConfigPlayers.map(p => p.id);
    if (trackedIds.length === 0) return { content: '❌ Aucun joueur configuré.' };

    const placeholders = trackedIds.map(() => '?').join(',');
    const rows = await db.all(
        `SELECT data FROM matches WHERE type = 'ranked' AND date >= ? AND LOWER(map) = ? AND player_id IN (${placeholders}) ORDER BY date DESC`,
        [startTs, mapValue, ...trackedIds]
    );

    if (rows.length === 0) return { content: `🗺️ Aucune partie classée jouée sur **${mapValue.toUpperCase()}** depuis le début du challenge.` };

    const matches = rows.map(r => JSON.parse(r.data));
    const uniqueMatchIds = new Set(matches.map(m => m.id));
    const uniqueGames = [...uniqueMatchIds].map(id => matches.find(m => m.id === id));
    const wins = uniqueGames.filter(g => g.result === 'WIN').length;
    const losses = uniqueGames.length - wins;
    const winrate = Math.round(wins / uniqueGames.length * 100);

    // Stats par joueur sur cette map
    const playerOnMap = {};
    matches.forEach(m => {
        const cfg = allConfigPlayers.find(p => p.id === m.playerId);
        if (!cfg) return;
        if (!playerOnMap[cfg.id]) {
            playerOnMap[cfg.id] = { name: cfg.name, games: 0, kills: 0, deaths: 0, wins: 0, agents: {}, acsSum: 0 };
        }
        const ps = playerOnMap[cfg.id];
        ps.games++;
        if (m.result === 'WIN') ps.wins++;
        ps.kills += m.kills || 0;
        ps.deaths += m.deaths || 0;
        ps.acsSum += m.acs || 0;
        if (m.agent) ps.agents[m.agent] = (ps.agents[m.agent] || 0) + 1;
    });

    // MVP de la carte = meilleur K/D moyen (min 2 games)
    const eligible = Object.values(playerOnMap).filter(p => p.games >= 2);
    const mapMVP = eligible.length > 0
        ? eligible.sort((a, b) => (b.kills/Math.max(1,b.deaths)) - (a.kills/Math.max(1,a.deaths)))[0]
        : null;

    // Agents les plus joués sur cette map (toutes parties confondues)
    const allAgents = {};
    matches.forEach(m => { if (m.agent) allAgents[m.agent] = (allAgents[m.agent] || 0) + 1; });
    const topAgents = Object.entries(allAgents).sort((a, b) => b[1] - a[1]).slice(0, 5);

    let color = 0x9ca3af;
    if (winrate >= 60) color = 0x10b981;
    else if (winrate >= 45) color = 0xfacc15;
    else if (winrate >= 25) color = 0x3b82f6;
    else color = 0xef4444;

    const embed = new EmbedBuilder()
        .setTitle(`🗺️ ${mapValue.toUpperCase()} — Stats du Groupe`)
        .setColor(color)
        .setFooter({ text: `Période : depuis le ${new Date(challengeStart).toLocaleDateString('fr-FR')}` })
        .setTimestamp();

    if (MAP_SPLASHES[mapValue]) embed.setThumbnail(MAP_SPLASHES[mapValue]);

    embed.addFields({
        name: '📊 Bilan',
        value: `**${uniqueGames.length}** parties · **${wins}V ${losses}D** · **${winrate}% WR**`,
        inline: false
    });

    if (mapMVP) {
        const kd = (mapMVP.kills / Math.max(1, mapMVP.deaths)).toFixed(2);
        const avgAcs = Math.round(mapMVP.acsSum / mapMVP.games);
        embed.addFields({
            name: '👑 MVP de la carte',
            value: `**${mapMVP.name}** · \`${kd}\` K/D · \`${avgAcs}\` ACS · ${mapMVP.games} parties`,
            inline: false
        });
    }

    if (topAgents.length > 0) {
        const agentList = topAgents.map(([name, count]) => `\`${name}\` ×${count}`).join(' · ');
        embed.addFields({ name: '🤘 Agents les plus joués', value: agentList, inline: false });
    }

    // Top 3 joueurs (par games sur la map)
    const topPlayers = Object.values(playerOnMap).sort((a, b) => b.games - a.games).slice(0, 5);
    if (topPlayers.length > 0) {
        const list = topPlayers.map(p => {
            const wr = Math.round(p.wins / p.games * 100);
            const kd = (p.kills / Math.max(1, p.deaths)).toFixed(2);
            return `**${p.name}** · ${p.games}p · ${wr}% WR · ${kd} K/D`;
        }).join('\n');
        embed.addFields({ name: '🧍 Joueurs', value: list, inline: false });
    }

    return { embeds: [embed] };
};

const buildRecapMessage = async (period, allConfigPlayers) => {
    let startTs, label, periodTitle;
    const now = Date.now();
    if (period === 'week') {
        startTs = now - 7 * 24 * 60 * 60 * 1000;
        label = '7 derniers jours';
        periodTitle = 'SEMAINE';
    } else if (period === 'month') {
        startTs = now - 30 * 24 * 60 * 60 * 1000;
        label = '30 derniers jours';
        periodTitle = 'MOIS';
    } else {
        const challengeStart = await getConfig('challenge_start_date', '2024-01-01T00:00');
        startTs = new Date(challengeStart).getTime();
        label = `depuis le ${new Date(challengeStart).toLocaleDateString('fr-FR')}`;
        periodTitle = 'CHALLENGE';
    }

    const trackedIds = allConfigPlayers.map(p => p.id);
    if (trackedIds.length === 0) return { content: '❌ Aucun joueur configuré.' };

    const placeholders = trackedIds.map(() => '?').join(',');
    const rows = await db.all(
        `SELECT player_id, data FROM matches WHERE type = 'ranked' AND date >= ? AND player_id IN (${placeholders}) ORDER BY date DESC`,
        [startTs, ...trackedIds]
    );

    if (rows.length === 0) return { content: `🚫 Aucune partie classée sur cette période (${label}).` };

    const matches = rows.map(r => ({ ...JSON.parse(r.data), _pid: r.player_id }));
    const uniqueGameIds = new Set(matches.map(m => m.id));

    const playerStats = {};
    allConfigPlayers.forEach(p => {
        playerStats[p.id] = { name: p.name, games: 0, wins: 0, kills: 0, deaths: 0, hs: 0, shots: 0, rr: 0, rrLost: 0, acsSum: 0 };
    });

    let totalWins = 0;
    const winsCounted = new Set();
    matches.forEach(m => {
        if (!winsCounted.has(m.id)) {
            if (m.result === 'WIN') totalWins++;
            winsCounted.add(m.id);
        }
        const ps = playerStats[m._pid];
        if (!ps) return;
        ps.games++;
        if (m.result === 'WIN') ps.wins++;
        ps.kills += m.kills || 0;
        ps.deaths += m.deaths || 0;
        ps.hs += m.headshots || 0;
        ps.shots += m.totalShots || 0;
        ps.acsSum += m.acs || 0;
        ps.rr += m.rrChange || 0;
        if ((m.rrChange || 0) < 0) ps.rrLost += Math.abs(m.rrChange);
    });

    const totalGames = uniqueGameIds.size;
    const globalWR = Math.round(totalWins / totalGames * 100);
    const active = Object.values(playerStats).filter(p => p.games > 0);
    const totalRR = active.reduce((s, p) => s + p.rr, 0);

    const sortedByRR = [...active].sort((a, b) => b.rr - a.rr);
    const mvp = sortedByRR[0];
    const flop = sortedByRR[sortedByRR.length - 1];
    const topFragger = [...active].sort((a, b) => b.kills - a.kills)[0];
    const bestKD = [...active].sort((a, b) => (b.kills/Math.max(1,b.deaths)) - (a.kills/Math.max(1,a.deaths)))[0];
    const sniper = [...active].filter(p => p.shots >= 50).sort((a, b) => (b.hs/b.shots) - (a.hs/a.shots))[0];

    let color = 0x9ca3af;
    if (globalWR >= 60) color = 0x10b981;
    else if (globalWR >= 45) color = 0xfacc15;
    else if (globalWR >= 25) color = 0x3b82f6;
    else color = 0xef4444;

    const embed = new EmbedBuilder()
        .setTitle(`📊 RECAP ${periodTitle}`)
        .setColor(color)
        .setFooter({ text: `Période : ${label}` })
        .setTimestamp()
        .addFields({
            name: '📈 Bilan global',
            value: `**${totalGames}** parties · **${totalWins}V ${totalGames - totalWins}D** · **${globalWR}% WR**\nRR collectif : **${totalRR >= 0 ? '+' : ''}${totalRR}** sur l'escouade`,
            inline: false
        });

    let fame = "";
    if (mvp && mvp.rr > 0) fame += `👑 **MVP :** ${mvp.name} (${mvp.rr >= 0 ? '+' : ''}${mvp.rr} RR)\n`;
    if (bestKD) fame += `🔪 **Boucher :** ${bestKD.name} (${(bestKD.kills/Math.max(1,bestKD.deaths)).toFixed(2)} K/D)\n`;
    if (sniper) fame += `🎯 **Sniper :** ${sniper.name} (${Math.round(sniper.hs/sniper.shots*100)}% HS)\n`;
    if (topFragger) fame += `👊 **Top Fraggeur :** ${topFragger.name} (${topFragger.kills} kills)\n`;
    if (flop && flop.rr < 0) fame += `🤡 **Poids Mort :** ${flop.name} (${flop.rr} RR)\n`;
    embed.addFields({ name: '🏆 Tableau d\'Honneur', value: fame || "*Aucun trophée marquant.*", inline: false });

    // Classement par RR
    const ranking = sortedByRR.slice(0, 10).map((p, i) => {
        const medal = ['🥇','🥈','🥉'][i] ?? `${i+1}.`;
        const wr = Math.round(p.wins/p.games*100);
        return `${medal} **${p.name}** — \`${p.rr >= 0 ? '+' : ''}${p.rr} RR\` · ${p.games}p · ${wr}% WR`;
    }).join('\n');
    embed.addFields({ name: '📈 Classement par RR', value: ranking || '*Vide*', inline: false });

    return { embeds: [embed] };
};

// ==========================================
// BOT DISCORD : ÉCOUTEURS D'ÉVÉNEMENTS
// ==========================================
// ==========================================
// BOT DISCORD : SLASH COMMANDS (ENREGISTREMENT)
// ==========================================
discordClient.once('clientReady', async () => {
    const players = await getPlayers();
    const choices = players.slice(0, 25).map(p => ({ name: p.name, value: p.id }));

    const playerOption = { type: 3, name: 'joueur', description: 'Joueur KSL (Optionnel si compte lié)', required: false };
    const linkOption = { type: 3, name: 'joueur', description: 'Ton pseudo KSL', required: true };
    const vsOption1 = { type: 3, name: 'joueur1', description: 'Premier joueur', required: true };
    const vsOption2 = { type: 3, name: 'joueur2', description: 'Deuxième joueur', required: true };

    // Sécurité : Discord bloque le démarrage si les choix sont vides
    if (choices.length > 0) {
        playerOption.choices = choices;
        linkOption.choices = choices;
        vsOption1.choices = choices;
        vsOption2.choices = choices;
    }

    const MAP_CHOICES = [
        { name: 'Ascent', value: 'ascent' }, { name: 'Bind', value: 'bind' },
        { name: 'Breeze', value: 'breeze' }, { name: 'Fracture', value: 'fracture' },
        { name: 'Haven', value: 'haven' }, { name: 'Icebox', value: 'icebox' },
        { name: 'Lotus', value: 'lotus' }, { name: 'Pearl', value: 'pearl' },
        { name: 'Split', value: 'split' }, { name: 'Sunset', value: 'sunset' },
        { name: 'Abyss', value: 'abyss' }
    ];

    const PERIOD_CHOICES = [
        { name: 'Semaine (7 derniers jours)', value: 'week' },
        { name: 'Mois (30 derniers jours)', value: 'month' },
        { name: 'Depuis le début du challenge', value: 'challenge' }
    ];

    const commands = [
        { name: 'classement', description: '🏆 Classements KSL (RR, Winrate, HS%, Parties)' },
        { name: 'stats', description: '📊 Stats ranked et courbe de RR d\'un joueur', options: [playerOption] },
        { name: 'historique', description: '🕒 Affiche les 5 derniers matchs classés', options: [playerOption] },
        { name: 'link', description: '🔗 Lier ton compte Discord à ton profil tracker', options: [linkOption] },
        { name: 'rapport', description: '📋 Génère le rapport journalier maintenant' },
        { name: 'crosshair', description: '🎯 Affiche l\'image d\'un viseur', options: [{ type: 3, name: 'code', description: 'Le code d\'export du viseur (ex: 0;s;1;P;c;5...)', required: true }] },
        { name: 'vs', description: '⚔️ Comparaison entre deux joueurs KSL', options: [vsOption1, vsOption2] },
        { name: 'map', description: '🗺️ Stats du groupe sur une carte', options: [{ type: 3, name: 'carte', description: 'Nom de la carte', required: true, choices: MAP_CHOICES }] },
        { name: 'recap', description: '📊 Récapitulatif sur une période (semaine/mois/challenge)', options: [{ type: 3, name: 'periode', description: 'Période à analyser', required: true, choices: PERIOD_CHOICES }] },
    ];

    try {
        const rest = new REST({ version: '10' }).setToken(discordClient.token);
        await rest.put(Routes.applicationCommands(discordClient.user.id), { body: commands });
        console.log('✅ Slash commands Discord enregistrées.');
    } catch (e) {
        console.error('❌ Slash commands — erreur enregistrement :', e.message);
    }
});

discordClient.on('interactionCreate', async interaction => {
    const { players: allConfigPlayers, appUrl } = await getDiscordCachedData();

    // ===== SLASH COMMANDS =====
    if (interaction.isChatInputCommand()) {
        const { commandName } = interaction;

        if (commandName === 'classement') {
            await interaction.deferReply();
            const challengeStart = await getConfig('challenge_start_date', '2024-01-01T00:00');
            const startTs = new Date(challengeStart).getTime();
            const startFr = new Date(challengeStart).toLocaleDateString('fr-FR');

            const payload = await buildClassementMessage('rr', allConfigPlayers, startTs, startFr);
            await interaction.editReply(payload);
        }

        else if (commandName === 'stats') {
            await interaction.deferReply();
            const playerId = interaction.options.getString('joueur');
            let target;
            if (playerId) {
                target = allConfigPlayers.find(p => p.id === playerId);
            } else {
                target = allConfigPlayers.find(p => p.discord_id === interaction.user.id);
            }
            
            if (!target) { 
                await interaction.editReply({ content: '❌ Joueur introuvable. Précise un joueur ou utilise /link pour lier ton compte.' }); 
                return; 
            }

            const rows = await db.all(
                "SELECT data FROM matches WHERE player_id = ? AND type = 'ranked' ORDER BY date DESC LIMIT 20",
                [target.id]
            );
            if (rows.length === 0) { await interaction.editReply({ content: `⚠️ Aucun match classé pour **${target.name}**.` }); return; }
            
            const matchesChronological = [...rows].reverse().map(r => JSON.parse(r.data));

            let wins = 0, kills = 0, deaths = 0, assists = 0, rrTotal = 0, acsSum = 0, currentRank = 'Inconnu';
            
            let currentRRValue = 0;
            const rrDataPoints = [0];
            const labels = ['Start'];

            matchesChronological.forEach((m, index) => {
                rrTotal += m.rrChange || 0;
                currentRRValue += m.rrChange || 0;
                rrDataPoints.push(currentRRValue);
                labels.push(`#${index + 1}`);
            });
            
            rows.forEach(r => {
                const m = JSON.parse(r.data);
                if (m.result === 'WIN') wins++;
                kills += m.kills || 0; deaths += m.deaths || 0; assists += m.assists || 0;
                acsSum += m.acs || 0;
            });
            currentRank = JSON.parse(rows[0].data).currentRank || 'Inconnu';
            const kd = deaths > 0 ? (kills / deaths).toFixed(2) : kills;
            const winrate = Math.round((wins / rows.length) * 100);
            const avgAcs = Math.round(acsSum / rows.length);
            const sign = rrTotal > 0 ? '+' : '';
            const color = parseInt((target.color || '#ff4655').replace('#', ''), 16) || 0xff4655;
            const currentRankEmoji = RANK_EMOJIS[currentRank.toUpperCase()] || currentRank;
            
            const chartConfig = {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'RR Evolution',
                        data: rrDataPoints,
                        borderColor: target.color || '#ff4655',
                        backgroundColor: 'rgba(255, 70, 85, 0.1)',
                        borderWidth: 3,
                        pointRadius: 0,
                        fill: true,
                        tension: 0.4
                    }]
                },
                options: {
                    legend: { display: false },
                    scales: {
                        yAxes: [{ gridLines: { color: 'rgba(255,255,255,0.1)' }, ticks: { fontColor: '#aaa' } }],
                        xAxes: [{ gridLines: { display: false }, ticks: { fontColor: '#aaa' } }]
                    }
                }
            };
            const chartUrl = `https://quickchart.io/chart?w=500&h=250&c=${encodeURIComponent(JSON.stringify(chartConfig))}&bkg=${encodeURIComponent('#1c252e')}`;

            const embed = new EmbedBuilder()
                .setTitle(`📊 ${target.name} — Stats Ranked`)
                .setColor(color)
                .setDescription(`*${rows.length} derniers matchs • ${currentRankEmoji}*`)
                .addFields(
                    { name: '🏆 W/L', value: `**${wins}W** — ${rows.length - wins}L\n${winrate}% WR`, inline: true },
                    { name: '⚔️ K/D/A', value: `**${kd}** K/D\n${Math.round(kills/rows.length)}/${Math.round(deaths/rows.length)}/${Math.round(assists/rows.length)} moy.`, inline: true },
                    { name: '💥 Perf.', value: `**${avgAcs}** ACS moy.\n${sign}${rrTotal} RR total`, inline: true }
                )
                .setImage(chartUrl)
                .setTimestamp();
            await interaction.editReply({ embeds: [embed] });
        }
        
        else if (commandName === 'historique') {
            await interaction.deferReply();
            const playerId = interaction.options.getString('joueur');
            let target;
            if (playerId) {
                target = allConfigPlayers.find(p => p.id === playerId);
            } else {
                target = allConfigPlayers.find(p => p.discord_id === interaction.user.id);
            }
            
            if (!target) { 
                await interaction.editReply({ content: '❌ Joueur introuvable. Précise un joueur ou utilise /link pour lier ton compte.' }); 
                return; 
            }

            const rows = await db.all(
                "SELECT data FROM matches WHERE player_id = ? AND type = 'ranked' ORDER BY date DESC LIMIT 5",
                [target.id]
            );
            if (rows.length === 0) { await interaction.editReply({ content: `⚠️ Aucun match classé pour **${target.name}**.` }); return; }
            
            const embed = new EmbedBuilder()
                .setTitle(`🕒 Historique récent — ${target.name}`)
                .setColor(parseInt((target.color || '#ff4655').replace('#', ''), 16) || 0xff4655)
                .setTimestamp();

            let desc = "";
            rows.forEach((r, i) => {
                const m = JSON.parse(r.data);
                if (i === 0 && m.agentImg) embed.setThumbnail(m.agentImg);
                const emoji = m.result === 'WIN' ? '🟢' : (m.result === 'LOSS' ? '🔴' : '⚪');
                const sign = m.rrChange > 0 ? '+' : '';
        
        let favWeapon = '';
        if (m.weaponStats) {
            const weapons = Object.entries(m.weaponStats).sort((a, b) => b[1].kills - a[1].kills);
            if (weapons.length > 0) favWeapon = ` 🔫 ${weapons[0][0]}`;
        }
        
        const kda = `${m.kills}/${m.deaths}/${m.assists}`;
        const rankStr = m.currentRank ? (RANK_EMOJIS[m.currentRank.toUpperCase().trim()] || m.currentRank) : '';
        desc += `${emoji} **${(m.map || '?').toUpperCase()}** (${m.matchScore || '? - ?'})\n> ${rankStr ? rankStr + ' ' : ''}\`${kda.padStart(8, ' ')} | ${String(m.acs || 0).padStart(3, ' ')} ACS\` · **${sign}${m.rrChange || 0} RR** · ${m.agent || '?'}${favWeapon}\n\n`;
            });
            
            embed.setDescription(desc);
            await interaction.editReply({ embeds: [embed] });
        }
        
        else if (commandName === 'link') {
            await interaction.deferReply({ ephemeral: true });
            const playerId = interaction.options.getString('joueur');
            const target = allConfigPlayers.find(p => p.id === playerId);
            if (!target) { await interaction.editReply({ content: '❌ Joueur introuvable.' }); return; }

            const discordId = interaction.user.id;
            await db.run("UPDATE players SET discord_id = ? WHERE id = ?", [discordId, target.id]);
            await interaction.editReply({ content: `✅ Ton compte Discord a été lié avec succès au joueur **${target.name}** ! Tu peux maintenant utiliser \`/stats\` directement.` });
            return;
        }

        else if (commandName === 'rapport') {
            await interaction.deferReply();
            await generateDailyReport(true);
            await interaction.editReply({ content: '✅ Rapport journalier généré et envoyé !' });
        }

        else if (commandName === 'crosshair') {
            await interaction.deferReply();
            const code = interaction.options.getString('code');
            // L'API HenrikDev gère la génération de l'image
            const crosshairUrl = `https://api.henrikdev.xyz/valorant/v1/crosshair/generate?id=${encodeURIComponent(code)}`;

            const embed = new EmbedBuilder()
                .setTitle(`🎯 Aperçu du Viseur`)
                .setDescription(`Code: \`${code}\``)
                .setImage(crosshairUrl)
                .setColor(0xff4655)
                .setFooter({ text: 'Généré via HenrikDev API' });

            await interaction.editReply({ embeds: [embed] });
        }

        else if (commandName === 'vs') {
            await interaction.deferReply();
            const id1 = interaction.options.getString('joueur1');
            const id2 = interaction.options.getString('joueur2');
            const payload = await buildVsMessage(id1, id2, allConfigPlayers);
            await interaction.editReply(payload);
        }

        else if (commandName === 'map') {
            await interaction.deferReply();
            const carte = interaction.options.getString('carte');
            const payload = await buildMapMessage(carte, allConfigPlayers);
            await interaction.editReply(payload);
        }

        else if (commandName === 'recap') {
            await interaction.deferReply();
            const periode = interaction.options.getString('periode');
            const payload = await buildRecapMessage(periode, allConfigPlayers);
            await interaction.editReply(payload);
        }

        return;
    }

    // ===== BOUTONS =====
    if (!interaction.isButton()) return;

    const customId = interaction.customId;

    if (customId.startsWith('match_')) {
        try { await interaction.deferUpdate(); } catch (e) { return; }
        const parts = customId.split('_');
        const view = parts[1];
        const matchId = parts.slice(2).join('_');

        const messagePayload = await buildMatchMessage(matchId, view, allConfigPlayers, appUrl);
        if (messagePayload) {
            await interaction.editReply(messagePayload);
        } else {
            await interaction.followUp({ content: "Désolé, ce match n'est plus en base de données.", ephemeral: true });
        }
    }
    else if (customId.startsWith('class_')) {
        try { await interaction.deferUpdate(); } catch (e) { return; }
        const category = customId.split('_')[1];
        const challengeStart = await getConfig('challenge_start_date', '2024-01-01T00:00');
        const startTs = new Date(challengeStart).getTime();
        const startFr = new Date(challengeStart).toLocaleDateString('fr-FR');
        
        const messagePayload = await buildClassementMessage(category, allConfigPlayers, startTs, startFr);
        await interaction.editReply(messagePayload);
    }
    else if (customId.startsWith('report_')) {
        try { await interaction.deferUpdate(); } catch (e) { return; }
        const parts = customId.split('_');
        const view = parts[1];
        const dateStr = parts.slice(2).join('_');

        const messagePayload = await buildDailyReportMessage(dateStr, view, allConfigPlayers, appUrl);
        if (messagePayload) {
            await interaction.editReply(messagePayload);
        } else {
            await interaction.followUp({ content: "Désolé, les données de ce rapport ont expiré.", ephemeral: true });
        }
    }
});

const sendDiscordMessage = async (channelId, payload) => {
    try {
        if (!channelId) return;
        const channel = await discordClient.channels.fetch(channelId);
        if (channel) {
            await channel.send(payload);
        }
    } catch (e) {
        console.error("❌ Erreur envoi message Discord:", e.message);
    }
};

// ==========================================
// RÉCAPS PARTAGEABLES (Wrapped KSL)
// ==========================================

// UUID stable des paliers compétitifs (icônes de rang valorant-api).
const TIER_UUID_SRV = "03621f52-342b-cf4e-4f86-9350a49c6d04";
const TIER_NAME_TO_ID = {
    'unrated': 0, 'iron 1': 3, 'iron 2': 4, 'iron 3': 5, 'bronze 1': 6, 'bronze 2': 7, 'bronze 3': 8,
    'silver 1': 9, 'silver 2': 10, 'silver 3': 11, 'gold 1': 12, 'gold 2': 13, 'gold 3': 14,
    'platinum 1': 15, 'platinum 2': 16, 'platinum 3': 17, 'diamond 1': 18, 'diamond 2': 19, 'diamond 3': 20,
    'ascendant 1': 21, 'ascendant 2': 22, 'ascendant 3': 23, 'immortal 1': 24, 'immortal 2': 25, 'immortal 3': 26, 'radiant': 27,
};
const rankIconUrl = (tierName) => {
    const id = TIER_NAME_TO_ID[(tierName || '').toLowerCase().trim()] ?? 0;
    return `https://media.valorant-api.com/competitivetiers/${TIER_UUID_SRV}/${id}/largeicon.png`;
};

// Agrège la session (dernier jour joué) de toute l'escouade pour la carte de soirée.
const gatherSessionData = async () => {
    const players = await getPlayers();
    const now = Date.now();
    const start = new Date(now);
    start.setHours(16, 0, 0, 0);
    if (new Date(now).getHours() < 6) start.setDate(start.getDate() - 1);
    const windowStart = start.getTime();

    const perPlayer = [];
    let anyGames = false;
    for (const p of players) {
        const rows = await db.all(
            "SELECT data FROM matches WHERE player_id = ? AND type = 'ranked' AND date >= ? ORDER BY date DESC",
            [p.id, windowStart]
        );
        const games = rows.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
        if (games.length === 0) continue;
        anyGames = true;
        perPlayer.push({
            name: p.name, color: p.color,
            rr: games.reduce((s, m) => s + (m.rrChange || 0), 0),
            wins: games.filter(m => m.result === 'WIN').length,
            losses: games.filter(m => m.result === 'LOSS').length,
        });
    }
    if (!anyGames) return null;

    perPlayer.sort((a, b) => b.rr - a.rr);
    const collective = perPlayer.reduce((acc, s) => {
        acc.rr += s.rr; acc.wins += s.wins; acc.losses += s.losses; acc.games += s.wins + s.losses;
        return acc;
    }, { rr: 0, wins: 0, losses: 0, games: 0 });
    const mvp = perPlayer[0] && perPlayer[0].rr > 0 ? perPlayer[0] : null;
    const dateLabel = new Date(windowStart).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });

    return { dateLabel, collective, mvp, topPlayers: perPlayer };
};

// Agrège les stats carrière d'un joueur pour sa carte de profil.
const gatherPlayerCardData = async (playerId) => {
    const players = await getPlayers();
    const cfg = players.find(p => p.id === playerId);
    if (!cfg) return null;

    const rows = await db.all("SELECT data FROM matches WHERE player_id = ? AND type = 'ranked'", [playerId]);
    const games = rows.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
    if (games.length === 0) return null;

    const wins = games.filter(m => m.result === 'WIN').length;
    const kills = games.reduce((s, m) => s + (m.kills || 0), 0);
    const deaths = games.reduce((s, m) => s + (m.deaths || 0), 0);
    const hs = games.reduce((s, m) => s + (m.headshots || 0), 0);
    const shots = games.reduce((s, m) => s + (m.headshots || 0) + (m.bodyshots || 0) + (m.legshots || 0), 0);
    const adrGames = games.filter(m => m.adr != null);
    const avgAdr = adrGames.length ? Math.round(adrGames.reduce((s, m) => s + m.adr, 0) / adrGames.length) : 0;

    let mmr = null; try { mmr = cfg.live_mmr ? JSON.parse(cfg.live_mmr) : null; } catch { mmr = null; }
    const rankName = mmr?.current?.tier || null;
    const peak = mmr?.peak?.tier || null;

    return {
        name: cfg.name, tag: cfg.tag, color: cfg.color,
        rankName, peak,
        rankIconUri: rankName ? await toDataUri(rankIconUrl(rankName)) : null,
        bannerUri: cfg.account_card ? await toDataUri(`https://media.valorant-api.com/playercards/${cfg.account_card}/wideart.png`) : null,
        stats: {
            games: games.length,
            winrate: Math.round((wins / games.length) * 100),
            kd: (deaths > 0 ? kills / deaths : kills).toFixed(2),
            hsPct: shots > 0 ? ((hs / shots) * 100).toFixed(1) : '0',
            adr: avgAdr,
        },
    };
};

// ==========================================
// SCOUT : analyse publique d'un joueur (anti-cheat)
// ==========================================
// Résout le joueur, récupère rang/peak + les 10 dernières ranked ultra-détaillées.
// Gère proprement : 404 (introuvable), profil masqué Riot, IGN changé.
app.get('/api/scout/:name/:tag', scoutLimiter, async (req, res) => {
    try {
        const apiKeys = await getApiKeys();
        if (apiKeys.length === 0) return res.status(503).json({ error: 'Aucune clé API configurée.' });

        const name = req.params.name;
        const tag = req.params.tag;
        // Région : uniquement une valeur de la liste blanche (sinon on force 'eu')
        // pour empêcher toute manipulation du chemin de l'URL API.
        let region = ((req.query.region || 'eu') + '').toLowerCase();
        if (!REGION_VALUES.has(region)) region = 'eu';
        // Garde-fous sur les entrées (un pseudo Riot fait ≤16 char, un tag ≤5).
        if (!name || !tag || name.length > 32 || tag.length > 16) {
            return res.status(400).json({ error: 'invalid', message: 'Pseudo ou tag invalide.' });
        }
        const enc = (s) => encodeURIComponent((s || '').trim());

        // 1) Résolution du compte (puuid, level, card)
        const accRes = await fetchWithRetry(`${API_BASE}/v2/account/${enc(name)}/${enc(tag)}`, apiKeys, {}, 3);
        if (accRes.status === 404) return res.status(404).json({ error: 'notfound', message: `${name}#${tag} introuvable. Pseudo ou tag incorrect (ou IGN changé).` });
        if (!accRes.ok) return res.status(502).json({ error: 'api', message: `Erreur API (${accRes.status}).` });
        const accJson = await accRes.json();
        const account = accJson.data || {};
        const puuid = account.puuid;

        // 2) MMR : rang courant + peak
        let mmr = null;
        try {
            const mmrRes = await fetchWithRetry(`${API_BASE}/v3/mmr/${region}/pc/${enc(name)}/${enc(tag)}`, apiKeys, {}, 2);
            if (mmrRes.ok) {
                const d = (await mmrRes.json()).data;
                mmr = {
                    current: d?.current?.tier?.name || null,
                    rr: d?.current?.rr ?? null,
                    peak: d?.peak?.tier?.name || null,
                    peakSeason: d?.peak?.season?.short || null,
                    leaderboard: d?.current?.leaderboard_placement?.rank ?? null,
                };
            }
        } catch { /* rang optionnel */ }

        // 3) Les 10 dernières compétitives, ultra-détaillées
        const matchRes = await fetchWithRetry(`${API_BASE}/v4/matches/${region}/pc/${enc(name)}/${enc(tag)}?mode=competitive&size=10`, apiKeys, {}, 3);
        if (matchRes.status === 404 || matchRes.status === 403) {
            return res.json({
                account: { name: account.name || name, tag: account.tag || tag, level: account.account_level ?? null, card: account.card || null, region },
                mmr, matches: [], hidden: true,
                message: "L'historique de ce joueur est masqué (paramètre Riot 'Career Profile').",
            });
        }
        if (!matchRes.ok) return res.status(502).json({ error: 'api', message: `Erreur historique (${matchRes.status}).` });
        const matchesRaw = (await matchRes.json()).data || [];

        // Analyse détaillée de chaque match du point de vue du joueur cherché
        const matches = matchesRaw.map(m => {
            const me = (m.players || []).find(p => p.puuid === puuid);
            if (!me) return null;
            const rp = (m.rounds || []).length || 1;
            const st = me.stats || {};
            const dealt = typeof st.damage === 'object' ? (st.damage.dealt || 0) : (st.damage || 0);
            const received = typeof st.damage === 'object' ? (st.damage.received || 0) : 0;
            const shots = (st.headshots || 0) + (st.bodyshots || 0) + (st.legshots || 0);

            // Kills du joueur : HS% et arme par kill
            const myKills = (m.kills || []).filter(k => (k.killer?.puuid || k.killer_puuid) === puuid);
            const weaponCount = {};
            let fastestKillMs = null;
            myKills.forEach(k => {
                const w = k.weapon?.name || k.damage_weapon_name || 'Inconnu';
                weaponCount[w] = (weaponCount[w] || 0) + 1;
                const t = k.time_in_round_in_ms ?? k.kill_time_in_round;
                if (t != null && (fastestKillMs == null || t < fastestKillMs)) fastestKillMs = t;
            });
            const topWeapon = Object.entries(weaponCount).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

            // First bloods : 1er kill de chaque round attribué au joueur
            let firstBloods = 0, firstDeaths = 0;
            const roundFirst = {};
            (m.kills || []).forEach(k => {
                const r = k.round ?? k.round_number;
                const t = k.time_in_round_in_ms ?? k.kill_time_in_round ?? 9e9;
                if (roundFirst[r] == null || t < roundFirst[r].t) {
                    roundFirst[r] = { t, killer: k.killer?.puuid || k.killer_puuid, victim: k.victim?.puuid || k.victim_puuid };
                }
            });
            Object.values(roundFirst).forEach(fb => {
                if (fb.killer === puuid) firstBloods++;
                if (fb.victim === puuid) firstDeaths++;
            });

            const won = (() => {
                const myTeamId = me.team_id;
                const t = (m.teams || []).find(x => x.team_id === myTeamId);
                return t ? !!t.won : null;
            })();
            const teamScore = (m.teams || []).map(t => t.rounds?.won ?? 0).sort((a, b) => b - a);

            return {
                matchId: m.metadata?.match_id,
                map: m.metadata?.map?.name || '?',
                date: m.metadata?.started_at || null,
                agent: me.agent?.name || '?',
                agentId: me.agent?.id || null,
                won,
                score: teamScore.length === 2 ? `${teamScore[0]}-${teamScore[1]}` : null,
                rounds: rp,
                kills: st.kills || 0, deaths: st.deaths || 0, assists: st.assists || 0,
                kd: st.deaths ? +(st.kills / st.deaths).toFixed(2) : (st.kills || 0),
                kda: `${st.kills || 0}/${st.deaths || 0}/${st.assists || 0}`,
                acs: Math.round((st.score || 0) / rp),
                adr: Math.round(dealt / rp),
                adrReceived: Math.round(received / rp),
                hs: st.headshots || 0, body: st.bodyshots || 0, leg: st.legshots || 0,
                hsPct: shots ? +((st.headshots / shots) * 100).toFixed(1) : 0,
                firstBloods, firstDeaths,
                topWeapon, fastestKillMs,
                kastLike: null, // KAST vrai non dispo simplement ; on s'appuie sur FB/FD
                tier: me.tier?.name || null,
            };
        }).filter(Boolean);

        // Agrégats sur les 10 games (pour la détection de patterns anormaux)
        const agg = (() => {
            if (matches.length === 0) return null;
            const n = matches.length;
            const sum = (f) => matches.reduce((s, m) => s + f(m), 0);
            const avg = (f) => sum(f) / n;
            const hsVals = matches.map(m => m.hsPct);
            const avgHs = avg(m => m.hsPct);
            // Écart-type du HS% : très faible = suspicieusement régulier
            const variance = hsVals.reduce((s, v) => s + (v - avgHs) ** 2, 0) / n;
            return {
                games: n,
                wins: matches.filter(m => m.won).length,
                avgKd: +avg(m => m.kd).toFixed(2),
                avgAcs: Math.round(avg(m => m.acs)),
                avgAdr: Math.round(avg(m => m.adr)),
                avgHs: +avgHs.toFixed(1),
                hsStdev: +Math.sqrt(variance).toFixed(1),
                totalFirstBloods: sum(m => m.firstBloods),
                totalKills: sum(m => m.kills),
            };
        })();

        // 4) ANALYSE PROFONDE : jusqu'à 90 games résumées (stored-matches).
        // Échantillon bien plus grand → détection anti-cheat statistiquement fiable.
        let deep = null;
        try {
            const deepRes = await fetchWithRetry(`${API_BASE}/v1/stored-matches/${region}/${enc(name)}/${enc(tag)}?mode=competitive&size=90`, apiKeys, {}, 2);
            if (deepRes.ok) {
                const dm = (await deepRes.json()).data || [];
                const rows = dm.map(g => {
                    const st = g.stats || {};
                    const sh = st.shots || {};
                    const head = sh.head || 0, body = sh.body || 0, leg = sh.leg || 0;
                    const shots = head + body + leg;
                    const rounds = ((g.teams?.red || 0) + (g.teams?.blue || 0)) || 1;
                    const made = st.damage?.made || 0, received = st.damage?.received || 0;
                    const won = st.team && g.teams
                        ? (st.team.toLowerCase() === 'blue' ? g.teams.blue > g.teams.red : g.teams.red > g.teams.blue)
                        : null;
                    return {
                        date: g.meta?.started_at || null,
                        map: g.meta?.map?.name || '?',
                        agent: st.character?.name || '?',
                        kills: st.kills || 0, deaths: st.deaths || 0, assists: st.assists || 0,
                        kd: st.deaths ? +(st.kills / st.deaths).toFixed(2) : (st.kills || 0),
                        acs: Math.round((st.score || 0) / rounds),
                        adr: Math.round(made / rounds),
                        adrReceived: Math.round(received / rounds),
                        hsPct: shots ? +((head / shots) * 100).toFixed(1) : 0,
                        head, body, leg, won,
                    };
                });

                if (rows.length > 0) {
                    const n = rows.length;
                    const sum = (f) => rows.reduce((s, r) => s + f(r), 0);
                    const avg = (f) => sum(f) / n;
                    const avgHs = avg(r => r.hsPct);
                    const hsStdev = Math.sqrt(rows.reduce((s, r) => s + (r.hsPct - avgHs) ** 2, 0) / n);
                    // Distribution du HS% par paliers (pour un histogramme côté front)
                    const buckets = [0, 0, 0, 0, 0, 0]; // <15, 15-25, 25-35, 35-45, 45-55, 55+
                    rows.forEach(r => {
                        const h = r.hsPct;
                        const idx = h < 15 ? 0 : h < 25 ? 1 : h < 35 ? 2 : h < 45 ? 3 : h < 55 ? 4 : 5;
                        buckets[idx]++;
                    });
                    // Agent le plus joué
                    const agCount = {};
                    rows.forEach(r => { agCount[r.agent] = (agCount[r.agent] || 0) + 1; });
                    const topAgent = Object.entries(agCount).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

                    deep = {
                        games: n,
                        wins: rows.filter(r => r.won === true).length,
                        avgKd: +avg(r => r.kd).toFixed(2),
                        avgAcs: Math.round(avg(r => r.acs)),
                        avgAdr: Math.round(avg(r => r.adr)),
                        avgAdrReceived: Math.round(avg(r => r.adrReceived)),
                        avgHs: +avgHs.toFixed(1),
                        maxHs: Math.max(...rows.map(r => r.hsPct)),
                        hsStdev: +hsStdev.toFixed(1),
                        hsBuckets: buckets,
                        topAgent,
                        // Courbe HS% chronologique (ancien → récent) pour repérer une bascule nette
                        hsTrend: [...rows].reverse().map(r => r.hsPct),
                    };
                }
            }
        } catch { /* analyse profonde optionnelle */ }

        res.json({
            account: { name: account.name || name, tag: account.tag || tag, level: account.account_level ?? null, card: account.card || null, region },
            mmr, matches, agg, deep, hidden: false,
        });
    } catch (e) {
        console.error('❌ /api/scout:', e.message);
        res.status(500).json({ error: 'server', message: e.message });
    }
});

// GET carte de soirée (PNG direct — pratique pour <img> côté front).
app.get('/api/recap/session.png', imageLimiter, async (req, res) => {
    try {
        const data = await gatherSessionData();
        if (!data) return res.status(404).send('Aucune session à afficher');
        const png = await buildSessionCard(data);
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=120');
        res.send(png);
    } catch (e) {
        console.error('❌ recap/session:', e.message);
        res.status(500).send(e.message);
    }
});

// GET carte de profil joueur (PNG direct).
app.get('/api/recap/player/:id.png', imageLimiter, async (req, res) => {
    try {
        const data = await gatherPlayerCardData(req.params.id);
        if (!data) return res.status(404).send('Joueur introuvable ou sans games');
        const png = await buildPlayerCard(data);
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=300');
        res.send(png);
    } catch (e) {
        console.error('❌ recap/player:', e.message);
        res.status(500).send(e.message);
    }
});

// POST partage sur Discord (carte de soirée ou de joueur).
app.post('/api/recap/share', authenticateToken, async (req, res) => {
    try {
        const { type, playerId } = req.body || {};
        const channelId = await getConfig('discord_channel_id');
        if (!channelId || !discordClient.isReady()) return res.status(503).json({ error: 'Bot Discord indisponible' });

        let png, title;
        if (type === 'session') {
            const data = await gatherSessionData();
            if (!data) return res.status(404).json({ error: 'Aucune session à partager' });
            png = await buildSessionCard(data);
            title = `📅 Récap de la soirée — ${data.collective.rr >= 0 ? '+' : ''}${data.collective.rr} RR`;
        } else if (type === 'player' && playerId) {
            const data = await gatherPlayerCardData(playerId);
            if (!data) return res.status(404).json({ error: 'Joueur introuvable' });
            png = await buildPlayerCard(data);
            title = `🎯 Carte de ${data.name}`;
        } else {
            return res.status(400).json({ error: 'Type invalide' });
        }

        const attachment = new AttachmentBuilder(png, { name: 'ksl-recap.png' });
        await sendDiscordMessage(channelId, { content: title, files: [attachment] });
        res.json({ ok: true });
    } catch (e) {
        console.error('❌ recap/share:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// ==========================================
// ROUTES : AUTHENTIFICATION & CONFIG (ADMIN)
// ==========================================

app.post('/api/auth/login', async (req, res) => {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const rl = checkLoginRateLimit(ip);
    if (!rl.allowed) {
        return res.status(429).json({ error: `Trop de tentatives. Réessaie dans ${rl.retryAfter}s.` });
    }

    const { username, password } = req.body;
    if (typeof username !== 'string' || typeof password !== 'string') {
        return res.status(400).json({ error: "Identifiants incorrects" });
    }
    const user = await db.get("SELECT * FROM users WHERE username = ?", [username]);

    if (!user) return res.status(400).json({ error: "Identifiants incorrects" });

    const validPass = await bcrypt.compare(password, user.password_hash);
    if (!validPass) return res.status(400).json({ error: "Identifiants incorrects" });

    resetLoginAttempts(ip);

    const secret = await getConfig('jwt_secret');
    const token = jwt.sign({ id: user.id, username: user.username }, secret, { expiresIn: '24h' });

    res.json({ 
        token, 
        needsPasswordChange: user.needs_password_change === 1 
    });
});

app.post('/api/auth/change-password', authenticateToken, async (req, res) => {
    const { newPassword } = req.body;
    if (typeof newPassword !== 'string' || newPassword.length < 10) {
        return res.status(400).json({ error: "Le mot de passe doit faire au moins 10 caractères" });
    }
    if (newPassword.length > 128) {
        return res.status(400).json({ error: "Mot de passe trop long (max 128)" });
    }
    const hash = await bcrypt.hash(newPassword, 10);
    await db.run("UPDATE users SET password_hash = ?, needs_password_change = 0 WHERE id = ?", [hash, req.user.id]);
    res.json({ message: "Mot de passe mis à jour avec succès" });
});

app.get('/api/public/config', async (req, res) => {
    try {
        const now = Date.now();
        if (publicConfigCache.data && publicConfigCache.expiry > now) {
            return res.json(publicConfigCache.data);
        }
        const rawPlayers = await getPlayers();
        // On parse le snapshot MMR en objet propre et on retire le blob brut.
        const players = rawPlayers.map(p => {
            let mmr = null;
            try { mmr = p.live_mmr ? JSON.parse(p.live_mmr) : null; } catch { mmr = null; }
            const rest = { ...p };
            delete rest.live_mmr; // on ne renvoie pas le blob brut, seulement l'objet parsé
            return { ...rest, mmr };
        });
        const appUrl = await getConfig('app_url', 'http://localhost:5173');
        const challengeStartDate = await getConfig('challenge_start_date', '2024-01-01T00:00');
        const payload = { players, appUrl, challengeStartDate };
        publicConfigCache = { data: payload, expiry: now + PUBLIC_CONFIG_TTL_MS };
        res.json(payload);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/admin/config', authenticateToken, async (req, res) => {
    const discord_bot_token_raw = await getConfig('discord_bot_token');
    // Masquage : on ne renvoie jamais le token complet, juste un indicateur "configuré"
    // + les 4 derniers caractères pour debug. Le client envoie une valeur vide pour ne pas changer le token.
    const discord_bot_token = discord_bot_token_raw
        ? `••••••••${discord_bot_token_raw.slice(-4)}`
        : '';
    const discord_bot_token_set = !!discord_bot_token_raw;
    const discord_channel_id = await getConfig('discord_channel_id');
    const app_url = await getConfig('app_url');
    const challenge_start_date = await getConfig('challenge_start_date');
    res.json({ discord_bot_token, discord_bot_token_set, discord_channel_id, app_url, challenge_start_date });
});

app.post('/api/admin/config', authenticateToken, async (req, res) => {
    const { discord_bot_token, discord_channel_id, app_url, challenge_start_date } = req.body;
    // Si le client renvoie le placeholder masqué ou vide → on ne touche pas au token existant
    if (discord_bot_token !== undefined && discord_bot_token !== '' && !discord_bot_token.startsWith('••')) {
        if (typeof discord_bot_token !== 'string' || discord_bot_token.length > 200) {
            return res.status(400).json({ error: "Token Discord invalide" });
        }
        await db.run("UPDATE config SET value = ? WHERE key = 'discord_bot_token'", [discord_bot_token]);
    }
    if (discord_channel_id !== undefined) {
        if (discord_channel_id !== '' && !/^\d{15,25}$/.test(String(discord_channel_id))) {
            return res.status(400).json({ error: "Channel ID Discord invalide (15-25 chiffres)" });
        }
        await db.run("UPDATE config SET value = ? WHERE key = 'discord_channel_id'", [discord_channel_id]);
    }
    if (app_url !== undefined) {
        if (app_url !== '' && !/^https?:\/\/[^\s]+$/.test(String(app_url))) {
            return res.status(400).json({ error: "App URL invalide (doit commencer par http(s)://)" });
        }
        await db.run("UPDATE config SET value = ? WHERE key = 'app_url'", [app_url]);
    }
    if (challenge_start_date !== undefined) {
        if (challenge_start_date !== '' && isNaN(new Date(challenge_start_date).getTime())) {
            return res.status(400).json({ error: "Date de challenge invalide" });
        }
        await db.run("UPDATE config SET value = ? WHERE key = 'challenge_start_date'", [challenge_start_date]);
    }
    invalidatePublicConfigCache();
    invalidateDiscordCache();
    await refreshAllowedOrigins();
    res.json({ message: "Configuration sauvegardée (Redémarrez le serveur si vous avez changé le Token du Bot)" });
});

app.get('/api/admin/players', authenticateToken, async (req, res) => {
    const players = await getPlayers();
    res.json(players);
});

app.post('/api/admin/players', authenticateToken, async (req, res) => {
    const { name, tag, region, color, discord_id } = req.body;
    const err = validatePlayerInput({ name, tag, region, color, discord_id });
    if (err) return res.status(400).json({ error: err });
    const countRow = await db.get("SELECT COUNT(*) as count FROM players");
    const id = `p${countRow.count + 1}_${Date.now()}`;
    await db.run("INSERT INTO players (id, name, tag, region, color, discord_id) VALUES (?, ?, ?, ?, ?, ?)",
        [id, name.trim(), tag.trim(), (region || 'eu').toLowerCase(), color || '#ffffff', discord_id || '']);
    invalidatePublicConfigCache();
    invalidateDiscordCache();
    res.json({ message: "Joueur ajouté", id });
});

app.put('/api/admin/players/:id', authenticateToken, async (req, res) => {
    const { name, tag, color, discord_id, crosshair_code } = req.body;
    const err = validatePlayerInput({ name, tag, color, discord_id });
    if (err) return res.status(400).json({ error: err });
    if (crosshair_code !== undefined && typeof crosshair_code === 'string' && crosshair_code.length > 500) {
        return res.status(400).json({ error: "Code de viseur trop long" });
    }
    try {
        await db.run(
            "UPDATE players SET name = ?, tag = ?, color = ?, discord_id = ?, crosshair_code = ? WHERE id = ?",
            [name.trim(), tag.trim(), color, discord_id || '', (crosshair_code || '').trim(), req.params.id]
        );
        invalidatePublicConfigCache();
        invalidateDiscordCache();
        res.json({ message: "Joueur mis à jour avec succès" });
    } catch (e) {
        res.status(500).json({ error: "Erreur lors de la mise à jour" });
    }
});

app.delete('/api/admin/players/:id', authenticateToken, async (req, res) => {
    const purge = req.query.purge === 'true' || req.query.purge === '1';
    let purgedMatches = 0;
    if (purge) {
        const r = await db.run("DELETE FROM matches WHERE player_id = ?", [req.params.id]);
        purgedMatches = r.changes || 0;
    }
    await db.run("DELETE FROM players WHERE id = ?", [req.params.id]);
    invalidatePublicConfigCache();
    invalidateDiscordCache();
    res.json({
        message: purge
            ? `Joueur supprimé + ${purgedMatches} match(s) purgé(s)`
            : "Joueur supprimé (données conservées)",
        purgedMatches
    });
});

// ==========================================
// GESTION DES DONNÉES (Data Management)
// ==========================================

// Vue d'ensemble : compteurs globaux, répartition par type, par joueur, par agent, données orphelines.
app.get('/api/admin/data/overview', authenticateToken, async (req, res) => {
    try {
        const players = await getPlayers();
        const playerIds = new Set(players.map(p => p.id));

        const totalRow = await db.get("SELECT COUNT(*) AS c, MIN(date) AS minD, MAX(date) AS maxD FROM matches");

        const byType = await db.all(
            "SELECT COALESCE(type, 'inconnu') AS type, COUNT(*) AS count FROM matches GROUP BY type ORDER BY count DESC"
        );

        // Par joueur tracké : nombre de matchs + dernière activité
        const byPlayerRows = await db.all(
            "SELECT player_id, COUNT(*) AS count, MAX(date) AS lastDate FROM matches GROUP BY player_id"
        );
        const byPlayer = byPlayerRows.map(r => {
            const cfg = players.find(p => p.id === r.player_id);
            return {
                playerId: r.player_id,
                name: cfg ? cfg.name : null,
                tag: cfg ? cfg.tag : null,
                color: cfg ? cfg.color : null,
                count: r.count,
                lastDate: r.lastDate,
                orphan: !playerIds.has(r.player_id)
            };
        }).sort((a, b) => b.count - a.count);

        // Par agent (sur la perspective du joueur tracké, colonne indexée)
        const byAgent = await db.all(
            "SELECT COALESCE(NULLIF(agent, ''), 'Inconnu') AS agent, COUNT(*) AS count, " +
            "SUM(CASE WHEN result='WIN' THEN 1 ELSE 0 END) AS wins, " +
            "AVG(acs) AS avgAcs FROM matches GROUP BY agent ORDER BY count DESC"
        );

        // Par map
        const byMap = await db.all(
            "SELECT COALESCE(NULLIF(map, ''), 'Inconnue') AS map, COUNT(*) AS count, " +
            "SUM(CASE WHEN result='WIN' THEN 1 ELSE 0 END) AS wins FROM matches GROUP BY map ORDER BY count DESC"
        );

        const orphanCount = byPlayer.filter(p => p.orphan).reduce((acc, p) => acc + p.count, 0);

        res.json({
            total: totalRow.c || 0,
            dateRange: { min: totalRow.minD, max: totalRow.maxD },
            byType,
            byPlayer,
            byAgent: byAgent.map(a => ({
                agent: a.agent, count: a.count, wins: a.wins || 0,
                avgAcs: Math.round(a.avgAcs || 0)
            })),
            byMap: byMap.map(m => ({ map: m.map, count: m.count, wins: m.wins || 0 })),
            orphanCount,
            players: players.map(p => ({ id: p.id, name: p.name, tag: p.tag, color: p.color }))
        });
    } catch (e) {
        console.error("❌ data/overview:", e.message);
        res.status(500).json({ error: e.message });
    }
});

// Suppression ciblée de matchs selon des filtres combinables.
// Body: { type, agent, map, result, playerId, before (ms), after (ms), dryRun }
app.post('/api/admin/data/delete-matches', authenticateToken, async (req, res) => {
    try {
        const { type, agent, map, result, playerId, before, after, dryRun } = req.body || {};

        const where = [];
        const params = [];
        if (type)     { where.push("type = ?");            params.push(type); }
        if (agent)    { where.push("LOWER(agent) = ?");    params.push(String(agent).toLowerCase()); }
        if (map)      { where.push("LOWER(map) = ?");      params.push(String(map).toLowerCase()); }
        if (result)   { where.push("result = ?");          params.push(result); }
        if (playerId) { where.push("player_id = ?");       params.push(playerId); }
        if (before)   { where.push("date < ?");            params.push(Number(before)); }
        if (after)    { where.push("date > ?");            params.push(Number(after)); }

        // Sécurité : on refuse une suppression sans aucun filtre (utiliser /purge-all pour ça).
        if (where.length === 0) {
            return res.status(400).json({ error: "Au moins un filtre est requis pour une suppression ciblée." });
        }

        const whereClause = "WHERE " + where.join(" AND ");
        const countRow = await db.get(`SELECT COUNT(*) AS c FROM matches ${whereClause}`, params);
        const affected = countRow.c || 0;

        if (dryRun) {
            return res.json({ dryRun: true, affected });
        }

        const r = await db.run(`DELETE FROM matches ${whereClause}`, params);
        invalidatePublicConfigCache();
        res.json({ deleted: r.changes || 0 });
    } catch (e) {
        console.error("❌ data/delete-matches:", e.message);
        res.status(500).json({ error: e.message });
    }
});

// Suppression des données orphelines (matchs dont le player_id n'est plus un joueur configuré).
app.post('/api/admin/data/purge-orphans', authenticateToken, async (req, res) => {
    try {
        const players = await getPlayers();
        const ids = players.map(p => p.id);
        let deleted = 0;
        if (ids.length === 0) {
            const r = await db.run("DELETE FROM matches");
            deleted = r.changes || 0;
        } else {
            const placeholders = ids.map(() => '?').join(',');
            const r = await db.run(`DELETE FROM matches WHERE player_id NOT IN (${placeholders})`, ids);
            deleted = r.changes || 0;
        }
        invalidatePublicConfigCache();
        res.json({ deleted });
    } catch (e) {
        console.error("❌ data/purge-orphans:", e.message);
        res.status(500).json({ error: e.message });
    }
});

// Reset complet de l'historique des matchs (joueurs/clés/config conservés). Garde-fou par mot-clé.
app.post('/api/admin/data/purge-all', authenticateToken, async (req, res) => {
    try {
        if (req.body?.confirm !== 'SUPPRIMER TOUT') {
            return res.status(400).json({ error: "Confirmation invalide. Tapez exactement : SUPPRIMER TOUT" });
        }
        const r = await db.run("DELETE FROM matches");
        invalidatePublicConfigCache();
        res.json({ deleted: r.changes || 0 });
    } catch (e) {
        console.error("❌ data/purge-all:", e.message);
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/admin/keys', authenticateToken, async (req, res) => {
    const keys = await db.all("SELECT id, key FROM api_keys");
    res.json(keys);
});

app.post('/api/admin/keys', authenticateToken, async (req, res) => {
    const { key } = req.body;
    // Format HenrikDev : "HDEV-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" ou simplement une chaîne raisonnable
    if (typeof key !== 'string' || key.trim().length < 8 || key.length > 200) {
        return res.status(400).json({ error: "Clé API invalide (8 à 200 caractères)" });
    }
    try {
        await db.run("INSERT INTO api_keys (key) VALUES (?)", [key.trim()]);
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
    if (typeof name !== 'string' || name.trim().length < 1 || name.length > 64) {
        return res.status(400).json({ error: "Nom de tournoi invalide (1 à 64 caractères)" });
    }
    if (!Array.isArray(players) || players.length < 2 || players.length > 64) {
        return res.status(400).json({ error: "Liste de joueurs invalide (2 à 64 participants)" });
    }
    const id = `tourney_${Date.now()}`;

    // Fisher-Yates : shuffle uniforme (vs sort(() => 0.5 - Math.random()) qui est biaisé)
    const fisherYates = (arr) => {
        const a = [...arr];
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    };
    const shuffled = fisherYates(players);
    const nextPowerOf2 = Math.pow(2, Math.ceil(Math.log2(shuffled.length)));
    const numByes = nextPowerOf2 - shuffled.length;
    
    const rounds = [];
    const round1 = [];
    let playerIdx = 0;
    
    for(let i=0; i<numByes; i++) {
        round1.push({ player1: shuffled[playerIdx], player2: 'BYE', winner: shuffled[playerIdx], score: '' });
        playerIdx++;
    }
    while(playerIdx < shuffled.length) {
        round1.push({ player1: shuffled[playerIdx], player2: shuffled[playerIdx+1], winner: null, score: '' });
        playerIdx += 2;
    }
    
    const round1Shuffled = fisherYates(round1);
    rounds.push(round1Shuffled);

    let currentMatches = round1.length;
    while (currentMatches > 1) {
        currentMatches /= 2;
        const nextRound = [];
        for (let i = 0; i < currentMatches; i++) {
            nextRound.push({ player1: null, player2: null, winner: null, score: '' });
        }
        rounds.push(nextRound);
    }

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

app.put('/api/admin/tournaments/:id/match', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { roundIndex, matchIndex, winner, score } = req.body;

    const row = await db.get("SELECT * FROM tournaments WHERE id = ?", [id]);
    if (!row) return res.status(404).json({ error: "Tournoi non trouvé" });

    const bracket = JSON.parse(row.bracket);
    const match = bracket[roundIndex][matchIndex];

    match.winner = winner || null;
    match.score = score || '';

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
// BACKFILL DES NOMS (correspondance PUUID -> pseudo)
// Utilisé automatiquement après chaque sync pour résoudre les pseudos
// que la matchlist ne renvoie pas systématiquement (la doc HenrikDev V4
// ne garantit pas non plus name/tag). Une route admin permet aussi le
// rattrapage massif sur tout l'historique via /v4/match/{region}/{id}.
// ==========================================

const isMissingPseudo = (p) => !p.name?.trim() || p.name === p.character;

const resolveMatchRegion = async (group) => {
    // V4 single-match exige une région. On la déduit du joueur tracké lié au match.
    for (const row of group) {
        const playerId = row.data?.playerId;
        if (!playerId) continue;
        const p = await db.get("SELECT region FROM players WHERE id = ?", [playerId]);
        if (p?.region) return p.region.toLowerCase();
    }
    return 'eu';
};

const backfillNamesForMatches = async (matchIds, apiKeys) => {
    const result = { fetched: 0, updated: 0, skipped: 0, errors: [] };
    if (!apiKeys?.length || !matchIds?.length) return result;

    for (const matchId of matchIds) {
        const rows = await db.all("SELECT id, data FROM matches WHERE id LIKE ?", [`${matchId}_%`]);
        if (!rows.length) { result.skipped++; continue; }

        const group = rows.map(r => {
            try { return { rowId: r.id, data: JSON.parse(r.data) }; }
            catch { return null; }
        }).filter(Boolean);

        const needs = group.some(r => (r.data.allPlayers || []).some(isMissingPseudo));
        if (!needs) { result.skipped++; continue; }

        try {
            const region = await resolveMatchRegion(group);
            const resp = await fetchWithRetry(`${API_BASE}/v4/match/${region}/${matchId}`, apiKeys, {}, 3);
            if (!resp.ok) {
                result.errors.push(`${matchId}: HTTP ${resp.status}`);
                continue;
            }
            const json = await resp.json();
            const m = json?.data ? normalizeV4Match(json.data) : null;
            if (!m) continue;
            result.fetched++;

            // Construit la table de correspondance PUUID -> "name#tag"
            const nameMap = {};
            (m.players?.all_players || []).forEach(p => {
                if (p.puuid && p.name && p.name.trim() !== '') {
                    nameMap[p.puuid] = `${p.name}#${p.tag}`;
                }
            });
            (m.kills || m.kill_events || []).forEach(k => {
                if (k.killer_puuid && k.killer_display_name && !nameMap[k.killer_puuid]) nameMap[k.killer_puuid] = k.killer_display_name;
                if (k.victim_puuid && k.victim_display_name && !nameMap[k.victim_puuid]) nameMap[k.victim_puuid] = k.victim_display_name;
            });

            for (const row of group) {
                let changed = false;
                const updatedPlayers = (row.data.allPlayers || []).map(p => {
                    if (isMissingPseudo(p) && p.puuid && nameMap[p.puuid]) {
                        const parts = nameMap[p.puuid].split('#');
                        changed = true;
                        return { ...p, name: parts[0] || p.name, tag: parts[1] || p.tag };
                    }
                    return p;
                });
                if (changed) {
                    row.data.allPlayers = updatedPlayers;
                    await db.run("UPDATE matches SET data = ? WHERE id = ?", [JSON.stringify(row.data), row.rowId]);
                    result.updated++;
                }
            }

            await delay(250);
        } catch (e) {
            result.errors.push(`${matchId}: ${e.message}`);
        }
    }

    return result;
};

// Backfill ADR : recalcule l'ADR (et damage received) depuis les données déjà
// stockées dans allPlayers — AUCUN appel API requis (le bug affectait la valeur
// dérivée, pas la donnée brute). Corrige tout l'historique instantanément.
app.post('/api/admin/backfill-adr', authenticateToken, async (req, res) => {
    try {
        const players = await getPlayers();
        const puuidById = {};
        players.forEach(p => { if (p.puuid) puuidById[p.id] = p.puuid.toLowerCase(); });

        const rows = await db.all("SELECT id, player_id, data FROM matches WHERE type = 'ranked'");
        let updated = 0, skipped = 0;
        await db.exec('BEGIN TRANSACTION');
        for (const row of rows) {
            let m; try { m = JSON.parse(row.data); } catch { continue; }
            const rp = m.roundsPlayed || 0;
            const myPuuid = puuidById[row.player_id];
            const me = myPuuid && (m.allPlayers || []).find(p => p.puuid?.toLowerCase() === myPuuid);
            const dmg = me?.stats?.damage;
            if (!rp || !dmg || typeof dmg !== 'object') { skipped++; continue; }

            const newAdr = Math.round((dmg.dealt || 0) / rp);
            const newDmgReceived = Math.round((dmg.received || 0) / rp);
            if (m.adr === newAdr && m.adrReceived === newDmgReceived) { skipped++; continue; }

            m.adr = newAdr;
            m.adrReceived = newDmgReceived; // nouveau : ADR subi (mesure de survie)
            await db.run("UPDATE matches SET data = ? WHERE id = ?", [JSON.stringify(m), row.id]);
            updated++;
        }
        await db.exec('COMMIT');
        invalidatePublicConfigCache();
        console.log(`✅ Backfill ADR : ${updated} matchs corrigés, ${skipped} ignorés.`);
        res.json({ updated, skipped, total: rows.length });
    } catch (e) {
        try { await db.exec('ROLLBACK'); } catch { /* noop */ }
        console.error("❌ backfill-adr:", e.message);
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/admin/backfill-names', authenticateToken, async (req, res) => {
    try {
        const apiKeys = await getApiKeys();
        if (apiKeys.length === 0) return res.status(500).json({ error: 'Aucune clé API configurée.' });

        const allRows = await db.all("SELECT id, data FROM matches");
        const matchIds = new Set();
        for (const row of allRows) {
            try {
                const data = JSON.parse(row.data);
                if (data.id && (data.allPlayers || []).some(isMissingPseudo)) {
                    matchIds.add(data.id);
                }
            } catch (e) { void e; }
        }

        const ids = [...matchIds];
        const result = await backfillNamesForMatches(ids, apiKeys);
        if (result.updated > 0) markDataChanged();
        console.log(`✅ Backfill admin : ${result.fetched} matchs re-fetchés, ${result.updated} enregistrements mis à jour, ${result.skipped} ignorés.`);
        res.json({ ...result, total: ids.length, errors: result.errors.slice(0, 20) });
    } catch (e) {
        console.error('❌ Backfill error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// ==========================================
// ADAPTATEUR V4 -> V3 (HenrikDev API)
// ==========================================
// La V4 a refondu la structure de réponse. Plutôt que de réécrire tout le
// parsing en aval, on remappe la réponse V4 vers la forme V3 que le reste
// du code attend déjà. Toute migration vers le shape natif V4 pourra se
// faire plus tard sans urgence.

const PLATFORM = 'pc';

// Mapping queue.id (Riot canonical) -> mode string V3, pour que les filtres existants matchent.
// Si queue.id est inconnu, on retombe sur queue.name puis queue.mode_type.
const QUEUE_ID_TO_V3_MODE = {
    competitive: 'Competitive',
    unrated: 'Unrated',
    deathmatch: 'Deathmatch',
    hurm: 'Team Deathmatch',
    teamdeathmatch: 'Team Deathmatch',
    spikerush: 'Spike Rush',
    swiftplay: 'Swiftplay',
    ggteam: 'Escalation',
    newmap: 'New Map',
    custom: 'Custom Game',
    snowball: 'Snowball Fight',
    onefa: 'Replication',
    premier: 'Premier'
};

const constructAgentImg = (agentId) =>
    agentId ? `https://media.valorant-api.com/agents/${agentId}/displayicon.png` : null;

const teamCase = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : t);

const normalizeV4Player = (p) => {
    if (!p) return p;
    return {
        ...p,
        character: p.agent?.name || null,
        team: teamCase(p.team_id || ''),
        currenttier: p.tier?.id ?? 0,
        currenttier_patched: p.tier?.name || '',
        level: p.account_level ?? 0,
        player_card: p.customization?.card || '',
        player_title: p.customization?.title || '',
        session_playtime: { milliseconds: p.session_playtime_in_ms || 0 },
        // v4 : stats.damage est un objet {dealt, received}. On extrait les nombres
        // (bug historique : l'objet entier était affecté → ADR = NaN partout).
        damage_made: (typeof p.stats?.damage === 'object' ? p.stats?.damage?.dealt : p.stats?.damage) || 0,
        damage_received: (typeof p.stats?.damage === 'object' ? p.stats?.damage?.received : 0) || 0,
        assets: { agent: { small: constructAgentImg(p.agent?.id) }, card: {} }
    };
};

const normalizeV4Kill = (k) => {
    const killerName = k.killer?.name || '';
    const killerTag = k.killer?.tag || '';
    const victimName = k.victim?.name || '';
    const victimTag = k.victim?.tag || '';
    return {
        ...k,
        killer_puuid: k.killer?.puuid || null,
        killer_display_name: killerName ? `${killerName}#${killerTag}` : '',
        killer_team: teamCase(k.killer?.team),
        victim_puuid: k.victim?.puuid || null,
        victim_display_name: victimName ? `${victimName}#${victimTag}` : '',
        victim_team: teamCase(k.victim?.team),
        damage_weapon_id: k.weapon?.id || null,
        damage_weapon_name: k.weapon?.name || null,
        kill_time_in_round: k.time_in_round_in_ms || 0,
        kill_time_in_match: k.time_in_match_in_ms || 0,
        victim_death_location: k.location || null,
        player_locations_on_kill: k.player_locations || []
    };
};

const playerRefToV3 = (p) => p ? {
    puuid: p.puuid || null,
    display_name: p.name ? `${p.name}#${p.tag || ''}` : '',
    team: teamCase(p.team)
} : null;

const normalizeV4Round = (r) => {
    const player_stats = (r.stats || []).map(ps => ({
        ...ps,
        player_puuid: ps.player?.puuid || null,
        player_team: teamCase(ps.player?.team),
        player_display_name: ps.player?.name ? `${ps.player.name}#${ps.player.tag || ''}` : '',
        score: ps.stats?.score || 0,
        kills: ps.stats?.kills || 0,
        damage: ps.stats?.damage || 0,
        bodyshots: ps.stats?.bodyshots || 0,
        headshots: ps.stats?.headshots || 0,
        legshots: ps.stats?.legshots || 0,
        was_penalized: ps.received_penalty || false
    }));
    const plant_events = r.plant ? {
        plant_location: r.plant.location || null,
        plant_site: r.plant.site || null,
        plant_time_in_round: r.plant.round_time_in_ms || 0,
        planted_by: playerRefToV3(r.plant.player),
        player_locations_on_plant: r.plant.player_locations || []
    } : { planted_by: null, plant_site: null, plant_location: null, plant_time_in_round: null, player_locations_on_plant: [] };
    const defuse_events = r.defuse ? {
        defuse_location: r.defuse.location || null,
        defuse_time_in_round: r.defuse.round_time_in_ms || 0,
        defused_by: playerRefToV3(r.defuse.player),
        player_locations_on_defuse: r.defuse.player_locations || []
    } : { defused_by: null, defuse_location: null, defuse_time_in_round: null, player_locations_on_defuse: [] };
    return {
        ...r,
        winning_team: teamCase(r.winning_team),
        bomb_planted: !!r.plant,
        bomb_defused: !!r.defuse,
        end_type: r.result || '',
        plant_events,
        defuse_events,
        player_stats
    };
};

const normalizeV4Teams = (teamsArr) => {
    const out = {};
    (teamsArr || []).forEach(t => {
        const key = (t.team_id || '').toLowerCase();
        if (!key) return;
        out[key] = {
            has_won: !!t.won,
            rounds_won: t.rounds?.won || 0,
            rounds_lost: t.rounds?.lost || 0
        };
    });
    return out;
};

const normalizeV4Match = (m) => {
    if (!m || !m.metadata) return m;
    const md = m.metadata;
    const queueId = (md.queue?.id || '').toLowerCase();
    const mappedMode = QUEUE_ID_TO_V3_MODE[queueId];
    const mode = mappedMode || md.queue?.name || md.queue?.mode_type || '';
    const startedAtMs = md.started_at ? new Date(md.started_at).getTime() : 0;
    const allPlayers = (m.players || []).map(normalizeV4Player);
    const rounds = (m.rounds || []).map(normalizeV4Round);
    const kills = (m.kills || []).map(normalizeV4Kill);
    const teams = normalizeV4Teams(m.teams);
    return {
        ...m,
        metadata: {
            ...md,
            matchid: md.match_id,
            map: md.map?.name || md.map || '',
            mode,
            mode_id: md.queue?.id || '',
            queue_id: queueId,
            game_start: startedAtMs ? Math.floor(startedAtMs / 1000) : 0,
            game_start_patched: md.started_at || '',
            game_length: md.game_length_in_ms ? Math.floor(md.game_length_in_ms / 1000) : 0,
            season_id: md.season?.id || '',
            rounds_played: rounds.length,
            region: md.region || ''
        },
        players: { all_players: allPlayers },
        rounds,
        kills,
        teams
    };
};

const normalizeV4MatchList = (json) => {
    if (!json || !Array.isArray(json.data)) return json;
    return { ...json, data: json.data.map(normalizeV4Match) };
};

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
    const FETCH_SIZE = 20;
    const encodedName = encodeURIComponent(player.name.trim());
    const encodedTag = encodeURIComponent(player.tag.trim());
    const region = (player.region || 'eu').toLowerCase();
    const cacheBuster = `&_t=${Date.now()}`;
    let newMatches = [];

    // Résolution PUUID : les nouveaux matchs Riot n'exposent plus name/tag dans all_players
    // Si déjà persisté en DB (via ensurePuuids), on évite l'appel réseau.
    let playerPuuid = player.puuid || null;
    if (!playerPuuid) {
        try {
            const accountRes = await fetchWithRetry(`${API_BASE}/v1/account/${encodedName}/${encodedTag}`, apiKeys, { headers });
            if (accountRes.ok) {
                const accountData = await accountRes.json().catch(() => null);
                playerPuuid = accountData?.data?.puuid || null;
                if (playerPuuid) {
                    player.puuid = playerPuuid;
                    await db.run("UPDATE players SET puuid = ? WHERE id = ?", [playerPuuid, player.id]).catch(() => {});
                }
            }
        } catch { /* PUUID optionnel, fallback name/tag */ }
    }
    console.log(`   PUUID: ${playerPuuid ? playerPuuid.substring(0, 8) + '...' : 'non résolu (fallback name/tag)'}`);

    const findPlayer = (allPlayers) => {
        if (!allPlayers) return null;
        if (playerPuuid) return allPlayers.find(p => p.puuid === playerPuuid) || null;
        return allPlayers.find(p =>
            p.name?.toLowerCase() === player.name.toLowerCase() &&
            p.tag?.toLowerCase() === player.tag.toLowerCase()
        ) || null;
    };

    // Fonction de sauvetage des pseudos : fouille dans les kill events ou utilise le nom de l'agent.
    const enrichPlayersList = (allPlayersRaw, killEvents, allConfigPlayers) => {
        const displayNameMap = {};
        (killEvents || []).forEach(k => {
            if (k.killer_puuid && k.killer_display_name) displayNameMap[k.killer_puuid] = k.killer_display_name;
            if (k.victim_puuid && k.victim_display_name) displayNameMap[k.victim_puuid] = k.victim_display_name;
        });
        return (allPlayersRaw || []).map(p => {
            const c = findCfgByPuuid(allConfigPlayers, p.puuid);
            let name = c ? c.name : p.name;
            let tag = c ? c.tag : p.tag;
            if (!name?.trim() && p.puuid && displayNameMap[p.puuid]) {
                const parts = displayNameMap[p.puuid].split('#');
                name = parts[0] || name;
                tag = parts[1] || tag;
            }
            if (!name?.trim()) { name = p.character || 'Inconnu'; tag = ''; }
            return { ...p, name, tag };
        });
    };

    // DM
    try {
      const url = `${API_BASE}/v4/matches/${region}/${PLATFORM}/${encodedName}/${encodedTag}?size=${FETCH_SIZE}${cacheBuster}`;
      const dmResponse = await fetchWithRetry(url, apiKeys, { headers });
      const dmData = normalizeV4MatchList(dmResponse.ok ? await dmResponse.json().catch(() => ({ data: [] })) : { data: [] });
      const cleanDmMatches = (dmData.data || []).filter(m => m.metadata?.mode === 'Deathmatch').map(m => {
        const playerStats = findPlayer(m.players?.all_players);
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
          allPlayers: enrichPlayersList(m.players?.all_players, m.kills || m.kill_events, allConfigPlayers),
          date: m.metadata.game_start_patched, timestamp: m.metadata.game_start, map: m.metadata.map
        };
      }).filter(Boolean);
      newMatches = [...newMatches, ...cleanDmMatches];
    } catch (e) {}

    await delay(500);

    // TDM
    try {
      const url = `${API_BASE}/v4/matches/${region}/${PLATFORM}/${encodedName}/${encodedTag}?size=${FETCH_SIZE}${cacheBuster}`;
      const tdmResponse = await fetchWithRetry(url, apiKeys, { headers });
      const tdmData = normalizeV4MatchList(tdmResponse.ok ? await tdmResponse.json().catch(() => ({ data: [] })) : { data: [] });
      const cleanTdmMatches = (tdmData.data || []).filter(m => m.metadata?.mode === 'Team Deathmatch').map(m => {
        const playerStats = findPlayer(m.players?.all_players);
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
          map: m.metadata.map, date: m.metadata.game_start_patched, timestamp: m.metadata.game_start, myTeam: playerStats.team,
          allPlayers: enrichPlayersList(m.players?.all_players, m.kills || m.kill_events, allConfigPlayers)
        };
      }).filter(Boolean);
      newMatches = [...newMatches, ...cleanTdmMatches];
    } catch (e) {}

    await delay(500);

    // SKIRMISH
    try {
      const url = `${API_BASE}/v4/matches/${region}/${PLATFORM}/${encodedName}/${encodedTag}?size=${FETCH_SIZE}${cacheBuster}`;
      const skirmishResponse = await fetchWithRetry(url, apiKeys, { headers });
      const skirmishData = normalizeV4MatchList(skirmishResponse.ok ? await skirmishResponse.json().catch(() => ({ data: [] })) : { data: [] });
      
      const cleanSkirmishMatches = (skirmishData.data || [])
        .filter(m => m.metadata && m.metadata.mode && m.metadata.mode === 'Custom Game') 
        .map(m => {
          const playerStats = findPlayer(m.players?.all_players);
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
            map: m.metadata.map, date: m.metadata.game_start_patched, timestamp: m.metadata.game_start, myTeam: playerStats.team,
            allPlayers: enrichPlayersList(m.players?.all_players, m.kills || m.kill_events, allConfigPlayers)
          };
      }).filter(Boolean);
      newMatches = [...newMatches, ...cleanSkirmishMatches];
    } catch (e) {
      console.error(`❌ Erreur Fetch Skirmish pour ${player.name}:`, e.message);
    }

    await delay(500);

    // RANKED
    try {
      const url = `${API_BASE}/v4/matches/${region}/${PLATFORM}/${encodedName}/${encodedTag}?size=${FETCH_SIZE}${cacheBuster}`;
      const compResponse = await fetchWithRetry(url, apiKeys, { headers });
      const compData = normalizeV4MatchList(compResponse.ok ? await compResponse.json().catch(() => ({ data: [] })) : { data: [] });
      
      await delay(500);
      
      const mmrUrl = `${API_BASE}/v1/mmr-history/${region}/${encodedName}/${encodedTag}?size=${FETCH_SIZE}`;
      const mmrResponse = await fetchWithRetry(mmrUrl, apiKeys, { headers });
      const mmrData = mmrResponse.ok ? await mmrResponse.json().catch(() => ({ data: [] })) : { data: [] };
      
      const rawCompetitive = (compData.data || []).filter(m => (m.metadata?.mode ? m.metadata.mode.toLowerCase() : '') === 'competitive');

      const cleanRankedMatches = rawCompetitive.map(m => {
        const playerStats = findPlayer(m.players?.all_players);
        if (!playerStats) return null;

        const relatedMmr = (mmrData.data || []).find(mmr => mmr.match_id === m.metadata.matchid);
        
        // ⚡ FIX : On n'ignore plus le match s'il manque les points ! On l'ajoute quand même avec 0 RR par défaut.
        let rrChange = 0, currentRank = 'Unknown', currentRR = 0, rankValue = null;
        if (relatedMmr) {
            rrChange = relatedMmr.mmr_change_to_last_game || 0;
            currentRank = relatedMmr.currenttierpatched || 'Unknown';
            currentRR = relatedMmr.ranking_in_tier || 0;
            rankValue = (relatedMmr.currenttier || 0) * 100 + (relatedMmr.ranking_in_tier || 0);
        } else {
            console.log(`⏳ Info : RR manquants pour le match de ${player.name} (le match sera quand même sauvegardé)`);
        }
        
        const b = m.teams?.blue?.rounds_won || 0;
        const r = m.teams?.red?.rounds_won || 0;
        const isWin = playerStats.team === 'Blue' ? (b > r) : (r > b);

        let matchScore = '0 - 0';
        if (m.teams && playerStats.team) {
            const myT = playerStats.team.toLowerCase();
            const oppT = myT === 'blue' ? 'red' : 'blue';
            matchScore = `${m.teams[myT]?.rounds_won || 0} - ${m.teams[oppT]?.rounds_won || 0}`;
        }

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

        // Build a name/tag map from kill event display names (e.g. "PlayerName#EUW1")
        // Riot API stopped returning names in all_players, but kill events still have them
        const displayNameMap = {};
        allKills.forEach(k => {
            if (k.killer_puuid && k.killer_display_name) displayNameMap[k.killer_puuid] = k.killer_display_name;
            if (k.victim_puuid && k.victim_display_name) displayNameMap[k.victim_puuid] = k.victim_display_name;
        });

        const enrichedAllPlayers = (m.players?.all_players || []).map(p => {
            const cfgP = findCfgByPuuid(allConfigPlayers, p.puuid);
            let name = cfgP ? cfgP.name : p.name;
            let tag  = cfgP ? cfgP.tag  : p.tag;
            // Backfill from kill event display names if still empty
            if (!name?.trim() && p.puuid && displayNameMap[p.puuid]) {
                const parts = displayNameMap[p.puuid].split('#');
                name = parts[0] || name;
                tag  = parts[1] || tag;
            }
            if (!name?.trim()) {
                name = p.character || 'Inconnu';
                tag = '';
            }
            return {
                ...p,
                name,
                tag,
                stats: {
                    ...p.stats,
                    first_kills:  matchFkFd[p.puuid]?.fk || p.stats?.first_kills  || 0,
                    first_deaths: matchFkFd[p.puuid]?.fd || p.stats?.first_deaths || 0
                }
            };
        });

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
        // Cérémonies de fin de round où le joueur a réalisé le fait marquant (v4 : round.ceremony
        // s'applique au dernier kill du round). On attribue au joueur du dernier kill du round.
        const ceremonies = { flawless: 0, clutch: 0, ace: 0, closer: 0, thrifty: 0 };
        // Comportement (v4) : AFK, tirs alliés, temps passé au spawn.
        const behavior = {
            afkRounds: playerStats.behavior?.afk_rounds || 0,
            ffOutgoing: playerStats.behavior?.friendly_fire?.outgoing || 0,
            ffIncoming: playerStats.behavior?.friendly_fire?.incoming || 0,
        };

        if (m.rounds && m.rounds.length > 0) {
          m.rounds.forEach((round, index) => {
            if (index < 12 && !startSide && round.plant_events && round.plant_events.plant_location) {
              startSide = (round.plant_events.planted_by?.team === playerStats.team) ? 'Attack' : 'Defend';
            }
          });
          if (!startSide) startSide = 'Unknown';

          m.rounds.forEach((round, index) => {
            // Cérémonie : on l'attribue si le dernier kill du round est celui du joueur.
            const cer = (round.ceremony || '').replace('Ceremony', '').toLowerCase();
            if (cer && cer !== 'default') {
                const roundKillEvents = (allKills || []).filter(k => (k.round ?? k.round_number) === index);
                const lastKill = roundKillEvents.sort((a, b) => (b.kill_time_in_round || 0) - (a.kill_time_in_round || 0))[0];
                if (lastKill && lastKill.killer_puuid === playerStats.puuid && ceremonies[cer] !== undefined) {
                    ceremonies[cer]++;
                }
            }
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
                const resolveName = (info) => info ? (info.name?.trim() || findCfgByPuuid(allConfigPlayers, info.puuid)?.name || info.character || 'Inconnu') : 'Inconnu';
                fbDetails = {
                    killerName:  resolveName(kInfo),
                    killerAgent: kInfo?.assets?.agent?.small || null,
                    victimName:  resolveName(vInfo),
                    victimAgent: vInfo?.assets?.agent?.small || null,
                    weapon: fbEvent.weapon || 'Arme inconnue'
                };
            }

            let planterName = null; let defuserName = null;
            if (round.plant_events?.planted_by?.puuid) {
                const pInfo = m.players?.all_players?.find(ap => ap.puuid === round.plant_events.planted_by.puuid);
                planterName = pInfo ? (pInfo.name?.trim() || findCfgByPuuid(allConfigPlayers, pInfo.puuid)?.name || pInfo.character) : null;
            }
            if (round.defuse_events?.defused_by?.puuid) {
                const dInfo = m.players?.all_players?.find(ap => ap.puuid === round.defuse_events.defused_by.puuid);
                defuserName = dInfo ? (dInfo.name?.trim() || findCfgByPuuid(allConfigPlayers, dInfo.puuid)?.name || dInfo.character) : null;
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
            const victimInGroup = findCfgByPuuid(allConfigPlayers, k.victim_puuid)
              || allConfigPlayers.find(p => p.name && p.name.toLowerCase() === (k.victim_display_name || '').toLowerCase().split('#')[0] && p.tag && p.tag.toLowerCase() === (k.victim_display_name || '').toLowerCase().split('#')[1]);
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
          id: m.metadata.matchid,
          type: 'ranked',
          playerId: player.id,
          agent: playerStats.character,
          agentImg: playerStats.assets?.agent?.small || null,
          matchScore: matchScore,
          rrChange: rrChange,
          currentRank: currentRank,
          currentRR: currentRR,
          rankValue: rankValue,
          kills,
          deaths,
          assists,
          score,
          kd: Number((deaths > 0 ? kills / deaths : kills).toFixed(2)),
          isMatchMVP,
          isTeamMVP,
          mk3,
          mk4,
          mk5, 
          headshots: playerStats.stats?.headshots || 0,
          bodyshots: playerStats.stats?.bodyshots || 0,
          legshots: playerStats.stats?.legshots || 0,
          totalShots: (playerStats.stats?.bodyshots || 0) + (playerStats.stats?.legshots || 0) + (playerStats.stats?.headshots || 0),
          firstKills: matchFkFd[playerStats.puuid]?.fk || 0, 
          firstDeaths: matchFkFd[playerStats.puuid]?.fd || 0,
          clutches,
          ceremonies,
          behavior,
          sides: { atkWins, atkRounds, defWins, defRounds },
          plants,
          defuses,
          plantSites,
          weaponStats,
          deathCoordinates,
          roundDetails,
          timeline: timeline, 
          adr: Math.round((playerStats.damage_made || 0) / rp),
          adrReceived: Math.round((playerStats.damage_received || 0) / rp), // dégâts subis/round (survie)
          acs: Math.round(score / rp),
          roundsPlayed: rp,
          economy: { avgSpent: Math.round((playerStats.economy?.spent?.overall || 0) / rp), avgLoadoutValue: Math.round((playerStats.economy?.loadout_value?.overall || 0) / rp) },
          abilities: { ...abilities, total: (abilities.c_cast || 0) + (abilities.q_cast || 0) + (abilities.e_cast || 0) + (abilities.x_cast || 0) },
          partyId: playerStats.party_id,
          allPlayers: enrichedAllPlayers,
          teamInfo: m.teams,
          myTeam: playerStats.team,
          result: isWin ? 'WIN' : 'LOSS',
          date: m.metadata.game_start_patched,
          timestamp: m.metadata.game_start,
          map: m.metadata.map
        };
      }).filter(Boolean);
      newMatches = [...newMatches, ...cleanRankedMatches];
    } catch (e) {
        console.error(`❌ Erreur Fetch Ranked pour ${player.name}:`, e.message);
    }

    return newMatches;
};

// --- ALERTE FIN DE MATCH IMMÉDIATE ---
// --- ALERTE DÉBUT DE SESSION ---
// Cooldown mémoire : max une annonce par joueur toutes les 3h (survit au sein
// du process ; un restart serveur peut au pire re-annoncer une fois, acceptable).
const sessionAnnounceCooldown = new Map();

const announceSessionStarts = async (sessionStarters, allConfigPlayers, appUrl) => {
    if (!sessionStarters || sessionStarters.size === 0) return;
    const channelId = await getConfig('discord_channel_id');
    if (!channelId || !discordClient.isReady()) return;

    const now = Date.now();
    const starters = [];
    for (const [playerId, match] of sessionStarters) {
        const lastAnnounce = sessionAnnounceCooldown.get(playerId) || 0;
        if (now - lastAnnounce < 3 * 60 * 60 * 1000) continue;
        const cfg = allConfigPlayers.find(p => p.id === playerId);
        if (!cfg) continue;
        sessionAnnounceCooldown.set(playerId, now);
        starters.push({ cfg, match });
    }
    if (starters.length === 0) return;

    try {
        const channel = await discordClient.channels.fetch(channelId);
        if (!channel) return;

        // Message groupé si plusieurs lancent en même temps (soirée d'équipe !)
        const names = starters.map(s => `**${s.cfg.name}**`).join(', ');
        const isSquad = starters.length > 1;
        const first = starters[0];

        // Rang fiable : on privilégie le snapshot live_mmr (v3/mmr) stocké en base.
        // On le relit FRAIS depuis la DB car refreshMmrForPlayer l'a mis à jour
        // pendant ce sync (l'objet cfg en mémoire peut être périmé). Le rang du
        // match peut être "Unknown"/0 si Riot n'a pas encore indexé le MMR.
        const resolveRank = async (s) => {
            let mmr = null;
            try {
                const row = await db.get("SELECT live_mmr FROM players WHERE id = ?", [s.cfg.id]);
                mmr = row?.live_mmr ? JSON.parse(row.live_mmr) : null;
            } catch { mmr = null; }
            if (mmr?.current?.tier && mmr.current.tier !== 'Unrated') {
                return `${mmr.current.tier} ${mmr.current.rr ?? 0}RR`;
            }
            const mr = s.match?.currentRank;
            if (mr && mr !== 'Unknown' && mr !== 'Unrated') {
                return `${mr} ${s.match.currentRR ?? 0}RR`;
            }
            return null; // on n'affiche rien plutôt qu'un "Unknown 0RR"
        };
        const firstRank = await resolveRank(first);

        const embed = new EmbedBuilder()
            .setColor(isSquad ? 0xff4655 : parseInt((first.cfg.color || '#5865F2').replace('#', ''), 16))
            .setTitle(isSquad ? `🎮 L'escouade se connecte !` : `🎮 ${first.cfg.name} lance sa session !`)
            .setDescription(
                isSquad
                    ? `${names} viennent de lancer leurs premières games de la session. Ça va farmer du RR ce soir ! 🔥`
                    : `${names} vient de terminer sa première game de la session${firstRank ? ` — actuellement **${firstRank}**` : ''}.`
            )
            .setURL(appUrl || null)
            .setFooter({ text: 'KSL Tracker • Session détectée' })
            .setTimestamp();
        if (!isSquad && first.match.agentImg) embed.setThumbnail(first.match.agentImg);

        await channel.send({ embeds: [embed] });
        console.log(`🎮 [Discord] Alerte début de session envoyée : ${starters.map(s => s.cfg.name).join(', ')}`);
    } catch (e) {
        console.error("❌ Alerte session:", e.message);
    }
};

const announceNewMatches = async (newlyDiscoveredMatches, allConfigPlayers, appUrl, ignoreTimeLimit = false) => {
    if (newlyDiscoveredMatches.length === 0) return;

    const channelId = await getConfig('discord_channel_id');
    if (!channelId) {
        console.log("⚠️ [Discord] Channel ID non configuré, impossible d'envoyer l'alerte.");
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

    // Détection rank up / rank down
    for (const match of newlyDiscoveredMatches.filter(m => m.type === 'ranked' && m.rankValue && m.playerId)) {
        const prevRow = await db.get(
            "SELECT data FROM matches WHERE player_id = ? AND type = 'ranked' AND id != ? ORDER BY date DESC LIMIT 1",
            [match.playerId, `${match.id}_${match.playerId}`]
        );
        if (!prevRow) continue;
        const prev = JSON.parse(prevRow.data);
        if (!prev.rankValue) continue;
        const prevTier = Math.floor(prev.rankValue / 100);
        const newTier  = Math.floor(match.rankValue / 100);
        if (prevTier === newTier) continue;
        const cfg = allConfigPlayers.find(c => c.id === match.playerId);
        if (!cfg) continue;
        const isUp = newTier > prevTier;
        const playerMention = cfg.discord_id ? `<@${cfg.discord_id}>` : `**${cfg.name}**`;
        const rankEmbed = new EmbedBuilder()
            .setTitle(isUp ? `🎉 RANK UP — ${cfg.name} !` : `📉 RANK DOWN — ${cfg.name}`)
            .setColor(isUp ? 0xffd700 : 0x7c3aed)
            .setDescription(isUp
                ? `**${prev.currentRank}** → **${match.currentRank}**\n\n🏅 Félicitations à ${playerMention} pour la montée de rang !`
                : `**${prev.currentRank}** → **${match.currentRank}**\n\n💪 Courage ${playerMention}, la remontée arrive !`)
            .setTimestamp();
        await sendDiscordMessage(channelId, { embeds: [rankEmbed] });
        await delay(500);
    }

    for (const matchId of Object.keys(matchesById)) {
        const messagePayload = await buildMatchMessage(matchId, 'global', allConfigPlayers, appUrl);
        if (messagePayload) {
            console.log(`📤 [Discord] Envoi de l'alerte pour le match ${matchId}...`);
            await sendDiscordMessage(channelId, messagePayload);
            await delay(1500);
        }
    }
};

// --- MMR TEMPS RÉEL (v3/mmr) ---
// Récupère le rang courant fiable (indépendant du dernier match stocké), le peak,
// et l'historique par saison. Persiste un snapshot JSON dans players.live_mmr.
// Corrige le bug d'affichage de rang périmé après un reset d'acte.
const refreshMmrForPlayer = async (player, apiKeys) => {
    if (!player.puuid) return null;
    const region = (player.region || 'eu').toLowerCase();
    const name = encodeURIComponent(player.name.trim());
    const tag = encodeURIComponent(player.tag.trim());
    try {
        const res = await fetchWithRetry(`${API_BASE}/v3/mmr/${region}/pc/${name}/${tag}`, apiKeys, {}, 3);
        if (!res.ok) return null;
        const j = await res.json();
        const d = j.data;
        if (!d) return null;

        const snapshot = {
            current: {
                tier: d.current?.tier?.name || null,
                tierId: d.current?.tier?.id ?? null,
                rr: d.current?.rr ?? null,
                elo: d.current?.elo ?? null,
                rankValue: (d.current?.tier?.id ?? 0) * 100 + (d.current?.rr ?? 0),
                leaderboard: d.current?.leaderboard_placement?.rank ?? null,
            },
            peak: d.peak ? {
                tier: d.peak.tier?.name || null,
                tierId: d.peak.tier?.id ?? null,
                rr: d.peak.rr ?? null,
                season: d.peak.season?.short || null,
            } : null,
            // Historique par saison (short → tier/wins/games), utile pour la frise carrière
            seasonal: (d.seasonal || []).map(s => ({
                season: s.season?.short || null,
                tier: s.end_tier?.name || s.final_tier?.name || null,
                wins: s.wins ?? s.wins_by_tier ? undefined : undefined,
                games: s.games ?? null,
            })).filter(s => s.season),
            fetchedAt: Date.now(),
        };

        await db.run(
            "UPDATE players SET live_mmr = ?, mmr_updated_at = ? WHERE id = ?",
            [JSON.stringify(snapshot), Date.now(), player.id]
        );

        // Bannière + level (v2/account) : ne les récupère qu'une fois par 24h.
        if (!player.account_card || !player.mmr_updated_at || (Date.now() - player.mmr_updated_at) > 24 * 60 * 60 * 1000) {
            try {
                const accRes = await fetchWithRetry(`${API_BASE}/v2/account/${name}/${tag}`, apiKeys, {}, 2);
                if (accRes.ok) {
                    const accJson = await accRes.json();
                    const card = accJson.data?.card || null;   // UUID de la player card
                    const level = accJson.data?.account_level ?? null;
                    if (card || level) {
                        await db.run("UPDATE players SET account_card = ?, account_level = ? WHERE id = ?",
                            [card, level, player.id]);
                    }
                }
            } catch { /* non bloquant */ }
        }

        return snapshot;
    } catch (e) {
        console.warn(`⚠️ MMR ${player.name}:`, e.message);
        return null;
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
            return;
        }

        if (apiKeys.length === 0) {
            console.log("⚠️ Aucune clé API configurée. Fin du scan.");
            return;
        }

        console.log(`🔄 Démarrage du scan Riot API...`);

        // Résolution préalable des PUUIDs manquants (mute le bug "noms = noms d'agents")
        await ensurePuuids(allConfigPlayers, apiKeys);

        const playersToFetch = requestedPlayerId === 'all' ? allConfigPlayers : allConfigPlayers.filter(p => p.id === requestedPlayerId);
        
        let allNewMatches = [];

        // ⚡ NOUVEAU LOG : Pour voir exactement ce qu'il se passe pendant le scan
        for (const player of playersToFetch) {
            console.log(`\n🔍 Scan en cours pour : ${player.name}#${player.tag} (Région: ${player.region})`);
            const matches = await fetchPlayerData(player, apiKeys, allConfigPlayers);
            console.log(`   -> ${matches.length} matchs récupérés et filtrés.`);
            allNewMatches.push(...matches);
            // Rafraîchit le rang temps réel (peak, reset d'acte, etc.) via v3/mmr
            await refreshMmrForPlayer(player, apiKeys);
            await delay(1000);
        }

        let totalAdded = 0;
        let newlyAddedRankedMatches = []; 

        const sessionStarters = new Map(); // playerId -> match (première game d'une session)

        if (allNewMatches.length > 0) {
            await db.exec('BEGIN TRANSACTION');
            for (const match of allNewMatches) {
                const uniqueId = `${match.id}_${match.playerId}`;
                const timestamp = match.timestamp ? match.timestamp * 1000 : new Date(match.date).getTime();

                const existing = await db.get(`SELECT id FROM matches WHERE id = ?`, [uniqueId]);
                const isNew = !existing;

                // Détection "début de session" : match frais (< 2h) ET plus de 3h
                // depuis la game précédente du joueur → il vient de (re)lancer.
                if (isNew && match.type === 'ranked' && !sessionStarters.has(match.playerId)) {
                    const ageMs = Date.now() - timestamp;
                    if (ageMs < 2 * 60 * 60 * 1000) {
                        const prev = await db.get(
                            "SELECT MAX(date) AS d FROM matches WHERE player_id = ? AND type = 'ranked'",
                            [match.playerId]
                        );
                        if (!prev?.d || (timestamp - prev.d) > 3 * 60 * 60 * 1000) {
                            sessionStarters.set(match.playerId, match);
                        }
                    }
                }

                // ⚡ FIX: Ne pas écraser les noms Backfillés si le match existe déjà !
                if (!isNew) {
                    const existingRow = await db.get(`SELECT data FROM matches WHERE id = ?`, [uniqueId]);
                    const oldMatch = JSON.parse(existingRow.data);
                    const oldNames = {};
                    (oldMatch.allPlayers || []).forEach(p => {
                        if (p.puuid && p.name && p.name.trim() !== '' && p.name !== p.character) {
                            oldNames[p.puuid] = { name: p.name, tag: p.tag };
                        }
                    });
                    (match.allPlayers || []).forEach(p => {
                        if (oldNames[p.puuid] && (!p.name || p.name.trim() === '' || p.name === p.character)) {
                            p.name = oldNames[p.puuid].name;
                            p.tag = oldNames[p.puuid].tag;
                        }
                    });
                }

                const result = await db.run(
                    `INSERT OR REPLACE INTO matches (id, player_id, date, data, type, result, map, agent, kills, deaths, assists, rr_change, acs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [uniqueId, match.playerId, timestamp, JSON.stringify(match), match.type, match.result, match.map, match.agent, match.kills, match.deaths, match.assists, match.rrChange, match.acs]
                );
                
                if (result.changes > 0) {
                    if (isNew) totalAdded++;
                    if (isNew && match.type === 'ranked') {
                        if (match.currentRank && match.currentRank !== 'Unknown') {
                            // RR connu → annonce immédiate
                            newlyAddedRankedMatches.push(match);
                        } else {
                            // RR pas encore dispo côté Riot → on attend le prochain scan
                            if (!pendingMatchAnnouncements.has(match.id)) {
                                pendingMatchAnnouncements.set(match.id, Date.now());
                                const pName = allConfigPlayers.find(p => p.id === match.playerId)?.name ?? match.playerId;
                                console.log(`⏳ [RR] Match ${match.id} de ${pName} en attente RR — annonce au prochain scan.`);
                            }
                        }
                    }
                }
            }
            await db.exec('COMMIT');
            if (totalAdded > 0) markDataChanged();
        }

        console.log(`\n✅ Fin du scan complet. ${totalAdded} matchs traités/sauvegardés.`);

        // Backfill automatique des pseudos manquants sur les matchs touchés par ce scan.
        // La matchlist V4 ne garantit pas name/tag — on rattrape via /v4/match/{region}/{id}.
        const idsToBackfill = new Set();
        for (const m of allNewMatches) {
            if ((m.allPlayers || []).some(isMissingPseudo)) idsToBackfill.add(m.id);
        }
        if (idsToBackfill.size > 0) {
            console.log(`🔧 Backfill auto sur ${idsToBackfill.size} match(s) avec pseudos manquants...`);
            const r = await backfillNamesForMatches([...idsToBackfill], apiKeys);
            console.log(`   -> ${r.fetched} re-fetchés, ${r.updated} mis à jour, ${r.skipped} ignorés.`);
            if (r.updated > 0) markDataChanged();

            // Recharge les matchs ranked qui viennent d'être backfillés pour que
            // les notifications Discord utilisent les pseudos corrects.
            for (let i = 0; i < newlyAddedRankedMatches.length; i++) {
                const m = newlyAddedRankedMatches[i];
                if (idsToBackfill.has(m.id)) {
                    const fresh = await db.get("SELECT data FROM matches WHERE id = ?", [`${m.id}_${m.playerId}`]);
                    if (fresh) {
                        try { newlyAddedRankedMatches[i] = JSON.parse(fresh.data); } catch (e) { void e; }
                    }
                }
            }
        }

        // Résolution des matchs en attente de données RR
        if (pendingMatchAnnouncements.size > 0) {
            for (const [matchId, firstSeenAt] of pendingMatchAnnouncements) {
                const expired = Date.now() - firstSeenAt > 20 * 60 * 1000;
                const matchRows = await db.all("SELECT data FROM matches WHERE id LIKE ?", [`${matchId}_%`]);
                if (matchRows.length === 0) { pendingMatchAnnouncements.delete(matchId); continue; }

                const matchDataArr = matchRows.map(r => JSON.parse(r.data));
                const allHaveRR = matchDataArr.every(m => m.currentRank && m.currentRank !== 'Unknown');

                if (allHaveRR || expired) {
                    pendingMatchAnnouncements.delete(matchId);
                    if (expired && !allHaveRR) {
                        console.log(`⚠️ [RR] Match ${matchId} expiré (20 min) — annonce avec données partielles.`);
                    } else {
                        console.log(`✅ [RR] Match ${matchId} — RR confirmé, envoi Discord.`);
                    }
                    newlyAddedRankedMatches.push(matchDataArr[0]);
                }
            }
        }

        // Alerte "début de session" AVANT les embeds de match (ordre chronologique naturel)
        await announceSessionStarts(sessionStarters, allConfigPlayers, appUrl);

        if (newlyAddedRankedMatches.length > 0) {
            console.log(`📢 ${newlyAddedRankedMatches.length} nouveau(x) match(s) classé(s) à annoncer.`);
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

const generateDailyReport = async (isManual = false, forceDate = null) => {
    console.log(`📊 [RAPPORT] Déclenchement — Manuel: ${isManual}, ForceDate: ${forceDate ?? 'non'}`);

    const channelId = await getConfig('discord_channel_id');
    if (!channelId || channelId.trim() === '') {
        console.warn("⚠️ [RAPPORT] Aucun Channel ID Discord configuré — rapport annulé.");
        return;
    }

    if (!discordClient.isReady()) {
        console.warn("⚠️ [RAPPORT] Bot Discord non connecté — rapport annulé.");
        return;
    }

    const appUrl = await getConfig('app_url', 'http://localhost:5173');
    const allConfigPlayers = await getPlayers();

    const targetDate = forceDate ? new Date(forceDate) : new Date();
    if (!isManual && !forceDate) {
        targetDate.setHours(targetDate.getHours() - 12);
    }

    const dateStr = getParisDateString(targetDate);
    const dateTitle = targetDate.toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Europe/Paris' });
    console.log(`📅 [RAPPORT] Cible : ${dateStr} (${dateTitle})`);

    const safeDateStr = dateStr.replace(/\//g, '-');
    const payload = await buildDailyReportMessage(safeDateStr, 'summary', allConfigPlayers, appUrl);

    if (payload) {
        await sendDiscordMessage(channelId, payload);
        console.log(`✅ [RAPPORT] Envoyé pour le ${dateStr}.`);
        // Carte-image de la soirée en complément visuel du rapport texte.
        try {
            const sessionData = await gatherSessionData();
            if (sessionData) {
                const png = await buildSessionCard(sessionData);
                const attachment = new AttachmentBuilder(png, { name: 'ksl-soiree.png' });
                await sendDiscordMessage(channelId, { files: [attachment] });
                console.log(`🖼️ [RAPPORT] Carte de soirée envoyée.`);
            }
        } catch (e) {
            console.warn(`⚠️ [RAPPORT] Carte de soirée non envoyée: ${e.message}`);
        }
    } else {
        console.log(`ℹ️ [RAPPORT] Aucune partie classée le ${dateStr} — rapport non envoyé.`);
        if (isManual) {
            await sendDiscordMessage(channelId, { content: `🚫 **Rapport du ${dateTitle}** : Le calme plat. Aucune game classée enregistrée.` });
        }
    }
};

// ==========================================
// ROUTES PUBLIQUES (FRONTEND CLASSIQUE)
// ==========================================

// ==========================================
// SOIRÉE EN DIRECT (Live session)
// ==========================================
// Lit uniquement la DB (zéro coût API). Renvoie l'état de session de chaque
// joueur : actif ce soir, RR du jour, dernière partie il y a X min, "probablement
// en game" (heuristique), série en cours. Le polling MMR réel se fait via le cron.
app.get('/api/live/session', async (req, res) => {
    try {
        const players = await getPlayers();
        const now = Date.now();

        // Fenêtre "session" : depuis 16h heure de Paris aujourd'hui (ou hier si on est
        // tôt le matin), pour capturer une soirée qui déborde après minuit.
        const paris = new Date(now);
        const startOfWindow = new Date(paris);
        startOfWindow.setHours(16, 0, 0, 0);
        // Si on est entre minuit et 6h, la soirée est celle d'hier soir.
        if (paris.getHours() < 6) startOfWindow.setDate(startOfWindow.getDate() - 1);
        const windowStart = startOfWindow.getTime();

        const sessions = [];
        for (const p of players) {
            const rows = await db.all(
                "SELECT data FROM matches WHERE player_id = ? AND type = 'ranked' AND date >= ? ORDER BY date DESC",
                [p.id, windowStart]
            );
            const games = rows.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);

            // Dernier match connu (même hors fenêtre) pour le rang/RR courant.
            const lastRow = await db.get(
                "SELECT data FROM matches WHERE player_id = ? AND type = 'ranked' ORDER BY date DESC LIMIT 1",
                [p.id]
            );
            const lastMatch = lastRow ? (() => { try { return JSON.parse(lastRow.data); } catch { return null; } })() : null;

            const sessionRR = games.reduce((s, m) => s + (m.rrChange || 0), 0);
            const wins = games.filter(m => m.result === 'WIN').length;
            const losses = games.filter(m => m.result === 'LOSS').length;

            // Heure du dernier match (toutes sessions confondues)
            const lastTs = lastMatch ? (lastMatch.timestamp ? lastMatch.timestamp * 1000 : new Date(lastMatch.date).getTime()) : null;
            const minSinceLast = lastTs ? Math.floor((now - lastTs) / 60000) : null;

            // Série en cours (sur la session)
            let streak = 0, streakType = null;
            for (const m of games) {
                const r = m.result === 'WIN' ? 'W' : (m.result === 'LOSS' ? 'L' : null);
                if (!r) continue;
                if (streakType === null) { streakType = r; streak = 1; }
                else if (r === streakType) streak++;
                else break;
            }

            // Heuristique "probablement en game" : a joué dans la fenêtre, dernière partie
            // il y a 20-55 min (durée typique d'une ranked en cours), et c'est le soir.
            const playedTonight = games.length > 0;
            const likelyInGame = playedTonight && minSinceLast !== null && minSinceLast >= 20 && minSinceLast <= 55;
            // "Actif" : a joué il y a moins de 90 min.
            const active = minSinceLast !== null && minSinceLast <= 90 && playedTonight;

            // Rang FIABLE : v3/mmr (temps réel) en priorité, fallback dernier match.
            let mmr = null;
            try { mmr = p.live_mmr ? JSON.parse(p.live_mmr) : null; } catch { mmr = null; }
            const rank = mmr?.current?.tier || lastMatch?.currentRank || null;
            const rr = mmr?.current?.rr ?? lastMatch?.currentRR ?? null;
            const rankValue = mmr?.current?.rankValue ?? lastMatch?.rankValue ?? 0;

            sessions.push({
                id: p.id, name: p.name, tag: p.tag, color: p.color,
                rank, rr, rankValue,
                peak: mmr?.peak || null,
                sessionRR, wins, losses, gamesTonight: games.length,
                minSinceLast, lastTs,
                streak, streakType,
                active, likelyInGame, playedTonight,
            });
        }

        // Tri : en game d'abord, puis actifs, puis par RR de session décroissant.
        sessions.sort((a, b) => {
            if (a.likelyInGame !== b.likelyInGame) return a.likelyInGame ? -1 : 1;
            if (a.active !== b.active) return a.active ? -1 : 1;
            return b.sessionRR - a.sessionRR;
        });

        const collective = sessions.reduce((acc, s) => {
            acc.rr += s.sessionRR; acc.wins += s.wins; acc.losses += s.losses; acc.games += s.gamesTonight;
            return acc;
        }, { rr: 0, wins: 0, losses: 0, games: 0 });

        // Feed d'activité : les dernières games (24h), groupées par match
        // (une seule entrée même si plusieurs joueurs trackés étaient dans la game).
        const recentRows = await db.all(
            "SELECT player_id, data FROM matches WHERE type = 'ranked' AND date >= ? ORDER BY date DESC LIMIT 40",
            [now - 24 * 60 * 60 * 1000]
        );
        const feedByMatch = new Map();
        for (const r of recentRows) {
            let m; try { m = JSON.parse(r.data); } catch { continue; }
            const cfg = players.find(p => p.id === r.player_id);
            if (!cfg) continue;
            const ts = m.timestamp ? m.timestamp * 1000 : new Date(m.date).getTime();
            if (!feedByMatch.has(m.id)) {
                feedByMatch.set(m.id, {
                    matchId: m.id, map: m.map, ts,
                    result: m.result, score: m.matchScore || null,
                    players: [],
                });
            }
            feedByMatch.get(m.id).players.push({
                name: cfg.name, color: cfg.color,
                agent: m.agent, agentImg: m.agentImg || null,
                rr: m.rrChange ?? 0, kills: m.kills, deaths: m.deaths,
            });
        }
        const recentGames = [...feedByMatch.values()]
            .sort((a, b) => b.ts - a.ts)
            .slice(0, 10);

        // Statut serveurs Riot (région du 1er joueur, cache 5 min) — best effort.
        let riotStatus = null;
        try {
            const apiKeys = await getApiKeys();
            const region = players[0]?.region || 'eu';
            if (apiKeys.length > 0) riotStatus = await getRiotStatus(region, apiKeys);
        } catch { /* non bloquant */ }

        res.json({
            windowStart,
            now,
            collective,
            activeCount: sessions.filter(s => s.active).length,
            sessions,
            recentGames,
            riotStatus,
        });
    } catch (e) {
        console.error("❌ /api/live/session:", e.message);
        res.status(500).json({ error: e.message });
    }
});

// Contexte esport + ladder (v1/esports/schedule + v3/leaderboard), cache 15 min.
let esportsCache = { data: null, expiry: 0 };
app.get('/api/live/context', async (req, res) => {
    try {
        const now = Date.now();
        if (esportsCache.data && now < esportsCache.expiry) return res.json(esportsCache.data);

        const apiKeys = await getApiKeys();
        if (apiKeys.length === 0) return res.json({ esports: [], ladder: null });

        const players = await getPlayers();
        const region = players[0]?.region || 'eu';

        // Matchs pro à venir (EMEA par défaut)
        let esports = [];
        try {
            const r = await fetchWithRetry(`${API_BASE}/v1/esports/schedule?region=emea`, apiKeys, {}, 2);
            if (r.ok) {
                const j = await r.json();
                esports = (j.data || [])
                    .filter(m => m.state === 'unstarted' && m.match?.teams?.length === 2)
                    .slice(0, 5)
                    .map(m => ({
                        league: m.league?.name || '',
                        icon: m.league?.icon || null,
                        date: m.date || null,
                        teams: m.match.teams.map(t => ({ name: t.name, code: t.code, icon: t.icon })),
                    }));
            }
        } catch { /* non bloquant */ }

        // Top ladder de la région (borne Radiant #1)
        let ladder = null;
        try {
            const r = await fetchWithRetry(`${API_BASE}/v3/leaderboard/${region}/pc?size=3`, apiKeys, {}, 2);
            if (r.ok) {
                const j = await r.json();
                const top = (j.data?.players || []).slice(0, 3).map(p => ({
                    name: p.name, tag: p.tag, rr: p.rr, rank: p.leaderboard_rank ?? null,
                }));
                ladder = { region: region.toUpperCase(), top, total: j.data?.total_players ?? null };
            }
        } catch { /* non bloquant */ }

        // Boutique du jour (bundles en vedette). La rotation change à minuit UTC-ish.
        let store = null;
        try {
            const r = await fetchWithRetry(`${API_BASE}/v2/store-featured`, apiKeys, {}, 2);
            if (r.ok) {
                const j = await r.json();
                const bundles = Array.isArray(j.data) ? j.data : [];
                store = bundles.slice(0, 2).map(b => ({
                    price: b.bundle_price ?? null,
                    // Aperçu : jusqu'à 4 items avec leur image
                    items: (b.items || []).slice(0, 4).map(it => ({
                        name: it.name, type: it.type, image: it.image || null,
                    })),
                }));
            }
        } catch { /* non bloquant */ }

        const data = { esports, ladder, store };
        esportsCache = { data, expiry: now + 15 * 60 * 1000 };
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Proxy image du viseur : la génération HenrikDev exige la clé API, donc on
// relaie le PNG côté serveur. Cache navigateur 1h (un code de viseur est stable).
app.get('/api/crosshair', imageLimiter, async (req, res) => {
    try {
        const code = req.query.code;
        if (!code || typeof code !== 'string' || code.length > 500) {
            return res.status(400).send('Code invalide');
        }
        const apiKeys = await getApiKeys();
        if (apiKeys.length === 0) return res.status(503).send('Pas de clé API');
        const r = await fetchWithRetry(`${API_BASE}/v1/crosshair/generate?id=${encodeURIComponent(code)}`, apiKeys, {}, 2);
        if (!r.ok) return res.status(r.status).send('Génération impossible');
        const buf = Buffer.from(await r.arrayBuffer());
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.send(buf);
    } catch (e) {
        res.status(500).send(e.message);
    }
});

app.get('/history', async (req, res) => {
    try {
        // Cache HTTP : si rien n'a bougé depuis la dernière sync,
        // le navigateur garde sa copie locale et on renvoie 304.
        const lastModified = new Date(lastDataChange).toUTCString();
        res.setHeader('Last-Modified', lastModified);
        res.setHeader('Cache-Control', 'private, max-age=10, must-revalidate');
        const ifModSince = req.headers['if-modified-since'];
        if (ifModSince) {
            const ifModTime = Date.parse(ifModSince);
            if (!isNaN(ifModTime) && ifModTime >= lastDataChange) {
                return res.status(304).end();
            }
        }

        const { start, end, limit = 5000, offset = 0 } = req.query;
        let query = 'SELECT data FROM matches';
        let params = [];
        let conditions = [];

        if (start && start !== 'null') {
            conditions.push('date >= ?');
            params.push(parseInt(start));
        }
        if (end && end !== 'null') {
            conditions.push('date <= ?');
            params.push(parseInt(end));
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        query += ' ORDER BY date DESC';
        query += ` LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}`;

        const rows = await db.all(query, params);

        // Optim: row.data est déjà une string JSON valide. On évite le
        // round-trip parse+stringify qui allouait ~10-20 MB pour 5000 matchs.
        const jsonParts = [];
        for (const r of rows) {
            if (r.data) jsonParts.push(r.data);
        }
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.send('{"matches":[' + jsonParts.join(',') + ']}');
    } catch (e) {
        console.error("❌ ERREUR CRITIQUE SUR LA ROUTE /history :", e);
        res.status(500).json({ matches: [], error: e.message });
    }
});

// SSE : flux d'événements temps réel.
// Le front s'abonne via `new EventSource('/api/events')` et reçoit `matches_updated`
// dès qu'une sync ajoute des matchs. Évite d'avoir à recharger manuellement.
app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // désactive le buffering nginx si présent
    res.flushHeaders();

    res.write(`data: ${JSON.stringify({ type: 'connected', ts: Date.now() })}\n\n`);
    sseClients.add(res);

    // Heartbeat toutes les 25s pour empêcher les proxies de timeout la connexion
    const heartbeat = setInterval(() => {
        try { res.write(`: heartbeat\n\n`); }
        catch { clearInterval(heartbeat); sseClients.delete(res); }
    }, 25000);

    req.on('close', () => {
        clearInterval(heartbeat);
        sseClients.delete(res);
    });
});

app.post('/sync', syncLimiter, async (req, res) => {
    const { playerId } = req.body;
    if (isSyncing) return res.status(429).json({ error: "Une synchro est déjà en cours" });
    
    // ⚡ FIX : Lancement asynchrone pour ne pas faire planter ton site avec un "Timeout"
    syncAllPlayers(playerId || 'all').catch(console.error);
    
    res.status(202).json({ message: "Synchronisation lancée en arrière-plan. Les matchs apparaîtront d'ici peu." });
});

app.get('/test-send', authenticateToken, async (req, res) => {
    try {
        const channelId = await getConfig('discord_channel_id');
        if (!channelId) return res.status(400).send("Aucun ID de Salon Discord configuré dans le panel d'administration.");

        const embed = new EmbedBuilder()
            .setTitle("🔌 TEST DE CONNEXION BOT")
            .setColor(0x10b981)
            .setDescription("La liaison entre le serveur KSL et moi fonctionne parfaitement ! ✅")
            .setFooter({ text: "Test manuel via /test-send" })
            .setTimestamp();
            
        await sendDiscordMessage(channelId, { embeds: [embed] });
        res.status(200).send("Message de test envoyé !");
    } catch (e) {
        res.status(500).send(e.message);
    }
});

app.get('/test-match', authenticateToken, async (req, res) => {
    try {
        const allConfigPlayers = await getPlayers();
        const appUrl = await getConfig('app_url', 'http://localhost:5173');
        const channelId = await getConfig('discord_channel_id');
        if (!channelId) return res.status(400).send("Aucun ID de Salon Discord configuré.");

        const row = await db.get("SELECT data FROM matches WHERE type = 'ranked' ORDER BY date DESC LIMIT 1");
        if (!row) return res.status(404).send("Aucun match classé en base de données pour simuler l'envoi.");
        
        const sampleMatch = JSON.parse(row.data);
        const latestMatchId = sampleMatch.id;

        const rows = await db.all("SELECT data FROM matches WHERE id LIKE ?", [`${latestMatchId}_%`]);
        const playersInLastMatch = rows.map(r => JSON.parse(r.data));

        await announceNewMatches(playersInLastMatch, allConfigPlayers, appUrl, true);
        
        res.status(200).send("Faux match envoyé sur Discord avec succès ! Va vérifier ton channel !");
    } catch (e) {
        res.status(500).send(e.message);
    }
});

app.get('/test-report', authenticateToken, async (req, res) => {
    try {
        const row = await db.get("SELECT date FROM matches WHERE type = 'ranked' ORDER BY date DESC LIMIT 1");
        if (!row) return res.status(404).send("Aucun match classé en base de données pour faire le rapport.");
        
        await generateDailyReport(true, row.date);
        
        res.status(200).send("Faux rapport journalier envoyé sur Discord avec succès !");
    } catch (e) {
        res.status(500).send(e.message);
    }
});

app.get('/trigger-report', authenticateToken, async (req, res) => {
    try {
        await generateDailyReport(true);
        res.sendStatus(200);
    } catch (e) {
        res.status(500).send(e.message);
    }
});

// --- POLLING MALIN ---
// On synchronise plus souvent quand les gens jouent (soir + week-end) et plus
// lentement la journée, pour rester réactif tout en économisant le quota API.
// Le cron tourne toutes les minutes mais ne déclenche une sync que si le rythme
// courant (2/5/15 min selon l'heure) est atteint.
const getPollingIntervalMin = () => {
    const paris = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
    const h = paris.getHours();
    const day = paris.getDay(); // 0 = dimanche, 6 = samedi
    const isWeekend = day === 0 || day === 6;
    const isEvening = h >= 18 || h < 1;          // 18h → 01h : prime time
    const isDaytimeActive = h >= 10 && h < 18;   // journée

    if (isEvening) return 2;                       // soirée : ultra réactif
    if (isWeekend && isDaytimeActive) return 3;    // week-end après-midi
    if (isDaytimeActive) return 5;                 // semaine en journée
    return 15;                                     // nuit profonde / heures creuses
};

let lastSyncAt = 0;
cron.schedule('* * * * *', () => {
    const intervalMs = getPollingIntervalMin() * 60 * 1000;
    if (Date.now() - lastSyncAt >= intervalMs) {
        lastSyncAt = Date.now();
        syncAllPlayers('all').catch(e => console.error("Sync auto:", e.message));
    }
});

cron.schedule('0 1 * * *', () => { generateDailyReport(false); }, { timezone: "Europe/Paris" });

app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Serveur Backend lancé et optimisé sur le port ${PORT}`);
});