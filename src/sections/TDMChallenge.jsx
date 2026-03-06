import React, { useMemo, useState } from 'react';
import { Target, Swords, Trophy, Skull, Activity, TrendingUp, Crosshair } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, Cell, ReferenceLine, Legend, CartesianGrid } from 'recharts';
import { Card, MatchDetailModal, Badge } from '../components/UI';
import { MatchHistoryTable } from '../components/MatchHistoryTable';
import { calculateKD, calculateACS } from '../utils/calculations';

// --- CARTE JOUEUR TDM ---
const PlayerTDMCard = ({ player, matches, onSelectMatch, playersConfig }) => {
    const { stats, playerMatches } = useMemo(() => {
        const pMatches = matches
            .filter(m => m.playerId === player.id && m.type === 'tdm')
            .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

        if (pMatches.length === 0) return { stats: null, playerMatches: [] };

        const totalKills = pMatches.reduce((acc, m) => acc + m.kills, 0);
        const totalDeaths = pMatches.reduce((acc, m) => acc + m.deaths, 0);
        const totalScore = pMatches.reduce((acc, m) => acc + m.score, 0);
        const totalDamage = pMatches.reduce((acc, m) => acc + (m.damageMade || 0), 0);
        const totalWins = pMatches.filter(m => m.result === 'WIN').length;

        const progress = Math.min(100, (pMatches.length / 100) * 100);

        const graphData = [...pMatches].reverse().slice(-20).map((m, i) => ({
            i, kd: m.kd, score: m.score
        }));

        return {
            playerMatches: pMatches,
            stats: {
                total: pMatches.length,
                wins: totalWins,
                kd: calculateKD(totalKills, totalDeaths),
                avgScore: Math.round(totalScore / pMatches.length),
                avgAdr: Math.round(totalDamage / pMatches.length),
                winrate: Math.round((totalWins / pMatches.length) * 100),
                progress,
                graphData
            }
        };
    }, [matches, player.id]);

    if (!stats) return null;

    return (
        <Card className="flex flex-col overflow-hidden border-t-4" style={{ borderTopColor: player.color }}>
            {/* HEADER */}
            <div className="p-5 bg-gradient-to-b from-white/5 to-transparent border-b border-white/5">
                <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-xl flex items-center justify-center font-black text-xl text-white shadow-lg border border-white/20" style={{ backgroundColor: player.color }}>
                            {player.name.charAt(0)}
                        </div>
                        <div>
                            <h3 className="text-lg font-black text-white italic tracking-tighter uppercase">{player.name}</h3>
                            <div className="flex items-center gap-2 text-[10px] font-bold text-gray-400 uppercase">
                                <Badge className="bg-indigo-500/20 text-indigo-300">TDM</Badge>
                                <span>{stats.total} / 100 Games</span>
                            </div>
                        </div>
                    </div>

                    {/* SCORES PRINCIPAUX */}
                    <div className="text-right">
                        <div className="flex flex-col items-end">
                            <span className="text-xl font-black text-white">{stats.avgScore} <span className="text-[9px] text-gray-500 font-bold uppercase ml-1">ACS</span></span>
                            <span className="text-sm font-bold text-indigo-300">{stats.avgAdr} <span className="text-[9px] text-gray-500 font-bold uppercase ml-1">ADR</span></span>
                        </div>
                    </div>
                </div>

                {/* PROGRESS BAR */}
                <div className="mb-4">
                    <div className="flex justify-between text-[9px] font-bold text-gray-400 mb-1 uppercase">
                        <span>Progression Défi</span>
                        <span className={stats.progress >= 100 ? 'text-green-400' : 'text-white'}>{stats.progress.toFixed(0)}%</span>
                    </div>
                    <div className="h-1.5 w-full bg-black/40 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-gradient-to-r from-indigo-500 to-purple-500"
                            style={{ width: `${stats.progress}%` }}
                        ></div>
                    </div>
                </div>

                {/* MINI GRAPH (KD) */}
                <div className="h-12 w-full mb-3 opacity-60">
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={stats.graphData}>
                            <Line type="monotone" dataKey="kd" stroke={player.color} strokeWidth={2} dot={false} />
                        </LineChart>
                    </ResponsiveContainer>
                </div>

                {/* STATS GRID */}
                <div className="grid grid-cols-2 gap-2">
                    <div className="bg-[#0f1923] p-1.5 rounded text-center border border-white/5">
                        <div className="text-[9px] text-gray-500 font-bold uppercase">K/D Ratio</div>
                        <div className={`font-black text-sm ${stats.kd >= 1 ? 'text-emerald-400' : 'text-orange-400'}`}>{stats.kd}</div>
                    </div>
                    <div className="bg-[#0f1923] p-1.5 rounded text-center border border-white/5">
                        <div className="text-[9px] text-gray-500 font-bold uppercase">Winrate</div>
                        <div className="font-black text-sm text-white">{stats.winrate}%</div>
                    </div>
                </div>
            </div>

            {/* HISTORIQUE DÉROULANT */}
            <div className="flex-grow bg-[#0f1923]/30 max-h-[250px] overflow-y-auto custom-scrollbar border-t border-white/5">
                <MatchHistoryTable matches={playerMatches} onSelectMatch={onSelectMatch} mode="tdm" playersConfig={playersConfig} />
            </div>
        </Card>
    );
};

export const TDMChallenge = ({ matches, playersConfig }) => {
    const [selectedMatch, setSelectedMatch] = useState(null);

    // Stats Globales
    const globalStats = useMemo(() => {
        const tdmMatches = matches.filter(m => m.type === 'tdm');
        const totalGames = tdmMatches.length;
        const totalWins = tdmMatches.filter(m => m.result === 'WIN').length;
        const totalKills = tdmMatches.reduce((acc, m) => acc + m.kills, 0);
        const totalDeaths = tdmMatches.reduce((acc, m) => acc + m.deaths, 0);
        const kd = totalDeaths > 0 ? (totalKills / totalDeaths).toFixed(2) : 0;

        return { totalGames, totalWins, totalKills, kd };
    }, [matches]);

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {selectedMatch && <MatchDetailModal match={selectedMatch} onClose={() => setSelectedMatch(null)} playersConfig={playersConfig} />}

            {/* HEADER */}
            <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-violet-900 to-indigo-900 border border-white/10 shadow-2xl p-8">
                <div className="absolute top-0 right-0 -mt-10 -mr-10 w-64 h-64 bg-white/5 rounded-full blur-3xl"></div>
                <div className="relative z-10 flex flex-col md:flex-row justify-between items-center gap-6">
                    <div>
                        <div className="flex items-center gap-3 mb-2">
                            <Badge className="bg-white/10 text-white border border-white/20">MODE ÉQUIPE</Badge>
                            <span className="text-indigo-300 font-bold tracking-widest text-xs uppercase">Saison TDM</span>
                        </div>
                        <h2 className="text-4xl md:text-5xl font-black text-white italic tracking-tighter uppercase mb-2">DÉFI 100 <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-cyan-400">TDM</span></h2>
                        <p className="text-indigo-200 text-sm max-w-lg">Objectif individuel : 100 parties de Team Deathmatch. Travaillez vos lignes, vos duels et votre teamplay.</p>
                    </div>

                    <div className="flex gap-6 text-center">
                        <div>
                            <div className="text-3xl font-black text-white">{globalStats.totalGames}</div>
                            <div className="text-[10px] font-bold text-indigo-300 uppercase">Games Totales</div>
                        </div>
                        <div>
                            <div className="text-3xl font-black text-white">{globalStats.kd}</div>
                            <div className="text-[10px] font-bold text-indigo-300 uppercase">K/D Groupe</div>
                        </div>
                        <div>
                            <div className="text-3xl font-black text-white">{globalStats.totalKills}</div>
                            <div className="text-[10px] font-bold text-indigo-300 uppercase">Kills Cumulés</div>
                        </div>
                    </div>
                </div>
            </div>

            {/* GRILLE JOUEURS */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6">
                {playersConfig.map(player => (
                    <PlayerTDMCard
                        key={player.id}
                        player={player}
                        matches={matches}
                        onSelectMatch={setSelectedMatch}
                        playersConfig={playersConfig}
                    />
                ))}
            </div>
        </div>
    );
};