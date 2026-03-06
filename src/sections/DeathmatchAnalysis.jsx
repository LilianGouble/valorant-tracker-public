import React, { useState, useMemo } from 'react';
import { Activity, Swords, Trophy, TrendingUp, Map as MapIcon, Crosshair } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Legend } from 'recharts';
import { Card, MatchDetailModal, Badge } from '../components/UI';
import { MatchHistoryTable } from '../components/MatchHistoryTable';
import { calculateKD, calculateACS } from '../utils/calculations';

const PlayerDMCard = ({ player, matches, onSelectMatch, playersConfig }) => {
    const { stats, playerMatches } = useMemo(() => {
        const pMatches = matches
            .filter(m => m.playerId === player.id && m.type === 'dm')
            .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

        if (pMatches.length === 0) return { stats: null, playerMatches: [] };

        const total = pMatches.length;
        const wins = pMatches.filter(m => m.placement === 1).length;
        const totalKills = pMatches.reduce((acc, m) => acc + m.kills, 0);
        const totalDeaths = pMatches.reduce((acc, m) => acc + m.deaths, 0);
        const totalScore = pMatches.reduce((acc, m) => acc + m.score, 0);
        const totalRounds = pMatches.reduce((acc, m) => acc + (m.rounds || 1), 0);

        const progress = Math.min(100, (total / 100) * 100);

        const graphData = [...pMatches].reverse().slice(-20).map((m, i) => ({
            i, score: calculateACS(m.score, m.rounds)
        }));

        return {
            playerMatches: pMatches,
            stats: {
                total, wins,
                kd: calculateKD(totalKills, totalDeaths),
                avgScore: calculateACS(totalScore, totalRounds),
                podiums: pMatches.filter(m => m.placement <= 3).length,
                progress,
                graphData
            }
        };
    }, [matches, player.id]);

    if (!stats) return null;

    return (
        <Card className="flex flex-col overflow-hidden border-t-4" style={{ borderTopColor: player.color }}>
            <div className="p-5 bg-gradient-to-b from-white/5 to-transparent border-b border-white/5">
                <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-xl flex items-center justify-center font-black text-xl text-white shadow-lg border border-white/20" style={{ backgroundColor: player.color }}>
                            {player.name.charAt(0)}
                        </div>
                        <div>
                            <h3 className="text-lg font-black text-white italic tracking-tighter uppercase">{player.name}</h3>
                            <div className="flex items-center gap-2 text-[10px] font-bold text-gray-400 uppercase">
                                <Badge className="bg-red-500/20 text-red-300">FFA</Badge>
                                <span>{stats.total} / 100 Games</span>
                            </div>
                        </div>
                    </div>
                    <div className="text-right">
                        <div className="text-xl font-black text-white">{stats.avgScore}</div>
                        <div className="text-[9px] text-gray-500 uppercase font-bold">Score Moy.</div>
                    </div>
                </div>

                <div className="mb-4">
                    <div className="flex justify-between text-[9px] font-bold text-gray-400 mb-1 uppercase">
                        <span>Progression Défi</span>
                        <span className={stats.progress >= 100 ? 'text-green-400' : 'text-white'}>{stats.progress.toFixed(0)}%</span>
                    </div>
                    <div className="h-1.5 w-full bg-black/40 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-gradient-to-r from-red-500 to-orange-500"
                            style={{ width: `${stats.progress}%` }}
                        ></div>
                    </div>
                </div>

                <div className="h-12 w-full mb-3 opacity-60">
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={stats.graphData}>
                            <Line type="monotone" dataKey="score" stroke={player.color} strokeWidth={2} dot={false} />
                        </LineChart>
                    </ResponsiveContainer>
                </div>

                <div className="grid grid-cols-3 gap-2">
                    <div className="bg-[#0f1923] p-1.5 rounded text-center border border-white/5">
                        <div className="text-[9px] text-gray-500 font-bold uppercase">K/D</div>
                        <div className={`font-black text-sm ${stats.kd >= 1 ? 'text-white' : 'text-orange-400'}`}>{stats.kd}</div>
                    </div>
                    <div className="bg-[#0f1923] p-1.5 rounded text-center border border-white/5">
                        <div className="text-[9px] text-gray-500 font-bold uppercase">Podiums</div>
                        <div className="font-black text-sm text-yellow-500">{stats.podiums}</div>
                    </div>
                    <div className="bg-[#0f1923] p-1.5 rounded text-center border border-white/5">
                        <div className="text-[9px] text-gray-500 font-bold uppercase">Win</div>
                        <div className="font-black text-sm text-emerald-400">{stats.wins}</div>
                    </div>
                </div>
            </div>

            <div className="flex-grow bg-[#0f1923]/30 max-h-[250px] overflow-y-auto custom-scrollbar border-t border-white/5">
                <MatchHistoryTable matches={playerMatches} onSelectMatch={onSelectMatch} mode="dm" playersConfig={playersConfig} />
            </div>
        </Card>
    );
};

export const DeathmatchAnalysis = ({ matches, selectedPlayerId, playersConfig }) => {
    const [selectedMatch, setSelectedMatch] = useState(null);

    const dmGlobalStats = useMemo(() => {
        const dmMatches = matches.filter(m => m.type === 'dm');
        return {
            totalGames: dmMatches.length,
            totalWins: dmMatches.filter(m => m.placement === 1).length,
            avgScore: dmMatches.length > 0 ? Math.round(dmMatches.reduce((acc, m) => acc + calculateACS(m.score, m.rounds), 0) / dmMatches.length) : 0
        };
    }, [matches]);

    const playersToShow = selectedPlayerId === 'all'
        ? playersConfig
        : playersConfig.filter(p => p.id === selectedPlayerId);

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {selectedMatch && <MatchDetailModal match={selectedMatch} onClose={() => setSelectedMatch(null)} playersConfig={playersConfig} />}

            <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-red-900 to-orange-900 border border-white/10 shadow-2xl p-8">
                <div className="absolute top-0 right-0 -mt-10 -mr-10 w-64 h-64 bg-white/5 rounded-full blur-3xl"></div>
                <div className="relative z-10 flex flex-col md:flex-row justify-between items-center gap-6">
                    <div>
                        <div className="flex items-center gap-3 mb-2">
                            <Badge className="bg-white/10 text-white border border-white/20">SOLO MODE</Badge>
                            <span className="text-red-300 font-bold tracking-widest text-xs uppercase">Saison FFA</span>
                        </div>
                        <h2 className="text-4xl md:text-5xl font-black text-white italic tracking-tighter uppercase mb-2">DÉFI 100 <span className="text-transparent bg-clip-text bg-gradient-to-r from-red-400 to-yellow-400">DM</span></h2>
                        <p className="text-red-200 text-sm max-w-lg">Le mode Deathmatch classique. 12 joueurs, 1 seul vainqueur. Objectif individuel : 100 parties.</p>
                    </div>

                    <div className="flex gap-6 text-center">
                        <div>
                            <div className="text-3xl font-black text-white">{dmGlobalStats.totalGames}</div>
                            <div className="text-[10px] font-bold text-red-300 uppercase">Games Groupe</div>
                        </div>
                        <div>
                            <div className="text-3xl font-black text-white">{dmGlobalStats.totalWins}</div>
                            <div className="text-[10px] font-bold text-red-300 uppercase">Victoires Totales</div>
                        </div>
                        <div>
                            <div className="text-3xl font-black text-white">{dmGlobalStats.avgScore}</div>
                            <div className="text-[10px] font-bold text-red-300 uppercase">Score Moy.</div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6">
                {playersToShow.map(player => (
                    <PlayerDMCard
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