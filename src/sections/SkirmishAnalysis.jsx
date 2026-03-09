import React, { useMemo, useState } from 'react';
import { Users, Swords, Trophy, Target, Crosshair, Activity, Flame, Snowflake } from 'lucide-react';
import { Card, StatCard, MatchDetailModal } from '../components/UI';
import { calculateKD, calculateWinrate } from '../utils/calculations';
import { MatchHistoryTable } from '../components/MatchHistoryTable';

const getStreak = (matches) => {
    if (!matches || matches.length === 0) return { type: 'neutral', count: 0 };
    const sorted = [...matches].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    const firstResult = sorted[0].result === 'WIN' ? 'win' : 'loss';
    let count = 0;
    for (const m of sorted) {
        if ((m.result === 'WIN' ? 'win' : 'loss') === firstResult) count++; else break;
    }
    return { type: firstResult, count };
};

// --- CARTE INDIVIDUELLE SKIRMISH ---
const PlayerSkirmishCard = ({ player, matches, onSelectMatch, playersConfig }) => {
    const playerMatches = useMemo(() => {
        return matches.filter(m => m.playerId === player.id && m.type === 'skirmish').sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    }, [matches, player.id]);

    const stats = useMemo(() => {
        if (playerMatches.length === 0) return null;

        const wins = playerMatches.filter(m => m.result === 'WIN').length;
        const total = playerMatches.length;
        const totalKills = playerMatches.reduce((acc, m) => acc + (m.kills || 0), 0);
        const totalDeaths = playerMatches.reduce((acc, m) => acc + (m.deaths || 0), 0);
        const globalKD = calculateKD(totalKills, totalDeaths);
        const streak = getStreak(playerMatches);

        // Calcul ACS moyen
        const totalACS = playerMatches.reduce((acc, m) => acc + (m.acs || 0), 0);
        const avgACS = total > 0 ? Math.round(totalACS / total) : 0;

        const recentMatches = playerMatches.slice(0, 20);
        const recentWins = recentMatches.filter(m => m.result === 'WIN').length;
        const recentLosses = recentMatches.filter(m => m.result === 'LOSS').length;
        const recentWinrate = calculateWinrate(recentWins, recentMatches.length);
        const recentKills = recentMatches.reduce((acc, m) => acc + (m.kills || 0), 0);
        const recentDeaths = recentMatches.reduce((acc, m) => acc + (m.deaths || 0), 0);
        const recentKD = calculateKD(recentKills, recentDeaths);
        const kdDiff = (parseFloat(recentKD) - parseFloat(globalKD)).toFixed(2);

        let totalHS = 0, totalBS = 0, totalLS = 0;
        let validHitboxMatchesCount = 0;

        recentMatches.forEach(m => {
            if (m.bodyshots !== undefined && (m.bodyshots > 0 || m.legshots > 0 || m.headshots > 0)) {
                totalHS += (m.headshots || 0);
                totalBS += (m.bodyshots || 0);
                totalLS += (m.legshots || 0);
                validHitboxMatchesCount++;
            }
        });

        const totalHits = totalHS + totalBS + totalLS;
        const hasHitData = validHitboxMatchesCount > 0 && totalHits > 0;
        const hsPct = hasHitData ? Math.round((totalHS / totalHits) * 100) : 0;
        const bsPct = hasHitData ? Math.round((totalBS / totalHits) * 100) : 0;
        const lsPct = hasHitData ? Math.round((totalLS / totalHits) * 100) : 0;

        return {
            wins, total, wr: calculateWinrate(wins, total), kd: globalKD,
            streak, avgACS,
            recent: { wins: recentWins, losses: recentLosses, winrate: recentWinrate, kd: recentKD, kdDiff },
            hitbox: { hs: hsPct, bs: bsPct, ls: lsPct, hasData: hasHitData }
        };
    }, [playerMatches]);

    if (!playerMatches || playerMatches.length === 0 || !stats) return null;

    return (
        <Card className="flex flex-col overflow-hidden border-t-4 min-w-0" style={{ borderTopColor: player.color }}>
            <div className="p-4 sm:p-6 bg-gradient-to-b from-white/5 to-transparent border-b border-white/5 flex flex-col gap-4 sm:gap-6">

                {/* HEADER CARTE */}
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 w-full">
                    <div className="flex items-center gap-3 sm:gap-4 w-full sm:w-auto min-w-0">
                        <div className="relative shrink-0">
                            <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl flex items-center justify-center font-black text-2xl sm:text-3xl text-white shadow-lg border-2" style={{ backgroundColor: player.color, borderColor: 'rgba(255,255,255,0.2)' }}>
                                {player.name.charAt(0)}
                            </div>
                            {stats.streak.count >= 3 && (
                                <div className={`absolute -bottom-2 -right-2 px-2 py-0.5 rounded-full text-[10px] font-black uppercase flex items-center gap-1 border border-white/20 shadow-md z-10 ${stats.streak.type === 'win' ? 'bg-orange-500 text-white' : 'bg-blue-500 text-white'}`}>
                                    {stats.streak.type === 'win' ? <Flame size={10} /> : <Snowflake size={10} />}
                                    {stats.streak.count}
                                </div>
                            )}
                        </div>
                        <div className="flex flex-col min-w-0 flex-grow">
                            <h3 className="text-lg sm:text-2xl font-black text-white italic tracking-tighter uppercase leading-none truncate">{player.name}</h3>
                            <div className="text-xs sm:text-sm font-black mt-1.5 flex items-center gap-1 text-gray-400">
                                SKIRMISH DUELIST
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-3 bg-[#0f1923] p-2.5 sm:p-3 pr-3 sm:pr-4 rounded-xl border border-white/5 shadow-inner w-full sm:w-auto shrink-0">
                        <div className="w-12 h-12 sm:w-14 sm:h-14 shrink-0 flex items-center justify-center bg-black/40 rounded-lg border border-white/5 relative">
                            <Activity className="text-blue-400 w-6 h-6 sm:w-8 sm:h-8 drop-shadow-md" />
                        </div>
                        <div className="flex flex-col flex-grow min-w-[100px] sm:min-w-[120px]">
                            <span className="text-xs sm:text-sm font-black text-white tracking-widest uppercase leading-none truncate">SCORE MOYEN</span>
                            <span className="text-blue-400 font-bold text-sm sm:text-base mt-1">{stats.avgACS} ACS</span>
                        </div>
                    </div>
                </div>

                {/* GRILLE 3 COLONNES */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4">
                    {/* WINRATE RECENT */}
                    <div className="bg-[#0f1923] rounded-xl p-3 sm:p-4 border border-white/5 flex items-center gap-3 sm:gap-4 min-w-0">
                        <div className="relative w-12 h-12 sm:w-14 sm:h-14 rounded-full flex items-center justify-center shrink-0" style={{ background: `conic-gradient(#10b981 ${stats.recent.winrate}%, #ef4444 ${stats.recent.winrate}% 100%)` }}>
                            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-[#0f1923] rounded-full flex items-center justify-center flex-col shadow-[inset_0_2px_10px_rgba(0,0,0,0.5)]">
                                <span className="text-[8px] text-gray-500 font-bold uppercase mb-0.5">W/L</span>
                                <span className="text-[10px] sm:text-xs font-black text-white leading-none">{stats.recent.winrate}%</span>
                            </div>
                        </div>
                        <div className="flex flex-col min-w-0">
                            <span className="text-[9px] sm:text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-1 truncate">Récents (Skirmish)</span>
                            <div className="text-xs sm:text-sm font-black mb-1">
                                <span className="text-emerald-400">{stats.recent.wins}W</span> - <span className="text-red-400">{stats.recent.losses}L</span>
                            </div>
                            <div className="text-[9px] sm:text-[10px] font-bold flex flex-wrap items-center gap-1">
                                <span className="text-gray-500">K/D:</span>
                                <span className="text-white">{stats.recent.kd}</span>
                                {stats.recent.kdDiff > 0 ? <span className="text-emerald-400">(+{stats.recent.kdDiff})</span> : (stats.recent.kdDiff < 0 ? <span className="text-red-400">({stats.recent.kdDiff})</span> : null)}
                            </div>
                        </div>
                    </div>

                    {/* HITBOX */}
                    <div className="bg-[#0f1923] rounded-xl p-3 sm:p-4 border border-white/5 flex items-center justify-between gap-3 sm:gap-4 min-w-0">
                        <div className="flex flex-col gap-1.5 sm:gap-2 w-full max-w-[100px]">
                            <div className="flex justify-between items-center text-[9px] sm:text-[10px] font-bold border-b border-white/5 pb-1">
                                <span className="text-gray-400">Tête</span>
                                <span className="text-yellow-400">{stats.hitbox.hs}%</span>
                            </div>
                            <div className="flex justify-between items-center text-[9px] sm:text-[10px] font-bold border-b border-white/5 pb-1">
                                <span className="text-gray-400">Corps</span>
                                <span className="text-emerald-400">{stats.hitbox.bs}%</span>
                            </div>
                            <div className="flex justify-between items-center text-[9px] sm:text-[10px] font-bold">
                                <span className="text-gray-400">Jambes</span>
                                <span className="text-gray-500">{stats.hitbox.ls}%</span>
                            </div>
                        </div>
                        <div className="relative h-16 w-8 sm:h-20 sm:w-10 opacity-90 drop-shadow-md shrink-0">
                            <svg viewBox="0 0 100 200" className="w-full h-full">
                                <circle cx="50" cy="30" r="24" fill={stats.hitbox.hs > 20 ? "#facc15" : "#4b5563"} />
                                <path d="M20,65 Q50,55 80,65 L75,130 L25,130 Z" fill={stats.hitbox.bs > 60 ? "#10b981" : "#4b5563"} />
                                <rect x="25" y="135" width="20" height="60" rx="10" fill={stats.hitbox.ls > 10 ? "#9ca3af" : "#374151"} />
                                <rect x="55" y="135" width="20" height="60" rx="10" fill={stats.hitbox.ls > 10 ? "#9ca3af" : "#374151"} />
                            </svg>
                            {!stats.hitbox.hasData && <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded text-[8px] text-gray-400 font-bold text-center">Peu de<br />données</div>}
                        </div>
                    </div>

                    {/* STATS GLOBALES */}
                    <div className="bg-[#0f1923] rounded-xl p-3 sm:p-4 border border-white/5 flex flex-col justify-between min-w-0 md:col-span-1">
                        <div className="grid grid-cols-2 gap-2 mb-2 sm:mb-3">
                            <div>
                                <div className="text-[8px] sm:text-[9px] text-gray-500 uppercase font-bold">K/D Global</div>
                                <div className={`text-sm sm:text-lg font-black leading-none mt-1 ${stats.kd >= 1 ? 'text-white' : 'text-orange-400'}`}>{stats.kd}</div>
                            </div>
                            <div>
                                <div className="text-[8px] sm:text-[9px] text-gray-500 uppercase font-bold">Winrate</div>
                                <div className={`text-sm sm:text-lg font-black leading-none mt-1 ${stats.wr >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>{stats.wr}%</div>
                            </div>
                        </div>
                        <div className="mt-auto">
                            <div className="text-[8px] sm:text-[9px] text-gray-500 uppercase font-bold mb-1">Total Matchs 2v2</div>
                            <div className="text-white font-mono text-xs">{stats.total} parties jouées</div>
                        </div>
                    </div>
                </div>
            </div>

            {/* HISTORIQUE */}
            <div className="flex-grow bg-[#0f1923]/30 border-t border-white/5 max-h-[400px] overflow-y-auto custom-scrollbar">
                <MatchHistoryTable matches={playerMatches} onSelectMatch={onSelectMatch} mode="skirmish" playersConfig={playersConfig} />
            </div>
        </Card>
    );
};

// --- COMPOSANT PRINCIPAL ---
export const SkirmishAnalysis = ({ matches, selectedPlayerId, playersConfig, challengeStartDate }) => {
    const [selectedMatch, setSelectedMatch] = useState(null);

    // On filtre pour ne garder que le mode skirmish
    const skirmishData = useMemo(() => {
        let data = matches.filter(m => m.type === 'skirmish');

        if (selectedPlayerId !== 'all') {
            data = data.filter(m => m.playerId === selectedPlayerId);
        }

        if (challengeStartDate) {
            const startDate = new Date(challengeStartDate).getTime();
            data = data.filter(m => {
                const matchTime = m.timestamp ? m.timestamp * 1000 : new Date(m.date).getTime();
                return matchTime >= startDate;
            });
        }
        return data.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    }, [matches, selectedPlayerId, challengeStartDate]);

    const playersToShow = selectedPlayerId === 'all' ? playersConfig : playersConfig.filter(p => p.id === selectedPlayerId);

    if (skirmishData.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-[50vh] text-center">
                <Users size={48} className="text-gray-600 mb-4" />
                <h2 className="text-2xl font-black text-gray-500 uppercase">Aucun match Skirmish</h2>
                <p className="text-gray-600 mt-2">Jouez quelques parties en 2v2 pour voir vos statistiques ici.</p>
            </div>
        );
    }

    const totalMatches = skirmishData.length;
    const wins = skirmishData.filter(m => m.result === 'WIN').length;
    const winrate = Math.round((wins / totalMatches) * 100);
    const totalKills = skirmishData.reduce((acc, m) => acc + (m.kills || 0), 0);
    const totalDeaths = skirmishData.reduce((acc, m) => acc + (m.deaths || 0), 0);
    const kd = totalDeaths > 0 ? (totalKills / totalDeaths).toFixed(2) : totalKills;

    return (
        <div className="space-y-6 sm:space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 w-full min-w-0">
            {selectedMatch && <MatchDetailModal match={selectedMatch} playersConfig={playersConfig} onClose={() => setSelectedMatch(null)} />}

            <div>
                <h2 className="text-2xl font-black text-white uppercase tracking-tight flex items-center gap-3">
                    <Users className="text-[#ff4655]" /> Skirmish 2v2
                </h2>
                <p className="text-gray-400 text-sm mt-1">Analyse des performances par joueur dans le mode duo (Premier à 10 manches).</p>
            </div>

            {/* RECAP GLOBAL UNIQUEMENT SI "TOUS LES JOUEURS" EST SELECTIONNE */}
            {selectedPlayerId === 'all' && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <StatCard title="Matchs Globaux" value={totalMatches} icon={Swords} />
                    <StatCard
                        title="Winrate Groupe"
                        value={`${winrate}%`}
                        subtitle={`${wins} Victoires`}
                        icon={Trophy}
                        color={winrate >= 50 ? 'text-emerald-400' : 'text-red-400'}
                    />
                    <StatCard
                        title="K/D Groupe"
                        value={kd}
                        icon={Crosshair}
                        color={kd >= 1 ? 'text-emerald-400' : 'text-red-400'}
                    />
                    <StatCard title="Kills Totaux" value={totalKills} icon={Target} />
                </div>
            )}

            {/* GRILLE DES CAPSULES JOUEURS */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 sm:gap-8 mt-6 sm:mt-8 w-full min-w-0">
                {playersToShow.map(player => (
                    <PlayerSkirmishCard key={player.id} player={player} matches={matches} onSelectMatch={setSelectedMatch} playersConfig={playersConfig} />
                ))}
            </div>
        </div>
    );
};