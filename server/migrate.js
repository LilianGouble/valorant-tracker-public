import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, 'data.json');
const DB_FILE = path.join(__dirname, 'database.sqlite');

async function migrate() {
    console.log("🚀 Démarrage de la migration...");

    // 1. Lire les données actuelles
    if (!fs.existsSync(DATA_FILE)) {
        console.error("❌ Aucun fichier data.json trouvé !");
        return;
    }
    
    const rawData = fs.readFileSync(DATA_FILE, 'utf8');
    const json = JSON.parse(rawData);
    const matches = json.matches || [];

    console.log(`📦 ${matches.length} matchs trouvés dans data.json.`);

    // 2. Créer la BDD SQLite
    const db = await open({
        filename: DB_FILE,
        driver: sqlite3.Database
    });

    // 3. Créer la table
    // On stocke tout le JSON du match dans une colonne 'data' pour l'instant (NoSQL style)
    // C'est le plus simple pour ne pas casser ton code frontend.
    await db.exec(`
        CREATE TABLE IF NOT EXISTS matches (
            id TEXT PRIMARY KEY,
            player_id TEXT,
            date INTEGER,
            data TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_player ON matches(player_id);
        CREATE INDEX IF NOT EXISTS idx_date ON matches(date);
    `);

    // 4. Insérer les données
    console.log("⏳ Insertion des données en cours...");
    
    await db.exec('BEGIN TRANSACTION'); // Pour la rapidité
    
    for (const match of matches) {
        // Clé unique composée : MatchID + PlayerID (car un match peut apparaître pour plusieurs joueurs)
        const uniqueId = `${match.id}_${match.playerId}`;
        const timestamp = new Date(match.date).getTime();

        await db.run(
            `INSERT OR IGNORE INTO matches (id, player_id, date, data) VALUES (?, ?, ?, ?)`,
            [uniqueId, match.playerId, timestamp, JSON.stringify(match)]
        );
    }

    await db.exec('COMMIT');

    console.log("✅ Migration terminée avec succès !");
    console.log(`📁 Base de données créée : ${DB_FILE}`);
}

migrate().catch(err => console.error(err));