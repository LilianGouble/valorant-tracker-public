import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_FILE = path.join(__dirname, 'database.sqlite');

(async () => {
    try {
        const db = await open({ filename: DB_FILE, driver: sqlite3.Database });
        
        console.log("📂 Ouverture de database.sqlite...");
        
        // On récupère les 5 matchs les plus récents (triés par date décroissante)
        const rows = await db.all("SELECT id, player_id, date FROM matches ORDER BY date DESC LIMIT 5");
        
        if (rows.length === 0) {
            console.log("⚠️ Aucun match trouvé dans la base de données.");
        } else {
            console.log("\n✅ Voici les 5 matchs les plus récents enregistrés :");
            rows.forEach((row, index) => {
                // On convertit le timestamp en date lisible
                const dateLisible = new Date(row.date).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
                console.log(`${index + 1}. Joueur: ${row.player_id.padEnd(20)} | Date: ${dateLisible} | ID Match: ${row.id}`);
            });
        }
        
        await db.close();
    } catch (error) {
        console.error("❌ Erreur lors de la lecture de la base :", error.message);
    }
})();