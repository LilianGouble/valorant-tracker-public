import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_FILE = path.join(__dirname, 'database.sqlite');

(async () => {
    const db = await open({ filename: DB_FILE, driver: sqlite3.Database });

    console.log("Inspection des noms dans allPlayers...\n");

    // Pioche 3 matchs récents
    const rows = await db.all("SELECT id, data FROM matches ORDER BY date DESC LIMIT 3");

    for (const row of rows) {
        const data = JSON.parse(row.data);
        console.log(`\n=== Match ${data.id} (${data.map}, ${data.date}) ===`);
        console.log(`Type: ${data.type}, Result: ${data.result}`);
        if (!data.allPlayers) { console.log("⚠️ allPlayers manquant"); continue; }

        data.allPlayers.forEach((p, i) => {
            const isEmpty = !p.name || !p.name.trim();
            const flag = isEmpty ? '❌' : '✅';
            console.log(`  ${flag} [${i}] team=${p.team} char=${p.character?.padEnd(10)} name="${p.name}" tag="${p.tag}" puuid=${p.puuid?.slice(0,8)}...`);
        });
    }

    // Stat globale
    const allRows = await db.all("SELECT data FROM matches");
    let totalPlayers = 0, emptyName = 0, withName = 0, suspectName = 0;
    for (const r of allRows) {
        try {
            const d = JSON.parse(r.data);
            (d.allPlayers || []).forEach(p => {
                totalPlayers++;
                if (!p.name || !p.name.trim()) emptyName++;
                else withName++;
                // Suspect : name === character
                if (p.name && p.character && p.name.toLowerCase() === p.character.toLowerCase()) suspectName++;
            });
        } catch (e) { void e; }
    }
    console.log(`\n📊 Stats globales :`);
    console.log(`  Total joueurs : ${totalPlayers}`);
    console.log(`  Avec nom : ${withName}`);
    console.log(`  Sans nom : ${emptyName}`);
    console.log(`  Suspect (name === character) : ${suspectName}`);

    await db.close();
})();
