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

// --- IMPORT DU BOT DISCORD ---
import { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, REST, Routes } from 'discord.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3001;
const DB_FILE = path.join(__dirname, 'database.sqlite');
const API_BASE = "https://api.henrikdev.xyz/valorant";

app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));

let db;

// --- INITIALISATION DU CLIENT DISCORD ---
const discordClient = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent 
    ]
});

// --- INITIALISATION DE LA BASE DE DONNÉES ---
(async () => {
    db = await open({ filename: DB_FILE, driver: sqlite3.Database });
    
    await db.exec('PRAGMA journal_mode = WAL;');
    
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
const getPlayers = async () => await db.all("SELECT * FROM players");
const getApiKeys = async () => (await db.all("SELECT key FROM api_keys")).map(r => r.key);

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

    const formatLine = (p) => {
        const cfg     = findCfgByPuuid(allConfigPlayers, p.puuid);
        const tracked = cfg ? playersInMatch.find(t => t.playerId === cfg.id) : null;
        const isMvp   = p.puuid === matchMvpId;
        const inParty = !cfg && p.party_id && trackedPartyIds.has(p.party_id);
        const name    = p.name?.trim() || p.character || '—';
        const prefix  = cfg ? '★ ' : (inParty ? '▎ ' : '  ');
        const agent   = (p.character || '?').substring(0, 8).padEnd(9);
        const nameStr = (prefix + name).substring(0, 16).padEnd(16);
        const k       = String(p.stats?.kills   || 0).padStart(2);
        const d       = String(p.stats?.deaths  || 0).padStart(2);
        const a       = String(p.stats?.assists || 0).padStart(2);
        const acs     = String(Math.round((p.stats?.score || 0) / rounds)).padStart(4);
        let rr = '     ';
        // RR affiché uniquement pour les joueurs trackés (pas pour les coéquipiers randoms)
        if (tracked?.rrChange !== undefined) {
            const sign = tracked.rrChange > 0 ? '+' : '';
            rr = `${sign}${tracked.rrChange}RR`.padEnd(5);
        }
        return `${agent}${nameStr}${k}/${d}/${a} ${acs}acs ${rr}${isMvp ? ' 👑' : ''}`;
    };

    const tableHeader = `${'Agent'.padEnd(9)}${'Joueur'.padEnd(16)}K /D /A   ACS\n` + '─'.repeat(48);
    const formatTeam  = (team) => team.map(formatLine).join('\n');

    const resultEmoji = isWin ? '🏆' : (baseMatch.result === 'LOSS' ? '💔' : '🤝');
    const resultText  = isWin ? 'VICTOIRE' : (baseMatch.result === 'LOSS' ? 'DÉFAITE' : 'ÉGALITÉ');
    const color = view === 'blue' ? 0x3b82f6 : (view === 'red' ? 0xef4444 : (isWin ? 0x10b981 : (baseMatch.result === 'LOSS' ? 0xef4444 : 0x9ca3af)));

    const embed = new EmbedBuilder()
        .setTitle(`${resultEmoji} ${resultText} — ${(baseMatch.map || '?').toUpperCase()}`)
        .setURL(appUrl)
        .setColor(color)
        .setFooter({ text: 'KSL Tracker  •  ★ = joueur tracké  •  ▎ = même groupe' })
        .setTimestamp(baseMatch.timestamp ? baseMatch.timestamp * 1000 : new Date(baseMatch.date).getTime());

    const topTracked = [...playersInMatch].sort((a, b) => b.score - a.score)[0];
    if (topTracked?.agentImg) embed.setThumbnail(topTracked.agentImg);

    const blueWin   = blueScore > redScore;
    const blueLabel = `🟦 **ÉQUIPE BLEUE** — ${blueScore} rounds${blueWin ? ' ✅' : ''}`;
    const redLabel  = `🟥 **ÉQUIPE ROUGE** — ${redScore} rounds${!blueWin && blueScore !== redScore ? ' ✅' : ''}`;

    if (view === 'global') {
        let desc = `**Score : ${baseMatch.matchScore}** · Classé · ${rounds} rondes\n\n`;
        desc += `${blueLabel}\n\`\`\`\n${tableHeader}\n${formatTeam(blueTeam)}\n\`\`\`\n`;
        desc += `${redLabel}\n\`\`\`\n${tableHeader}\n${formatTeam(redTeam)}\n\`\`\``;
        if (desc.length > 4096) desc = desc.substring(0, 4090) + '\n...';
        embed.setDescription(desc);
    } else if (view === 'blue') {
        embed.setDescription(`${blueLabel}\n\`\`\`\n${tableHeader}\n${formatTeam(blueTeam)}\n\`\`\``);
    } else if (view === 'red') {
        embed.setDescription(`${redLabel}\n\`\`\`\n${tableHeader}\n${formatTeam(redTeam)}\n\`\`\``);
    }

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`match_global_${matchId}`).setLabel('📊 Les deux équipes').setStyle(view === 'global' ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`match_blue_${matchId}`).setLabel('🟦 Équipe Bleue').setStyle(view === 'blue' ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`match_red_${matchId}`).setLabel('🟥 Équipe Rouge').setStyle(view === 'red' ? ButtonStyle.Danger : ButtonStyle.Secondary)
    );

    return { embeds: [embed], components: [row] };
};

// ==========================================
// BOT DISCORD : CRÉATION DU RAPPORT QUOTIDIEN
// ==========================================
const buildDailyReportMessage = async (dateStr, view, allConfigPlayers, appUrl) => {
    const targetDateStr = dateStr.replace(/-/g, '/');

    const rows = await db.all('SELECT date, data FROM matches ORDER BY date DESC');
    const dailyRawMatches = rows.map(r => {
        const m = JSON.parse(r.data);
        m.dbDate = r.date; 
        return m;
    }).filter(m => m.type === 'ranked' && getParisDateString(new Date(m.dbDate)) === targetDateStr);

    if (dailyRawMatches.length === 0) return null;

    const uniqueGames = {};
    const playerStats = {};

    allConfigPlayers.forEach(p => {
        playerStats[p.id] = { name: p.name, wins: 0, losses: 0, rrChange: 0, kills: 0, deaths: 0, headshots: 0, shots: 0, games: 0 };
    });

    dailyRawMatches.forEach(m => {
        if (!uniqueGames[m.id]) {
            uniqueGames[m.id] = { id: m.id, map: m.map, result: m.result, score: m.matchScore, time: m.date, players: [], allPlayersRaw: m.allPlayers || [] };
        }

        const pConfig = allConfigPlayers.find(p => p.id === m.playerId);
        const playerName = pConfig ? pConfig.name : "Inconnu";
        const kd = m.deaths > 0 ? (m.kills / m.deaths).toFixed(2) : m.kills;
        const rrSign = m.rrChange > 0 ? '+' : '';
        const acs = m.acs || Math.round((m.score || 0) / (m.roundsPlayed || 1));
        const hsPct = m.totalShots > 0 ? Math.round((m.headshots / m.totalShots) * 100) : 0;

        // Récupère le party_id du joueur tracké dans le snapshot allPlayers
        let trackedPartyId = null;
        if (m.allPlayers && pConfig) {
            const me = m.allPlayers.find(ap => ap.puuid === pConfig.puuid)
                || m.allPlayers.find(ap => ap.character === m.agent && ap.team === m.myTeam);
            trackedPartyId = me?.party_id || null;
        }

        uniqueGames[m.id].players.push({ name: playerName, agent: m.agent || "?", rr: `${rrSign}${m.rrChange}`, kd: kd, result: m.result, acs: acs, hs: hsPct, partyId: trackedPartyId });

        if (playerStats[m.playerId]) {
            const p = playerStats[m.playerId];
            p.games++;
            if (m.result === 'WIN') p.wins++; else p.losses++;
            p.rrChange += m.rrChange; p.kills += m.kills; p.deaths += m.deaths; p.headshots += (m.headshots || 0); p.shots += (m.totalShots || 0);
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

    const totalRRDay = activePlayers.reduce((acc, p) => acc + p.rrChange, 0);

    const embed = new EmbedBuilder()
        .setTitle(`📊 RAPPORT QUOTIDIEN • ${targetDateStr}`)
        .setURL(appUrl)
        .setColor(color)
        .setThumbnail("https://media.discordapp.net/attachments/1070058980836540467/1164570087799562300/valorant-logo.png")
        .setFooter({ text: "KSL Tracker • Interactif" })
        .setTimestamp();

    if (view === 'summary') {
        embed.addFields({ name: `${weatherEmoji} Bilan de l'Escouade`, value: `**Météo :** ${weatherTitle}\n**Winrate :** ${globalWinrate}% (${totalWins}W - ${totalUniqueGames - totalWins}L)\n**Rentabilité :** ${totalRRDay > 0 ? '+' : ''}${totalRRDay} RR globaux`, inline: false });

        let fameText = "";
        if (mvp && mvp.rrChange > 0) fameText += `👑 **MVP :** ${mvp.name} (*+${mvp.rrChange} RR*)\n`;
        if (butcher && butcher.name !== mvp?.name) fameText += `🔪 **Boucher :** ${butcher.name} (*${(butcher.deaths > 0 ? butcher.kills/butcher.deaths : butcher.kills).toFixed(2)} K/D*)\n`;
        if (sniper && sniper.shots > 0) fameText += `🎯 **Sniper :** ${sniper.name} (*${Math.round((sniper.headshots/sniper.shots)*100)}% HS*)\n`;
        if (loser && loser.rrChange < 0) fameText += `🤡 **Poids Mort :** ${loser.name} (*${loser.rrChange} RR*)\n`;

        embed.addFields({ name: "🏆 Tableau d'Honneur", value: fameText || "Pas de trophées marquants aujourd'hui.", inline: false });
        embed.setDescription(`*Cliquez sur le bouton ci-dessous pour voir le détail des parties de la journée.*`);
    } else if (view === 'log') {
        let gamesLog = "";
        uniqueGamesList.forEach(g => {
            const icon = g.result === 'WIN' ? "🟢" : (g.result === 'DRAW' ? "⚪" : "🔴");
            const scoreText = g.score ? `**${g.score}**` : "";
            gamesLog += `${icon} **${g.map.toUpperCase()}** - ${scoreText}\n`;
            g.players.sort((a, b) => parseInt(b.rr) - parseInt(a.rr));

            // Pour chaque tracké, retrouve ses coéquipiers non-trackés du même groupe
            // afin d'afficher la composition complète du duo/trio.
            const trackedPuuids = new Set();
            (g.allPlayersRaw || []).forEach(ap => {
                if (findCfgByPuuid(allConfigPlayers, ap.puuid)) trackedPuuids.add(ap.puuid);
            });
            const partiesShown = new Set();

            g.players.forEach(p => {
                gamesLog += `> \`${p.agent.padEnd(9)}\` **${p.name}** : **${p.rr} RR** | ${p.kd} K/D | ${p.acs} ACS | ${p.hs}% HS\n`;

                // Coéquipiers non-trackés du même party_id (1 seule fois par groupe)
                if (p.partyId && !partiesShown.has(p.partyId)) {
                    partiesShown.add(p.partyId);
                    const mates = (g.allPlayersRaw || []).filter(ap =>
                        ap.party_id === p.partyId
                        && !trackedPuuids.has(ap.puuid)
                    );
                    mates.forEach(mate => {
                        const mateName = mate.name?.trim() || mate.character || 'Inconnu';
                        const mateAgent = (mate.character || '?').padEnd(9);
                        gamesLog += `> ┗ \`${mateAgent}\` *${mateName}* (groupe, non tracké)\n`;
                    });
                }
            });
            gamesLog += "\n";
        });
        if (gamesLog.length > 3900) gamesLog = gamesLog.substring(0, 3900) + "\n... *[Journal tronqué]*";
        embed.setDescription(`**📝 Journal détaillé des Matchs**\n\n${gamesLog}`);
    }

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`report_summary_${dateStr}`).setLabel('🏆 Bilan & Trophées').setStyle(view === 'summary' ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`report_log_${dateStr}`).setLabel('📝 Journal des Matchs').setStyle(view === 'log' ? ButtonStyle.Primary : ButtonStyle.Secondary)
    );

    return { embeds: [embed], components: [row] };
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

    const commands = [
        { name: 'classement', description: '🏆 Classement KSL — Rang et RR du challenge' },
        {
            name: 'stats',
            description: '📊 Stats ranked récentes d\'un joueur',
            options: [{ type: 3, name: 'joueur', description: 'Joueur KSL', required: false, choices }]
        },
        { name: 'rapport', description: '📋 Génère le rapport journalier maintenant' },
    ];

    try {
        const rest = new REST({ version: '10' }).setToken(discordClient.token);
        await rest.put(Routes.applicationCommands(discordClient.application.id), { body: commands });
        console.log('✅ Slash commands Discord enregistrées.');
    } catch (e) {
        console.error('❌ Slash commands — erreur enregistrement :', e.message);
    }
});

discordClient.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const prefix = '!';
    if (!message.content.startsWith(prefix)) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    if (command === 'ping') {
        message.reply('🏓 **Pong !** Le KSL Tracker est en ligne et opérationnel.');
    }

    if (command === 'stats') {
        const playerName = args.join(' ');
        if (!playerName) return message.reply("❌ Précise un joueur ! Exemple : `!stats Tenz`");

        const players = await getPlayers();
        const target = players.find(p => p.name.toLowerCase() === playerName.toLowerCase());
        if (!target) return message.reply(`❌ Joueur **${playerName}** introuvable dans la liste du tracker.`);

        const rows = await db.all("SELECT data FROM matches WHERE player_id = ? AND data LIKE '%\"type\":\"ranked\"%' ORDER BY date DESC LIMIT 20", [target.id]);
        if (rows.length === 0) return message.reply(`⚠️ Aucun match classé trouvé pour **${target.name}**.`);

        let wins = 0, kills = 0, deaths = 0, rr = 0;
        rows.forEach(r => {
            const m = JSON.parse(r.data);
            if (m.result === 'WIN') wins++;
            kills += (m.kills || 0);
            deaths += (m.deaths || 0);
            rr += (m.rrChange || 0);
        });

        const kd = deaths > 0 ? (kills / deaths).toFixed(2) : kills;
        const winrate = Math.round((wins / rows.length) * 100);

        const embed = new EmbedBuilder()
            .setTitle(`📊 Stats récentes (Ranked) : ${target.name}`)
            .setColor(parseInt(target.color.replace('#', ''), 16) || 0xff4655)
            .setDescription(`Basé sur les **${rows.length} derniers matchs** classés.`)
            .addFields(
                { name: 'Victoires', value: `${wins}W - ${rows.length - wins}L (${winrate}%)`, inline: true },
                { name: 'K/D Global', value: `${kd}`, inline: true },
                { name: 'RR Généré', value: `${rr > 0 ? '+' : ''}${rr} RR`, inline: true }
            );

        message.reply({ embeds: [embed] });
    }
});

discordClient.on('interactionCreate', async interaction => {
    const allConfigPlayers = await getPlayers();
    const appUrl = await getConfig('app_url', 'http://localhost:5173');

    // ===== SLASH COMMANDS =====
    if (interaction.isChatInputCommand()) {
        const { commandName } = interaction;

        if (commandName === 'classement') {
            await interaction.deferReply();
            const challengeStart = await getConfig('challenge_start_date', '2024-01-01T00:00');
            const startTs = new Date(challengeStart).getTime();

            const stats = await Promise.all(allConfigPlayers.map(async p => {
                const rows = await db.all(
                    "SELECT data FROM matches WHERE player_id = ? AND date >= ? AND data LIKE '%\"type\":\"ranked\"%' ORDER BY date DESC",
                    [p.id, startTs]
                );
                let rrTotal = 0, wins = 0, currentRank = 'Non classé', rankValue = 0;
                rows.forEach(r => { const m = JSON.parse(r.data); rrTotal += (m.rrChange || 0); if (m.result === 'WIN') wins++; });
                if (rows.length > 0) { const last = JSON.parse(rows[0].data); currentRank = last.currentRank || 'Non classé'; rankValue = last.rankValue || 0; }
                return { name: p.name, rrTotal, wins, games: rows.length, winrate: rows.length > 0 ? Math.round(wins / rows.length * 100) : 0, currentRank, rankValue };
            }));

            stats.sort((a, b) => b.rankValue - a.rankValue || b.rrTotal - a.rrTotal);
            const medals = ['🥇', '🥈', '🥉'];
            const startFr = new Date(challengeStart).toLocaleDateString('fr-FR');
            const lines = stats.filter(p => p.games > 0).map((p, i) => {
                const sign = p.rrTotal > 0 ? '+' : '';
                return `${medals[i] || `**${i + 1}.**`} **${p.name}** — ${p.currentRank}\n> ${sign}${p.rrTotal} RR • ${p.games} games • ${p.winrate}% WR`;
            }).join('\n\n');

            const embed = new EmbedBuilder()
                .setTitle('🏆 Classement KSL — Challenge Actuel')
                .setColor(0xffd700)
                .setDescription(lines || '*Aucune donnée disponible.*')
                .setFooter({ text: `Depuis le ${startFr}` })
                .setTimestamp();
            await interaction.editReply({ embeds: [embed] });
        }

        else if (commandName === 'stats') {
            await interaction.deferReply();
            const playerId = interaction.options.getString('joueur');
            const target = playerId ? allConfigPlayers.find(p => p.id === playerId) : allConfigPlayers[0];
            if (!target) { await interaction.editReply({ content: '❌ Joueur introuvable.' }); return; }

            const rows = await db.all(
                "SELECT data FROM matches WHERE player_id = ? AND data LIKE '%\"type\":\"ranked\"%' ORDER BY date DESC LIMIT 20",
                [target.id]
            );
            if (rows.length === 0) { await interaction.editReply({ content: `⚠️ Aucun match classé pour **${target.name}**.` }); return; }

            let wins = 0, kills = 0, deaths = 0, assists = 0, rrTotal = 0, acsSum = 0, currentRank = 'Inconnu';
            rows.forEach(r => {
                const m = JSON.parse(r.data);
                if (m.result === 'WIN') wins++;
                kills += m.kills || 0; deaths += m.deaths || 0; assists += m.assists || 0;
                rrTotal += m.rrChange || 0; acsSum += m.acs || 0;
            });
            currentRank = JSON.parse(rows[0].data).currentRank || 'Inconnu';
            const kd = deaths > 0 ? (kills / deaths).toFixed(2) : kills;
            const winrate = Math.round((wins / rows.length) * 100);
            const avgAcs = Math.round(acsSum / rows.length);
            const sign = rrTotal > 0 ? '+' : '';
            const color = parseInt((target.color || '#ff4655').replace('#', ''), 16) || 0xff4655;

            const embed = new EmbedBuilder()
                .setTitle(`📊 ${target.name} — Stats Ranked`)
                .setColor(color)
                .setDescription(`*${rows.length} derniers matchs • ${currentRank}*`)
                .addFields(
                    { name: '🏆 W/L', value: `**${wins}W** — ${rows.length - wins}L\n${winrate}% WR`, inline: true },
                    { name: '⚔️ K/D/A', value: `**${kd}** K/D\n${Math.round(kills/rows.length)}/${Math.round(deaths/rows.length)}/${Math.round(assists/rows.length)} moy.`, inline: true },
                    { name: '💥 Perf.', value: `**${avgAcs}** ACS moy.\n${sign}${rrTotal} RR total`, inline: true }
                )
                .setTimestamp();
            await interaction.editReply({ embeds: [embed] });
        }

        else if (commandName === 'rapport') {
            await interaction.deferReply();
            await generateDailyReport(true);
            await interaction.editReply({ content: '✅ Rapport journalier généré et envoyé !' });
        }
        return;
    }

    // ===== BOUTONS =====
    if (!interaction.isButton()) return;

    const customId = interaction.customId;

    if (customId.startsWith('match_')) {
        await interaction.deferUpdate();
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
    else if (customId.startsWith('report_')) {
        await interaction.deferUpdate();
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

app.get('/api/admin/config', authenticateToken, async (req, res) => {
    const discord_bot_token = await getConfig('discord_bot_token');
    const discord_channel_id = await getConfig('discord_channel_id');
    const app_url = await getConfig('app_url');
    const challenge_start_date = await getConfig('challenge_start_date');
    res.json({ discord_bot_token, discord_channel_id, app_url, challenge_start_date });
});

app.post('/api/admin/config', authenticateToken, async (req, res) => {
    const { discord_bot_token, discord_channel_id, app_url, challenge_start_date } = req.body;
    if (discord_bot_token !== undefined) await db.run("UPDATE config SET value = ? WHERE key = 'discord_bot_token'", [discord_bot_token]);
    if (discord_channel_id !== undefined) await db.run("UPDATE config SET value = ? WHERE key = 'discord_channel_id'", [discord_channel_id]);
    if (app_url !== undefined) await db.run("UPDATE config SET value = ? WHERE key = 'app_url'", [app_url]);
    if (challenge_start_date !== undefined) await db.run("UPDATE config SET value = ? WHERE key = 'challenge_start_date'", [challenge_start_date]);
    res.json({ message: "Configuration sauvegardée (Redémarrez le serveur si vous avez changé le Token du Bot)" });
});

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

app.put('/api/admin/players/:id', authenticateToken, async (req, res) => {
    const { name, tag, color } = req.body;
    try {
        await db.run(
            "UPDATE players SET name = ?, tag = ?, color = ? WHERE id = ?",
            [name, tag, color, req.params.id]
        );
        res.json({ message: "Joueur mis à jour avec succès" });
    } catch (e) {
        res.status(500).json({ error: "Erreur lors de la mise à jour" });
    }
});

app.delete('/api/admin/players/:id', authenticateToken, async (req, res) => {
    await db.run("DELETE FROM players WHERE id = ?", [req.params.id]);
    res.json({ message: "Joueur supprimé" });
});

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
    
    const shuffled = [...players].sort(() => 0.5 - Math.random());
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
    
    round1.sort(() => 0.5 - Math.random());
    rounds.push(round1);

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
// BACKFILL RETROACTIF DES NOMS (kill events)
// ==========================================

app.post('/api/admin/backfill-names', authenticateToken, async (req, res) => {
    try {
        const apiKeys = await getApiKeys();
        if (apiKeys.length === 0) return res.status(500).json({ error: 'Aucune clé API configurée.' });

        // Charge tous les enregistrements de matchs
        const allRows = await db.all("SELECT id, data FROM matches");

        // Groupe les rows par vrai match ID (le champ id stocké est matchId_playerId)
        const byMatchId = {};
        for (const row of allRows) {
            try {
                const data = JSON.parse(row.data);
                const realId = data.id; // vrai identifiant Riot du match
                if (!realId) continue;
                if (!byMatchId[realId]) byMatchId[realId] = [];
                byMatchId[realId].push({ rowId: row.id, data });
            } catch (e) { void e; }
        }

        const uniqueIds = Object.keys(byMatchId);
        let fetched = 0, updated = 0, skipped = 0;
        const errors = [];

        for (const matchId of uniqueIds) {
            const group = byMatchId[matchId];

            // On saute si tous les joueurs ont déjà un nom
            const needsBackfill = group.some(r =>
                (r.data.allPlayers || []).some(p => !p.name?.trim())
            );
            if (!needsBackfill) { skipped++; continue; }

            try {
                const url = `${API_BASE}/v3/match/${matchId}`;
                const resp = await fetchWithRetry(url, apiKeys, {}, 3);
                if (!resp.ok) { errors.push(`${matchId}: HTTP ${resp.status}`); continue; }
                const json = await resp.json();
                const m = json.data;
                if (!m) continue;
                fetched++;

                // Carte puuid → display name depuis les kill events
                const kills = m.kills || m.kill_events || [];
                const nameMap = {};
                kills.forEach(k => {
                    if (k.killer_puuid && k.killer_display_name) nameMap[k.killer_puuid] = k.killer_display_name;
                    if (k.victim_puuid && k.victim_display_name) nameMap[k.victim_puuid] = k.victim_display_name;
                });
                if (Object.keys(nameMap).length === 0) continue;

                // Met à jour chaque enregistrement DB pour ce match
                for (const row of group) {
                    let changed = false;
                    const updatedPlayers = (row.data.allPlayers || []).map(p => {
                        if (!p.name?.trim() && p.puuid && nameMap[p.puuid]) {
                            const parts = nameMap[p.puuid].split('#');
                            changed = true;
                            return { ...p, name: parts[0] || p.name, tag: parts[1] || p.tag };
                        }
                        return p;
                    });
                    if (changed) {
                        row.data.allPlayers = updatedPlayers;
                        await db.run("UPDATE matches SET data = ? WHERE id = ?",
                            [JSON.stringify(row.data), row.rowId]);
                        updated++;
                    }
                }

                await new Promise(r => setTimeout(r, 250)); // respect rate limit
            } catch (e) {
                errors.push(`${matchId}: ${e.message}`);
            }
        }

        console.log(`✅ Backfill noms : ${fetched} matchs re-fetchés, ${updated} enregistrements mis à jour, ${skipped} ignorés.`);
        res.json({ fetched, updated, skipped, total: uniqueIds.length, errors: errors.slice(0, 20) });
    } catch (e) {
        console.error('❌ Backfill error:', e.message);
        res.status(500).json({ error: e.message });
    }
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

    // DM
    try {
      const url = `${API_BASE}/v3/matches/${region}/${encodedName}/${encodedTag}?size=${FETCH_SIZE}${cacheBuster}`;
      const dmResponse = await fetchWithRetry(url, apiKeys, { headers });
      const dmData = dmResponse.ok ? await dmResponse.json().catch(() => ({ data: [] })) : { data: [] };
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
          allPlayers: (m.players?.all_players || []).map(p => { const c = findCfgByPuuid(allConfigPlayers, p.puuid); return c ? { ...p, name: c.name, tag: c.tag } : p; }),
          date: m.metadata.game_start_patched, timestamp: m.metadata.game_start, map: m.metadata.map
        };
      }).filter(Boolean);
      newMatches = [...newMatches, ...cleanDmMatches];
    } catch (e) {}

    await delay(500);

    // TDM
    try {
      const url = `${API_BASE}/v3/matches/${region}/${encodedName}/${encodedTag}?size=${FETCH_SIZE}${cacheBuster}`;
      const tdmResponse = await fetchWithRetry(url, apiKeys, { headers });
      const tdmData = tdmResponse.ok ? await tdmResponse.json().catch(() => ({ data: [] })) : { data: [] };
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
          allPlayers: (m.players?.all_players || []).map(p => { const c = findCfgByPuuid(allConfigPlayers, p.puuid); return c ? { ...p, name: c.name, tag: c.tag } : p; })
        };
      }).filter(Boolean);
      newMatches = [...newMatches, ...cleanTdmMatches];
    } catch (e) {}

    await delay(500);

    // SKIRMISH
    try {
      const url = `${API_BASE}/v3/matches/${region}/${encodedName}/${encodedTag}?size=${FETCH_SIZE}${cacheBuster}`;
      const skirmishResponse = await fetchWithRetry(url, apiKeys, { headers });
      const skirmishData = skirmishResponse.ok ? await skirmishResponse.json().catch(() => ({ data: [] })) : { data: [] };
      
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
            allPlayers: (m.players?.all_players || []).map(p => { const c = findCfgByPuuid(allConfigPlayers, p.puuid); return c ? { ...p, name: c.name, tag: c.tag } : p; })
          };
      }).filter(Boolean);
      newMatches = [...newMatches, ...cleanSkirmishMatches];
    } catch (e) {
      console.error(`❌ Erreur Fetch Skirmish pour ${player.name}:`, e.message);
    }

    await delay(500);

    // RANKED
    try {
      const url = `${API_BASE}/v3/matches/${region}/${encodedName}/${encodedTag}?size=${FETCH_SIZE}${cacheBuster}`;
      const compResponse = await fetchWithRetry(url, apiKeys, { headers });
      const compData = compResponse.ok ? await compResponse.json().catch(() => ({ data: [] })) : { data: [] };
      
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
          sides: { atkWins, atkRounds, defWins, defRounds },
          plants,
          defuses,
          plantSites,
          weaponStats,
          deathCoordinates,
          roundDetails,
          timeline: timeline, 
          adr: Math.round((playerStats.damage_made || 0) / rp),
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
            "SELECT data FROM matches WHERE player_id = ? AND data LIKE '%\"type\":\"ranked\"%' AND id != ? ORDER BY date DESC LIMIT 1",
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
        const rankEmbed = new EmbedBuilder()
            .setTitle(isUp ? `🎉 RANK UP — ${cfg.name} !` : `📉 RANK DOWN — ${cfg.name}`)
            .setColor(isUp ? 0xffd700 : 0x7c3aed)
            .setDescription(isUp
                ? `**${prev.currentRank}** → **${match.currentRank}**\n\n🏅 Félicitations à **${cfg.name}** pour la montée de rang !`
                : `**${prev.currentRank}** → **${match.currentRank}**\n\n💪 Courage **${cfg.name}**, la remontée arrive !`)
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
                    if (isNew) totalAdded++; // ⚡ FIX : N'ajoute au compteur que les VRAIS nouveaux matchs
                    if (isNew && match.type === 'ranked') {
                        newlyAddedRankedMatches.push(match);
                    }
                }
            }
            await db.exec('COMMIT');
        }
        
        console.log(`\n✅ Fin du scan complet. ${totalAdded} matchs traités/sauvegardés.`);

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

const generateDailyReport = async (isManual = false, forceDate = null) => {
    console.log(`📊 [RAPPORT] Génération (Manuel: ${isManual})...`);
    
    const channelId = await getConfig('discord_channel_id');
    if (!channelId) {
        console.log("⚠️ [RAPPORT] Aucun Channel ID Discord configuré, annulation.");
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

    const safeDateStr = dateStr.replace(/\//g, '-'); 
    const payload = await buildDailyReportMessage(safeDateStr, 'summary', allConfigPlayers, appUrl);
    
    if (payload) {
        await sendDiscordMessage(channelId, payload);
    } else if (isManual) {
        await sendDiscordMessage(channelId, { content: `🚫 **Rapport du ${dateTitle}** : Le calme plat. Aucune game classée enregistrée.` });
    }
};

// ==========================================
// ROUTES PUBLIQUES (FRONTEND CLASSIQUE)
// ==========================================

app.get('/history', async (req, res) => {
    try {
        const { start, end, limit = 5000, offset = 0 } = req.query;
        let query = 'SELECT id, data FROM matches'; // Ajout de 'id' pour le debug
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
        
        // ⚡ FIX : On gère les matchs corrompus un par un sans faire planter le serveur
        const matches = rows.map(row => {
            try {
                return JSON.parse(row.data);
            } catch (err) {
                console.error(`❌ Erreur JSON.parse ignorée sur le match ID : ${row.id}`);
                return null;
            }
        }).filter(Boolean); // On filtre/supprime les matchs null

        res.json({ matches });
    } catch (e) {
        // ⚡ FIX : On affiche la VRAIE erreur dans la console du serveur !
        console.error("❌ ERREUR CRITIQUE SUR LA ROUTE /history :", e);
        res.status(500).json({ matches: [], error: e.message });
    }
});

app.post('/sync', async (req, res) => {
    const { playerId } = req.body;
    if (isSyncing) return res.status(429).json({ error: "Une synchro est déjà en cours" });
    
    // ⚡ FIX : Lancement asynchrone pour ne pas faire planter ton site avec un "Timeout"
    syncAllPlayers(playerId || 'all').catch(console.error);
    
    res.status(202).json({ message: "Synchronisation lancée en arrière-plan. Les matchs apparaîtront d'ici peu." });
});

app.get('/test-send', async (req, res) => {
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

app.get('/test-match', async (req, res) => {
    try {
        const allConfigPlayers = await getPlayers();
        const appUrl = await getConfig('app_url', 'http://localhost:5173');
        const channelId = await getConfig('discord_channel_id');
        if (!channelId) return res.status(400).send("Aucun ID de Salon Discord configuré.");

        const row = await db.get("SELECT data FROM matches WHERE data LIKE '%\"type\":\"ranked\"%' ORDER BY date DESC LIMIT 1");
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
    console.log(`✅ Serveur Backend lancé et optimisé sur le port ${PORT}`);
});