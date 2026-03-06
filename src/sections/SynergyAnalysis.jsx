import React, { useMemo, useState } from 'react';
import { Users, TrendingUp, Crown, UserPlus, ShieldAlert, Swords, Skull } from 'lucide-react';
import { Card, Badge } from '../components/UI';
import { calculateWinrate, safeDiv } from '../utils/calculations';
import { motion } from 'framer-motion';

export const SynergyAnalysis = ({ matches, playersConfig, challengeStartDate }) => {
    const [view, setView] = useState('duo');

    const synergyStats = useMemo(() => {
        const startDate = challengeStartDate ? new Date(challengeStartDate).getTime() : 0;

        const rankedMatches = matches.filter(m => {
            if (m.type !== 'ranked') return false;
            const matchTime = m.timestamp ? m.timestamp * 1000 : new Date(m.date).getTime();
            return matchTime >= startDate;
        });

        const gamesById = {};
        rankedMatches.forEach(m => {
            if (!gamesById[m.id]) gamesById[m.id] = [];
            gamesById[m.id].push(m);
        });

        const duoMatrix = {};
        const squads = {};

        playersConfig.forEach(p1 => {
            duoMatrix[p1.id] = {};
            playersConfig.forEach(p2 => {
                duoMatrix[p1.id][p2.id] = { wins: 0, total: 0 };
            });
        });

        Object.values(gamesById).forEach(gamePlayers => {
            const winners = gamePlayers.filter(p => p.result === 'WIN');
            const losers = gamePlayers.filter(p => p.result !== 'WIN');

            const processGroup = (group) => {
                if (group.length < 2) return;

                for (let i = 0; i < group.length; i++) {
                    for (let j = i + 1; j < group.length; j++) {
                        const p1 = group[i].playerId;
                        const p2 = group[j].playerId;

                        if (duoMatrix[p1] && duoMatrix[p1][p2]) {
                            duoMatrix[p1][p2].total++;
                            if (group[0].result === 'WIN') duoMatrix[p1][p2].wins++;
                        }
                        if (duoMatrix[p2] && duoMatrix[p2][p1]) {
                            duoMatrix[p2][p1].total++;
                            if (group[0].result === 'WIN') duoMatrix[p2][p1].wins++;
                        }
                    }
                }

                if (group.length >= 3) {
                    const memberIds = group.map(p => p.playerId).sort();
                    const squadKey = memberIds.join('-');

                    if (!squads[squadKey]) {
                        squads[squadKey] = {
                            members: memberIds,
                            wins: 0,
                            total: 0,
                            names: group.map(p => playersConfig.find(c => c.id === p.playerId)?.name || 'Inconnu')
                        };
                    }
                    squads[squadKey].total++;
                    if (group[0].result === 'WIN') squads[squadKey].wins++;
                }
            };

            processGroup(winners);
            processGroup(losers);
        });

        const allSquads = Object.values(squads).map(s => ({
            ...s,
            wr: calculateWinrate(s.wins, s.total)
        }));

        const sortMethod = (a, b) => {
            if (b.wr !== a.wr) return b.wr - a.wr;
            return b.total - a.total;
        };

        const trios = allSquads.filter(s => s.members.length === 3).sort(sortMethod);
        const fiveStacks = allSquads.filter(s => s.members.length === 5).sort(sortMethod);
        const others = allSquads.filter(s => s.members.length === 4).sort(sortMethod);

        return { duoMatrix, trios, fiveStacks, others };
    }, [matches, playersConfig, challengeStartDate]);

    const getCellColor = (wins, total) => {
        if (total === 0) return 'bg-[#1c252e] opacity-50';
        const wr = (wins / total) * 100;
        if (total < 3) return 'bg-gray-800/50 text-gray-500';
        if (wr >= 65) return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/50 shadow-[inset_0_0_10px_rgba(16,185,129,0.2)]';
        if (wr >= 50) return 'bg-blue-500/20 text-blue-400 border-blue-500/50';
        if (wr >= 40) return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50';
        return 'bg-red-500/20 text-red-400 border-red-500/50';
    };

    const SquadCard = ({ squad, type }) => (
        <Card className="p-4 border-l-4 flex flex-col gap-3 relative overflow-hidden bg-gradient-to-r from-[#1c252e] to-[#0f1923]" style={{ borderLeftColor: squad.wr >= 50 ? '#10b981' : '#ef4444' }}>
            <div className="flex justify-between items-start z-10 relative">
                <div className="flex -space-x-2">
                    {squad.members.map((pid, i) => {
                        const pConfig = playersConfig.find(p => p.id === pid);
                        return (
                            <div key={i} className="w-8 h-8 rounded-full border-2 border-[#1c252e] flex items-center justify-center font-bold text-[10px] text-white shadow-lg" style={{ backgroundColor: pConfig?.color || '#555', zIndex: 10 - i }} title={pConfig?.name}>
                                {pConfig?.name.charAt(0)}
                            </div>
                        );
                    })}
                </div>
                <div className="text-right">
                    <div className={`text-2xl font-black ${squad.wr >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>{squad.wr}%</div>
                    <div className="text-[9px] text-gray-500 font-bold uppercase tracking-wider">{squad.total} Games</div>
                </div>
            </div>

            <div className="z-10 relative">
                <div className="flex flex-wrap gap-1 mt-1">
                    {squad.names.map((name, i) => (
                        <span key={i} className="text-[9px] font-bold bg-white/5 px-1.5 py-0.5 rounded text-gray-400 border border-white/5">{name}</span>
                    ))}
                </div>
            </div>

            <div className={`absolute -right-4 -bottom-4 opacity-5 rotate-12 transform scale-125`}>
                {squad.wr >= 50 ? <Crown size={80} /> : <ShieldAlert size={80} />}
            </div>
        </Card>
    );

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex justify-center mb-6">
                <div className="bg-[#1c252e] p-1 rounded-lg border border-white/10 flex gap-2">
                    <button
                        onClick={() => setView('duo')}
                        className={`px-6 py-2 rounded-md text-sm font-bold transition-all flex items-center gap-2 ${view === 'duo' ? 'bg-indigo-500 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}
                    >
                        <UserPlus size={16} /> DUO MATRIX
                    </button>
                    <button
                        onClick={() => setView('squad')}
                        className={`px-6 py-2 rounded-md text-sm font-bold transition-all flex items-center gap-2 ${view === 'squad' ? 'bg-indigo-500 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}
                    >
                        <Users size={16} /> COMPOSITIONS
                    </button>
                </div>
            </div>

            {view === 'duo' && (
                <Card className="p-6 overflow-x-auto bg-[#0f1923]">
                    <h3 className="text-xl font-black text-white italic uppercase mb-6 flex items-center gap-2">
                        <Swords className="text-indigo-500" /> Synergie des Duos (Winrate)
                    </h3>
                    <div className="min-w-[800px]">
                        <table className="w-full border-collapse">
                            <thead>
                                <tr>
                                    <th className="p-2"></th>
                                    {playersConfig.map(p => (
                                        <th key={p.id} className="p-2 pb-4">
                                            <div className="flex flex-col items-center">
                                                <div className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs border border-white/10 mb-1" style={{ backgroundColor: p.color }}>
                                                    {p.name.charAt(0)}
                                                </div>
                                                <span className="text-[10px] uppercase text-gray-500 font-bold writing-vertical-lr">{p.name.split(' ')[0]}</span>
                                            </div>
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {playersConfig.map((rowPlayer, i) => (
                                    <tr key={rowPlayer.id}>
                                        <td className="p-2 pr-4 text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                <span className="text-xs font-bold text-gray-300 uppercase">{rowPlayer.name}</span>
                                                <div className="w-6 h-6 rounded-full flex items-center justify-center font-bold text-[10px] border border-white/10" style={{ backgroundColor: rowPlayer.color }}>
                                                    {rowPlayer.name.charAt(0)}
                                                </div>
                                            </div>
                                        </td>
                                        {playersConfig.map((colPlayer, j) => {
                                            if (j <= i) {
                                                return <td key={colPlayer.id} className="p-1"><div className="w-full h-12 bg-[#0f1923] rounded-lg"></div></td>;
                                            }

                                            const stats = synergyStats.duoMatrix[rowPlayer.id][colPlayer.id];
                                            const wr = calculateWinrate(stats.wins, stats.total);
                                            const colorClass = getCellColor(stats.wins, stats.total);

                                            return (
                                                <td key={colPlayer.id} className="p-1">
                                                    <motion.div
                                                        whileHover={{ scale: 1.05 }}
                                                        className={`w-full h-12 rounded-lg border flex flex-col items-center justify-center cursor-default ${colorClass}`}
                                                    >
                                                        {stats.total > 0 ? (
                                                            <>
                                                                <span className="font-black text-sm">{wr}%</span>
                                                                <span className="text-[9px] opacity-70 font-mono">{stats.wins}-{stats.total - stats.wins} ({stats.total})</span>
                                                            </>
                                                        ) : (
                                                            <span className="text-[10px] text-gray-600">-</span>
                                                        )}
                                                    </motion.div>
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div className="mt-4 flex gap-4 justify-center text-xs font-bold text-gray-500">
                        <span className="flex items-center gap-1"><div className="w-3 h-3 bg-emerald-500/20 border border-emerald-500/50 rounded"></div> 65%+</span>
                        <span className="flex items-center gap-1"><div className="w-3 h-3 bg-blue-500/20 border border-blue-500/50 rounded"></div> 50-64%</span>
                        <span className="flex items-center gap-1"><div className="w-3 h-3 bg-yellow-500/20 border border-yellow-500/50 rounded"></div> 40-49%</span>
                        <span className="flex items-center gap-1"><div className="w-3 h-3 bg-red-500/20 border border-red-500/50 rounded"></div> &lt;40%</span>
                    </div>
                </Card>
            )}

            {view === 'squad' && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <div className="space-y-4">
                        <h3 className="text-lg font-black text-white uppercase flex items-center gap-2 border-b border-white/10 pb-2">
                            <Users size={18} className="text-blue-400" /> TRIO QUEUE
                        </h3>
                        {synergyStats.trios.length === 0 ? (
                            <div className="text-center p-8 bg-white/5 rounded-xl text-gray-500 italic text-sm">Aucun Trio enregistré.</div>
                        ) : (
                            <div className="grid gap-3">
                                {synergyStats.trios.map((squad, idx) => (
                                    <SquadCard key={idx} squad={squad} type="TRIO" />
                                ))}
                            </div>
                        )}
                    </div>
                    <div className="space-y-4">
                        <h3 className="text-lg font-black text-white uppercase flex items-center gap-2 border-b border-white/10 pb-2">
                            <Crown size={18} className="text-yellow-500" /> FULL STACK (5)
                        </h3>
                        {synergyStats.fiveStacks.length === 0 ? (
                            <div className="text-center p-8 bg-white/5 rounded-xl text-gray-500 italic text-sm">Aucune 5-Stack enregistrée.</div>
                        ) : (
                            <div className="grid gap-3">
                                {synergyStats.fiveStacks.map((squad, idx) => (
                                    <SquadCard key={idx} squad={squad} type="5-STACK" />
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};