import React, { useMemo, useState } from 'react';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer
} from 'recharts';
import {
    Crown, Zap, Trophy, Calendar, ChevronLeft, ChevronRight, List, Activity,
    Clock, Flame, Snowflake, Skull, User, Link2
} from 'lucide-react';
import { Card, MatchDetailModal } from '../components/UI';
import { RANK_TIERS, getRankIcon } from '../config/constants';
import { MatchHistoryTable } from '../components/MatchHistoryTable';
import { calculateKD, calculateWinrate } from '../utils/calculations';

const SQUAD_COLORS = {
    solo: '#3b82f6', duo: '#10b981', trio: '#f59e0b', quad: '#f97316', five: '#ef4444'
};

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

const getRankLabel = (value) => {
    const tier = RANK_TIERS.find(t => Math.abs(t.value - value) < 50);
    return tier ? tier.label : value;
};

const formatMatchTime = (dateString) => {
    return new Date(dateString).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
};

const SafeAgentImage = ({ src, alt, size = "w-8 h-8", className = "" }) => {
    if (!src) return (
        <div className={`${size} rounded bg-white/10 flex items-center justify-center border border-white/10 shrink-0 ${className}`}>
            <User size={12} className="text-gray-500" />
        </div>
    );
    return <img src={src} alt={alt} className={`${size} rounded bg-black object-cover shrink-0 ${className}`} />;
};

const RankProgressBar = ({ rr }) => {
    const percentage = Math.min(100, Math.max(0, rr));
    return (
        <div className="w-full bg-black/50 rounded-full h-1 mt-1.5 border border-white/5 relative overflow-hidden">
            <div
                className="bg-gradient-to-r from-emerald-500 to-cyan-400 h-full rounded-full transition-all duration-1000 relative"
                style={{ width: `${percentage}%` }}
            >
                <div className="absolute top-0 right-0 bottom-0 w-10 bg-gradient-to-r from-transparent to-white/30" />
            </div>
        </div>
    );
};

// --- BADGE JOUEUR DANS L'HISTORIQUE ---
const PlayerMatchBadge = ({ stats, partyColor, isGuest, playersConfig }) => {
    const playerConfig = !isGuest ? playersConfig.find(p => p.id === stats.playerId) : null;
    const borderColor = playerConfig?.color || '#6b7280';
    const playerName = playerConfig ? playerConfig.name : stats.name;

    const kd = stats.deaths > 0 ? (stats.kills / stats.deaths).toFixed(2) : stats.kills;
    const hs = stats.totalShots > 0 ? Math.round((stats.headshots / stats.totalShots) * 100) : 0;
    const rr = stats.rrChange;

    return (
        <div className={`flex items-center gap-2 p-1.5 rounded border w-[150px] sm:w-[160px] shrink-0 relative group overflow-hidden ${isGuest ? 'bg-white/5 border-white/5' : 'bg-[#0f1923] border-white/10'}`}>
            {partyColor && <div className="absolute left-0 top-0 bottom-0 w-1.5 z-10" style={{ backgroundColor: partyColor }} title="Membre du groupe" />}
            <div className={`w-1 h-6 rounded-full shrink-0 ${partyColor ? 'ml-2' : ''}`} style={{ backgroundColor: borderColor }}></div>
            <SafeAgentImage src={stats.agentImg} alt={stats.agent} size="w-6 h-6 sm:w-7 sm:h-7" />
            <div className="flex flex-col flex-grow min-w-0">
                <div className="flex items-center gap-1 w-full">
                    <span title={playerName} className={`text-[10px] sm:text-[11px] font-bold truncate leading-none ${isGuest ? 'text-gray-400 italic' : 'text-gray-200'}`}>
                        {playerName}
                    </span>
                    {partyColor && <Link2 size={10} style={{ color: partyColor }} className="shrink-0 text-white/70" />}
                </div>
                <div className="flex items-center gap-1 text-[9px] sm:text-[10px] font-mono leading-none mt-1">
                    {rr !== undefined && rr !== null && <span className={`font-black ${rr > 0 ? 'text-emerald-400' : (rr < 0 ? 'text-red-400' : 'text-gray-500')}`}>{rr > 0 ? '+' : ''}{rr}</span>}
                    <span className="text-gray-400 ml-auto">{kd}</span>
                    <span className="text-yellow-600">{hs}%</span>
                </div>
            </div>
        </div>
    );
};

// --- LISTE DES MATCHS ---
const DailyGamesList = ({ matches, onSelectMatch, playersConfig }) => {
    const [currentDateIndex, setCurrentDateIndex] = useState(0);

    const matchesByDate = useMemo(() => {
        const groupedByDate = {};
        const uniqueMatchesMap = {};

        matches.forEach(m => {
            if (!uniqueMatchesMap[m.id]) uniqueMatchesMap[m.id] = { meta: m, players: [] };
            uniqueMatchesMap[m.id].players.push(m);
        });

        Object.values(uniqueMatchesMap).forEach(uniqueMatch => {
            const dateObj = new Date(uniqueMatch.meta.date);
            const dateKey = dateObj.toLocaleDateString('fr-FR');
            if (!groupedByDate[dateKey]) groupedByDate[dateKey] = { dateObj: dateObj, matches: [] };
            groupedByDate[dateKey].matches.push(uniqueMatch);
        });

        return Object.entries(groupedByDate)
            .sort(([, a], [, b]) => b.dateObj - a.dateObj)
            .map(([dateString, data]) => ({
                dateString,
                matches: data.matches.sort((a, b) => new Date(b.meta.date) - new Date(a.meta.date))
            }));
    }, [matches]);

    const activeDateGroup = matchesByDate[currentDateIndex];
    const handlePrevDate = () => { if (currentDateIndex < matchesByDate.length - 1) setCurrentDateIndex(currentDateIndex + 1); };
    const handleNextDate = () => { if (currentDateIndex > 0) setCurrentDateIndex(currentDateIndex - 1); };

    const getPartyColor = (partyId, index) => {
        const colors = ['#3b82f6', '#8b5cf6', '#d946ef', '#f59e0b', '#10b981'];
        return colors[index % colors.length];
    };

    if (!activeDateGroup) {
        return (
            <div className="flex flex-col items-center justify-center h-40 bg-[#0f1923]/30 rounded-xl border border-white/5 border-dashed text-gray-500">
                <Skull size={32} className="mb-2 opacity-20" />
                <p className="text-sm">Aucune archive trouvée.</p>
            </div>
        );
    }

    return (
        <div className="bg-[#1c252e] rounded-xl border border-white/10 overflow-hidden shadow-xl min-w-0 w-full max-w-full">
            <div className="flex items-center justify-between bg-[#0f1923] p-3 border-b border-white/5 z-10 relative">
                <button onClick={handlePrevDate} disabled={currentDateIndex >= matchesByDate.length - 1} className="p-2 hover:bg-white/10 rounded-lg text-gray-400 disabled:opacity-20 transition-colors"><ChevronLeft size={20} /></button>
                <div className="flex flex-col items-center">
                    <span className="text-[10px] font-black text-gray-500 tracking-widest uppercase">ARCHIVES DU</span>
                    <span className="text-sm sm:text-base font-black text-white italic tracking-tighter uppercase">{activeDateGroup.dateString}</span>
                </div>
                <button onClick={handleNextDate} disabled={currentDateIndex === 0} className="p-2 hover:bg-white/10 rounded-lg text-gray-400 disabled:opacity-20 transition-colors"><ChevronRight size={20} /></button>
            </div>

            <div className="flex flex-col divide-y divide-white/5 max-h-[500px] overflow-y-auto overflow-x-hidden custom-scrollbar w-full">
                {activeDateGroup.matches.map((game) => {
                    const { meta, players } = game;
                    const isWin = meta.result === 'WIN';
                    const myPartyIds = new Set(players.map(p => p.partyId).filter(Boolean));
                    let displaySquad = [];

                    if (meta.allPlayers && myPartyIds.size > 0) {
                        displaySquad = meta.allPlayers.filter(p => p.party_id && myPartyIds.has(p.party_id));
                        displaySquad = displaySquad.map(rawPlayer => {
                            const trackedData = players.find(p => p.playerId === rawPlayer.puuid);
                            if (trackedData) return { ...trackedData, isGuest: false };
                            else return {
                                playerId: rawPlayer.puuid, name: rawPlayer.name, agent: rawPlayer.character,
                                agentImg: rawPlayer.assets?.agent?.small, kills: rawPlayer.stats?.kills || 0,
                                deaths: rawPlayer.stats?.deaths || 0, headshots: rawPlayer.stats?.headshots || 0,
                                totalShots: (rawPlayer.stats?.bodyshots + rawPlayer.stats?.legshots + rawPlayer.stats?.headshots) || 0,
                                partyId: rawPlayer.party_id, isGuest: true
                            };
                        });
                    } else {
                        displaySquad = players.map(p => ({ ...p, isGuest: false }));
                    }

                    const partyColors = {};
                    let colorIndex = 0;
                    myPartyIds.forEach(pId => { partyColors[pId] = getPartyColor(pId, colorIndex++); });

                    displaySquad.sort((a, b) => (a.isGuest === b.isGuest) ? 0 : a.isGuest ? 1 : -1);

                    return (
                        <div key={meta.id} onClick={() => onSelectMatch(meta)} className="group relative hover:bg-white/[0.02] transition-colors cursor-pointer w-full box-border">
                            <div className={`absolute left-0 top-0 bottom-0 w-1 sm:w-1.5 ${isWin ? 'bg-emerald-500' : 'bg-red-500'}`} />

                            <div className="flex flex-col lg:flex-row items-start lg:items-center py-3 px-4 sm:px-6 gap-3 sm:gap-4 w-full min-w-0">
                                <div className="flex flex-row lg:flex-col justify-between lg:justify-center items-center lg:items-start w-full lg:w-[140px] shrink-0 gap-2 lg:gap-1">
                                    <span className={`text-xs sm:text-sm font-black uppercase italic tracking-tighter ${isWin ? 'text-emerald-400' : 'text-red-400'}`}>
                                        {isWin ? 'VICTOIRE' : 'DÉFAITE'}
                                    </span>
                                    <div className="flex items-baseline gap-2 min-w-0">
                                        <span className="text-white font-black text-xs sm:text-sm uppercase tracking-wide truncate">{meta.map}</span>
                                        <span className="text-gray-400 font-mono text-[10px] shrink-0">{meta.matchScore}</span>
                                    </div>
                                    <div className="flex lg:hidden items-center gap-1 text-gray-500 text-[10px] font-bold">
                                        <Clock size={10} /> {formatMatchTime(meta.date)}
                                    </div>
                                </div>

                                <div className="flex flex-row flex-wrap gap-2 w-full min-w-0 py-1">
                                    {displaySquad.map((pStat) => (
                                        <PlayerMatchBadge key={pStat.playerId} stats={pStat} partyColor={pStat.partyId ? partyColors[pStat.partyId] : null} isGuest={pStat.isGuest} playersConfig={playersConfig} />
                                    ))}
                                </div>

                                <div className="hidden lg:flex items-center gap-2 text-gray-600 group-hover:text-white transition-colors ml-auto shrink-0 pl-2">
                                    <span className="text-[10px] font-bold"><Clock size={12} className="inline mr-1 mb-0.5" />{formatMatchTime(meta.date)}</span>
                                    <ChevronRight size={18} />
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

// --- CARTE INDIVIDUELLE ---
const PlayerRushCard = ({ player, matches, onSelectMatch, playersConfig }) => {
    const playerMatches = useMemo(() => {
        return matches.filter(m => m.playerId === player.id && m.type === 'ranked').sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    }, [matches, player.id]);

    const stats = useMemo(() => {
        if (playerMatches.length === 0) return null;

        const wins = playerMatches.filter(m => m.result === 'WIN').length;
        const total = playerMatches.length;
        const totalKills = playerMatches.reduce((acc, m) => acc + m.kills, 0);
        const totalDeaths = playerMatches.reduce((acc, m) => acc + m.deaths, 0);
        const globalKD = calculateKD(totalKills, totalDeaths);
        const totalRR = playerMatches.reduce((acc, m) => acc + m.rrChange, 0);
        const streak = getStreak(playerMatches);
        const currentRank = playerMatches[0].currentRank;
        const currentRR = playerMatches[0].currentRR;

        const recentMatches = playerMatches.slice(0, 20);
        const recentWins = recentMatches.filter(m => m.result === 'WIN').length;
        const recentLosses = recentMatches.filter(m => m.result === 'LOSS').length;
        const recentWinrate = calculateWinrate(recentWins, recentMatches.length);
        const recentKills = recentMatches.reduce((acc, m) => acc + m.kills, 0);
        const recentDeaths = recentMatches.reduce((acc, m) => acc + m.deaths, 0);
        const recentKD = calculateKD(recentKills, recentDeaths);
        const kdDiff = (recentKD - globalKD).toFixed(2);

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

        let squad = { solo: 0, duo: 0, trio: 0, quad: 0, five: 0 };
        playerMatches.forEach(m => {
            let partySize = 1;
            if (m.partyId && m.allPlayers) partySize = m.allPlayers.filter(p => p.party_id === m.partyId).length;
            if (partySize <= 1) squad.solo++;
            else if (partySize === 2) squad.duo++;
            else if (partySize === 3) squad.trio++;
            else if (partySize === 4) squad.quad++;
            else if (partySize >= 5) squad.five++;
        });

        return {
            wins, total, wr: calculateWinrate(wins, total), kd: globalKD,
            totalRR, streak, currentRank, currentRR, squad,
            recent: { wins: recentWins, losses: recentLosses, winrate: recentWinrate, kd: recentKD, kdDiff },
            hitbox: { hs: hsPct, bs: bsPct, ls: lsPct, hasData: hasHitData }
        };
    }, [playerMatches]);

    if (!playerMatches || playerMatches.length === 0 || !stats) return null;

    const squadDisplay = [
        { label: 'SOLO', count: stats.squad.solo, color: SQUAD_COLORS.solo },
        { label: 'DUO', count: stats.squad.duo, color: SQUAD_COLORS.duo },
        { label: 'TRIO', count: stats.squad.trio, color: SQUAD_COLORS.trio },
        { label: '5-STACK', count: stats.squad.five + stats.squad.quad, color: SQUAD_COLORS.five },
    ].filter(s => s.count > 0);

    return (
        <Card className="flex flex-col overflow-hidden border-t-4 min-w-0" style={{ borderTopColor: player.color }}>
            <div className="p-4 sm:p-6 bg-gradient-to-b from-white/5 to-transparent border-b border-white/5 flex flex-col gap-4 sm:gap-6">

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
                            <div className={`text-xs sm:text-sm font-black mt-1.5 flex items-center gap-1 ${stats.totalRR >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {stats.totalRR > 0 ? '↗ +' : '↘ '}{stats.totalRR} RR <span className="text-[9px] text-gray-500 uppercase mt-0.5 hidden sm:inline">(Session)</span>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-3 bg-[#0f1923] p-2.5 sm:p-3 pr-3 sm:pr-4 rounded-xl border border-white/5 shadow-inner w-full sm:w-auto shrink-0">
                        <div className="w-12 h-12 sm:w-14 sm:h-14 shrink-0 flex items-center justify-center bg-black/40 rounded-lg border border-white/5 relative">
                            <img src={getRankIcon(stats.currentRank)} alt={stats.currentRank} className="w-10 h-10 sm:w-12 sm:h-12 drop-shadow-[0_0_15px_rgba(255,255,255,0.1)] absolute" />
                        </div>
                        <div className="flex flex-col flex-grow min-w-[100px] sm:min-w-[120px]">
                            <span className="text-xs sm:text-sm font-black text-white tracking-widest uppercase leading-none truncate">{stats.currentRank}</span>
                            <span className="text-emerald-400 font-bold text-[10px] sm:text-xs mt-1">{stats.currentRR} RR</span>
                            <RankProgressBar rr={stats.currentRR} />
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4">

                    <div className="bg-[#0f1923] rounded-xl p-3 sm:p-4 border border-white/5 flex items-center gap-3 sm:gap-4 min-w-0">
                        <div className="relative w-12 h-12 sm:w-14 sm:h-14 rounded-full flex items-center justify-center shrink-0" style={{ background: `conic-gradient(#10b981 ${stats.recent.winrate}%, #ef4444 ${stats.recent.winrate}% 100%)` }}>
                            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-[#0f1923] rounded-full flex items-center justify-center flex-col shadow-[inset_0_2px_10px_rgba(0,0,0,0.5)]">
                                <span className="text-[8px] text-gray-500 font-bold uppercase mb-0.5">W/L</span>
                                <span className="text-[10px] sm:text-xs font-black text-white leading-none">{stats.recent.winrate}%</span>
                            </div>
                        </div>
                        <div className="flex flex-col min-w-0">
                            <span className="text-[9px] sm:text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-1 truncate">20 Derniers Matchs</span>
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
                        <div className="flex gap-1 flex-wrap mt-auto">
                            {squadDisplay.map(d => (
                                <span key={d.label} className="text-[8px] font-bold px-1.5 py-0.5 rounded border border-white/5 whitespace-nowrap" style={{ color: d.color, backgroundColor: `${d.color}20` }}>
                                    {d.count} {d.label}
                                </span>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            <div className="flex-grow bg-[#0f1923]/30 border-t border-white/5 max-h-[400px] overflow-y-auto custom-scrollbar">
                <MatchHistoryTable matches={playerMatches} onSelectMatch={onSelectMatch} mode="ranked" playersConfig={playersConfig} />
            </div>
        </Card>
    );
};

// --- DASHBOARD GLOBAL ---
export const RushDashboard = ({ matches, filteredData, selectedPlayerId, playersConfig, challengeStartDate }) => {
    const [selectedMatch, setSelectedMatch] = useState(null);

    const rushStats = useMemo(() => {
        const rankedMatches = filteredData.filter(m => m.type === 'ranked');
        const progressionData = [];
        const gamesPerPlayer = playersConfig.map(p => rankedMatches.filter(m => m.playerId === p.id).length);
        const maxGames = gamesPerPlayer.length > 0 ? Math.max(...gamesPerPlayer) : 0;
        const sortedForGraph = [...rankedMatches].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

        for (let i = 0; i < maxGames; i++) {
            const point = { gameIndex: i + 1 };
            playersConfig.forEach(player => {
                const playerMatches = sortedForGraph.filter(m => m.playerId === player.id);
                if (playerMatches[i] && playerMatches[i].rankValue) {
                    point[player.name] = playerMatches[i].rankValue;
                    point[player.name + 'Details'] = `${playerMatches[i].currentRank.toUpperCase()} ${playerMatches[i].currentRR}RR`;
                }
            });
            progressionData.push(point);
        }

        const timeGraphData = [];
        const currentRanks = {};
        const currentDetails = {};

        const allMatchesSortedByTime = [...rankedMatches].sort((a, b) => {
            const timeA = a.timestamp ? a.timestamp * 1000 : new Date(a.date).getTime();
            const timeB = b.timestamp ? b.timestamp * 1000 : new Date(b.date).getTime();
            return timeA - timeB;
        });

        allMatchesSortedByTime.forEach(match => {
            const time = match.timestamp ? match.timestamp * 1000 : new Date(match.date).getTime();
            const player = playersConfig.find(p => p.id === match.playerId);
            if (match.rankValue && player) {
                currentRanks[player.name] = match.rankValue;
                currentDetails[player.name + 'Details'] = `${match.currentRank.toUpperCase()} ${match.currentRR}RR`;
                timeGraphData.push({ timestamp: time, ...currentRanks, ...currentDetails });
            }
        });

        return { progressionData, timeGraphData, displayedMatches: rankedMatches };
    }, [filteredData, playersConfig]);

    const playersToShow = selectedPlayerId === 'all' ? playersConfig : playersConfig.filter(p => p.id === selectedPlayerId);
    const matchesForWidgets = useMemo(() => {
        let data = matches.filter(m => m.type === 'ranked');
        if (selectedPlayerId !== 'all') data = data.filter(m => m.playerId === selectedPlayerId);
        return data.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    }, [matches, selectedPlayerId]);

    const MVPBanner = ({ matches }) => {
        const today = new Date().toLocaleDateString();
        const todaysMatches = matches.filter(m => new Date(m.date).toLocaleDateString() === today && m.type === 'ranked');
        if (todaysMatches.length === 0) return null;
        const stats = {};
        todaysMatches.forEach(m => {
            if (!stats[m.playerId]) stats[m.playerId] = { id: m.playerId, rr: 0, kills: 0, deaths: 0 };
            stats[m.playerId].rr += m.rrChange;
            stats[m.playerId].kills += m.kills;
            stats[m.playerId].deaths += m.deaths;
        });
        const mvpId = Object.keys(stats).reduce((a, b) => stats[a].rr > stats[b].rr ? a : b, Object.keys(stats)[0]);
        const mvpStats = stats[mvpId];
        if (mvpStats.rr <= 0) return null;
        const player = playersConfig.find(p => p.id === mvpId);
        if (!player) return null;

        return (
            <div className="mb-6 relative overflow-hidden rounded-xl bg-gradient-to-r from-yellow-600/20 via-yellow-500/10 to-transparent border border-yellow-500/30 shadow-[0_0_20px_rgba(234,179,8,0.1)] p-4 sm:p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between animate-in slide-in-from-top duration-700 min-w-0">
                <div className="relative z-10 flex items-center gap-3 sm:gap-4 w-full min-w-0">
                    <div className="relative shrink-0">
                        <div className="absolute -inset-1 bg-yellow-500/50 rounded-full blur-lg animate-pulse"></div>
                        <div className="bg-gradient-to-br from-yellow-400 to-orange-500 w-10 h-10 sm:w-12 sm:h-12 rounded-lg flex items-center justify-center shadow-lg border border-white/20">
                            <Crown size={20} className="text-white drop-shadow-md sm:w-6 sm:h-6" />
                        </div>
                    </div>
                    <div className="flex flex-col min-w-0">
                        <h4 className="text-yellow-500 font-black tracking-widest text-[9px] sm:text-[10px] uppercase mb-0.5 flex items-center gap-1.5"><Zap size={10} /> MVP DU JOUR</h4>
                        <h2 className="text-lg sm:text-xl font-black text-white italic tracking-tighter uppercase drop-shadow-sm leading-none truncate">{player.name}</h2>
                        <p className="text-[10px] sm:text-xs text-gray-300 font-medium mt-1 truncate">Une performance monstrueuse avec <span className="text-green-400 font-bold">+{mvpStats.rr} RR</span> aujourd'hui !</p>
                    </div>
                </div>
                <div className="absolute right-0 top-0 h-full w-1/3 bg-gradient-to-l from-yellow-500/10 to-transparent pointer-events-none"></div>
                <div className="absolute -bottom-10 -right-10 text-9xl opacity-5 text-yellow-500 rotate-12 pointer-events-none"><Trophy /></div>
            </div>
        );
    };

    const DailyReportWidget = ({ matches }) => {
        const [selectedDate, setSelectedDate] = useState(new Date());
        const handlePrevDay = () => { const newDate = new Date(selectedDate); newDate.setDate(selectedDate.getDate() - 1); setSelectedDate(newDate); };
        const handleNextDay = () => { const newDate = new Date(selectedDate); newDate.setDate(selectedDate.getDate() + 1); if (newDate <= new Date()) setSelectedDate(newDate); };
        const isToday = selectedDate.toLocaleDateString() === new Date().toLocaleDateString();
        const dateStr = selectedDate.toLocaleDateString();
        const dailyMatches = matches.filter(m => new Date(m.date).toLocaleDateString() === dateStr && m.type === 'ranked');
        const statsByPlayer = {};
        if (dailyMatches.length > 0) {
            dailyMatches.forEach(m => {
                if (!statsByPlayer[m.playerId]) { statsByPlayer[m.playerId] = { wins: 0, losses: 0, rr: 0, name: playersConfig.find(p => p.id === m.playerId)?.name || '' }; }
                if (m.result === 'WIN') statsByPlayer[m.playerId].wins++; else statsByPlayer[m.playerId].losses++;
                statsByPlayer[m.playerId].rr += m.rrChange;
            });
        }
        return (
            <Card className="p-4 bg-gradient-to-r from-blue-900/40 to-[#0f1923] border-l-4 border-l-blue-500 mb-6 min-w-0">
                <div className="flex justify-between items-center mb-4 border-b border-white/5 pb-2">
                    <h3 className="font-black text-gray-200 flex items-center gap-2 tracking-wide text-xs sm:text-sm"><Calendar size={16} className="text-blue-400" /> RAPPORT <span className="hidden sm:inline">JOURNALIER</span> : <span className="text-white">{dateStr}</span></h3>
                    <div className="flex items-center gap-1 bg-black/20 rounded p-1">
                        <button onClick={handlePrevDay} className="p-1 hover:bg-white/10 rounded text-gray-400 hover:text-white transition-colors"><ChevronLeft size={16} /></button>
                        <button onClick={handleNextDay} disabled={isToday} className={`p-1 rounded text-gray-400 transition-colors ${isToday ? 'opacity-30 cursor-not-allowed' : 'hover:bg-white/10 hover:text-white'}`}><ChevronRight size={16} /></button>
                    </div>
                </div>
                {dailyMatches.length === 0 ? (<div className="text-center py-6 text-gray-500 italic text-xs sm:text-sm">Aucune session Ranked enregistrée pour cette date.</div>) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 sm:gap-3">
                        {Object.values(statsByPlayer).map((stat, idx) => (
                            <div key={idx} className="flex justify-between items-center bg-[#0f1923] p-2 sm:p-3 rounded border border-white/5 hover:border-white/10 transition-colors min-w-0">
                                <span className="font-bold text-xs sm:text-sm text-gray-200 truncate pr-2">{stat.name}</span>
                                <div className="flex gap-2 sm:gap-3 text-xs sm:text-sm shrink-0">
                                    <span className={stat.rr >= 0 ? "text-emerald-400 font-black" : "text-red-400 font-black"}>{stat.rr > 0 ? "+" : ""}{stat.rr} RR</span>
                                    <span className="text-gray-400 font-mono">{stat.wins}W - {stat.losses}L</span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </Card>
        );
    };

    const CustomRushTooltip = ({ active, payload, label }) => {
        if (active && payload && payload.length) {
            const sortedPayload = [...payload].sort((a, b) => b.value - a.value);
            const isTimestamp = typeof label === 'number' && label > 1000000000;
            const title = isTimestamp
                ? new Date(label).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
                : `GAME ${label}`;

            return (
                <div className="bg-[#0f1923] border border-white/20 p-3 rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.8)] z-[9999] relative min-w-[200px] sm:min-w-[220px]">
                    <p className="font-black text-gray-400 text-[10px] uppercase tracking-widest mb-2 border-b border-white/10 pb-1">{title}</p>
                    <div className="grid grid-cols-2 gap-x-2 sm:gap-x-4 gap-y-2">
                        {sortedPayload.map((entry) => {
                            const details = entry.payload[entry.name + 'Details'];
                            return (
                                <div key={entry.name} className="flex flex-col border-l-2 pl-2" style={{ borderColor: entry.color }}>
                                    <span className="font-bold text-white text-[9px] sm:text-[10px] leading-none mb-0.5 truncate max-w-[80px] sm:max-w-[90px]" title={entry.name}>{entry.name}</span>
                                    <span className="text-[8px] sm:text-[9px] text-gray-300 font-medium">
                                        <span className="text-gray-100 font-mono font-bold">
                                            {details || `${entry.value} Elo`}
                                        </span>
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            );
        }
        return null;
    };

    return (
        <div className="space-y-6 sm:space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 w-full min-w-0">
            {selectedMatch && <MatchDetailModal match={selectedMatch} playersConfig={playersConfig} onClose={() => setSelectedMatch(null)} />}

            <MVPBanner matches={matchesForWidgets} />
            <DailyReportWidget matches={matchesForWidgets} />

            <div className="mb-8 sm:mb-10 w-full min-w-0">
                <div className="flex items-center justify-between border-b-2 border-white/10 pb-2 mb-4 sm:mb-6">
                    <h2 className="text-lg sm:text-2xl font-black text-white italic tracking-tighter uppercase flex items-center gap-2 sm:gap-3">
                        <List className="text-blue-400 w-5 h-5 sm:w-6 sm:h-6" /> JOURNAL DE BORD <span className="hidden sm:inline">(PAR JOUR)</span>
                    </h2>
                </div>
                <DailyGamesList matches={matchesForWidgets} onSelectMatch={setSelectedMatch} playersConfig={playersConfig} />
            </div>

            {selectedPlayerId === 'all' && (
                <div className="grid grid-cols-1 gap-6 sm:gap-8 w-full min-w-0">
                    <Card className="p-4 sm:p-6 border-t-4 border-t-blue-500 min-w-0">
                        <div className="flex items-center justify-between mb-4 sm:mb-6">
                            <h3 className="text-lg sm:text-xl font-black flex items-center gap-2 text-white italic tracking-wide">
                                <Activity size={20} className="text-blue-500" /> PROGRESSION <span className="hidden sm:inline">(PAR PARTIE)</span>
                            </h3>
                        </div>
                        <div className="h-[250px] sm:h-[300px] w-full min-w-0">
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={rushStats.progressionData} margin={{ left: -20, right: 10, top: 10, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                                    <XAxis dataKey="gameIndex" stroke="#9ca3af" hide />
                                    <YAxis stroke="#9ca3af" domain={['auto', 'auto']} width={60} tickFormatter={getRankLabel} style={{ fontSize: '9px', fontWeight: 'bold' }} />
                                    <RechartsTooltip content={<CustomRushTooltip />} cursor={{ stroke: '#ffffff20', strokeWidth: 1, strokeDasharray: '4 4' }} wrapperStyle={{ zIndex: 1000, outline: 'none' }} />
                                    <Legend wrapperStyle={{ fontSize: '10px' }} />
                                    {playersConfig.map(player => (
                                        <Line key={player.id} type="monotone" dataKey={player.name} stroke={player.color} strokeWidth={2} dot={false} connectNulls />
                                    ))}
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    </Card>

                    <Card className="p-4 sm:p-6 border-t-4 border-t-purple-500 min-w-0">
                        <div className="flex items-center justify-between mb-4 sm:mb-6">
                            <h3 className="text-lg sm:text-xl font-black flex items-center gap-2 text-white italic tracking-wide">
                                <Clock size={20} className="text-purple-500" /> ÉVOLUTION <span className="hidden sm:inline">(CHRONOLOGIQUE)</span>
                            </h3>
                        </div>
                        <div className="h-[250px] sm:h-[300px] w-full min-w-0">
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={rushStats.timeGraphData} margin={{ left: -20, right: 10, top: 10, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                                    <XAxis dataKey="timestamp" type="number" domain={['dataMin', 'dataMax']} stroke="#9ca3af" tickFormatter={(unixTime) => new Date(unixTime).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} style={{ fontSize: '9px', fontWeight: 'bold' }} />
                                    <YAxis stroke="#9ca3af" domain={['auto', 'auto']} width={60} tickFormatter={getRankLabel} style={{ fontSize: '9px', fontWeight: 'bold' }} />
                                    <RechartsTooltip content={<CustomRushTooltip />} cursor={{ stroke: '#ffffff20', strokeWidth: 1, strokeDasharray: '4 4' }} wrapperStyle={{ zIndex: 1000, outline: 'none' }} />
                                    <Legend wrapperStyle={{ fontSize: '10px' }} />
                                    {playersConfig.map(player => (
                                        <Line key={player.id} type="stepAfter" dataKey={player.name} stroke={player.color} strokeWidth={2} dot={false} connectNulls />
                                    ))}
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    </Card>
                </div>
            )}

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 sm:gap-8 mt-6 sm:mt-8 w-full min-w-0">
                {playersToShow.map(player => (
                    <PlayerRushCard key={player.id} player={player} matches={matches} onSelectMatch={setSelectedMatch} playersConfig={playersConfig} />
                ))}
            </div>
        </div>
    );
};