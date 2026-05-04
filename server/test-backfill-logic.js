import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_FILE = path.join(__dirname, 'database.sqlite');

(async () => {
    const db = await open({ filename: DB_FILE, driver: sqlite3.Database });
    const allRows = await db.all("SELECT id, data FROM matches");
    console.log(`Total rows: ${allRows.length}`);

    const byMatchId = {};
    for (const row of allRows) {
        try {
            const data = JSON.parse(row.data);
            const realId = data.id;
            if (!realId) continue;
            if (!byMatchId[realId]) byMatchId[realId] = [];
            byMatchId[realId].push({ rowId: row.id, data });
        } catch (e) { void e; }
    }

    const uniqueIds = Object.keys(byMatchId);
    console.log(`Unique match IDs: ${uniqueIds.length}`);

    let needsCount = 0;
    let totalEmptyAcrossNeeded = 0;
    const exemples = [];
    for (const matchId of uniqueIds) {
        const group = byMatchId[matchId];
        const needsBackfill = group.some(r =>
            (r.data.allPlayers || []).some(p => !p.name?.trim())
        );
        if (needsBackfill) {
            needsCount++;
            const sample = group[0].data;
            const emptyCount = (sample.allPlayers || []).filter(p => !p.name?.trim()).length;
            totalEmptyAcrossNeeded += emptyCount;
            if (exemples.length < 3) exemples.push({ matchId, type: sample.type, emptyCount, total: sample.allPlayers?.length });
        }
    }

    console.log(`\nMatchs nécessitant backfill: ${needsCount}`);
    console.log(`Total joueurs vides dans ces matchs: ${totalEmptyAcrossNeeded}`);
    console.log(`Exemples:`, exemples);

    await db.close();
})();
