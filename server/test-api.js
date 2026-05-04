import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_FILE = path.join(__dirname, 'database.sqlite');

(async () => {
    const name = "Isune";
    const tag = "KSL";
    const region = "eu";

    try {
        // 1. On récupère la clé API dans ta base de données
        const db = await open({ filename: DB_FILE, driver: sqlite3.Database });
        const keyRow = await db.get("SELECT key FROM api_keys LIMIT 1");
        const apiKey = keyRow ? keyRow.key : '';
        await db.close();

        if (!apiKey) {
            console.log("⚠️ Attention : Aucune clé API trouvée dans ta base de données ! L'API risque de refuser l'accès.");
        }

        console.log(`🔎 Interrogation de l'API pour : ${name}#${tag} (avec clé API)`);
        
        // 2. On fait la requête
        const url = `https://api.henrikdev.xyz/valorant/v3/matches/${region}/${encodeURIComponent(name)}/${encodeURIComponent(tag)}?size=5`;
        
        const options = { headers: {} };
        if (apiKey) options.headers['Authorization'] = apiKey;

        const res = await fetch(url, options);
        
        if (!res.ok) {
            console.log(`❌ L'API a renvoyé une erreur : ${res.status} ${res.statusText}`);
            return;
        }

        const data = await res.json();
        
        if (data.data && data.data.length > 0) {
            console.log("\n✅ Voici les 5 vrais derniers matchs :");
            data.data.forEach((m, i) => {
                const mapName = m.metadata.map ? m.metadata.map.padEnd(10) : "Inconnue".padEnd(10);
                console.log(`${i+1}. Mode: ${m.metadata.mode.padEnd(15)} | Map: ${mapName} | Date: ${m.metadata.game_start_patched}`);
            });
        } else {
            console.log("⚠️ L'API n'a trouvé absolument aucun match pour ce joueur.");
        }

    } catch (error) {
        console.error("❌ Erreur du script :", error.message);
    }
})();