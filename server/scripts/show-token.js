// Script utilitaire : affiche le token Discord stocké en DB.
// Usage : node server/scripts/show-token.js
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_FILE = path.join(__dirname, '..', 'database.sqlite');

const db = await open({ filename: DB_FILE, driver: sqlite3.Database });
const row = await db.get("SELECT value FROM config WHERE key='discord_bot_token'");
console.log('\n🤖 Token Discord stocké :\n');
console.log(row?.value || '(aucun token enregistré)');
console.log('');
await db.close();
