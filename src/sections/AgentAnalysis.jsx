import React, { useMemo } from 'react';
import { Users, Crosshair, Target, Activity, Skull } from 'lucide-react';
import { Card } from '../components/UI';
import { calculateKD, calculateACS, calculateWinrate, calculateHS } from '../utils/calculations';

export const AgentAnalysis = ({ matches, selectedPlayerId, playersConfig }) => {
    const agentStats = useMemo(() => {
        const validMatches = matches.filter(m => m.type === 'ranked' && (selectedPlayerId === 'all' || m.playerId === selectedPlayerId));

        const stats = {};
        validMatches.forEach(m => {
            if (!m.agent) return;
            if (!stats[m.agent]) {
                stats[m.agent] = {
                    name: m.agent, image: m.agentImg,
                    matches: 0, wins: 0, losses: 0,
                    kills: 0, deaths: 0, assists: 0, score: 0, rounds: 0,
                    headshots: 0, totalShots: 0, clutches: 0,
                    firstKills: 0, firstDeaths: 0
                };
            }
            const s = stats[m.agent];
            s.matches++;
            if (m.result === 'WIN') s.wins++;
            else if (m.result === 'LOSS') s.losses++;
            s.kills += m.kills;
            s.deaths += m.deaths;
            s.assists += m.assists;
            s.score += m.score;
            s.rounds += (m.roundsPlayed || 1);
            s.headshots += (m.headshots || 0);
            s.totalShots += (m.totalShots || 0);
            s.clutches += (m.clutches || 0);
            s.firstKills += (m.firstKills || 0);
            s.firstDeaths += (m.firstDeaths || 0);
        });

        return Object.values(stats).map(s => ({
            ...s,
            winrate: calculateWinrate(s.wins, s.matches),
            kd: calculateKD(s.kills, s.deaths),
            acs: calculateACS(s.score, s.rounds),
            hsPct: calculateHS(s.headshots, s.totalShots)
        })).sort((a, b) => b.matches - a.matches);

    }, [matches, selectedPlayerId, playersConfig]);

    if (!agentStats || agentStats.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-64 text-gray-500">
                <Users size={48} className="mb-4 opacity-20" />
                <p className="font-bold uppercase tracking-widest">Aucune donnée d'agent</p>
            </div>
        );
    }

    const topAgent = agentStats[0];

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-center gap-4 mb-8">
                <div className="p-3 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl shadow-lg shadow-purple-500/20">
                    <Users size={32} className="text-white" />
                </div>
                <div>
                    <h2 className="text-4xl font-black text-white italic tracking-tighter uppercase">Analyse des Agents</h2>
                    <p className="text-gray-400 font-medium uppercase tracking-widest text-xs">Performances par personnage</p>
                </div>
            </div>

            <Card className="p-6 border-l-4 border-l-indigo-500 bg-gradient-to-r from-indigo-500/10 to-transparent">
                <div className="flex flex-col md:flex-row items-center gap-6">
                    <img src={topAgent.image} alt={topAgent.name} className="w-24 h-24 rounded-2xl bg-black border border-white/10 shadow-xl" />
                    <div className="flex-grow text-center md:text-left">
                        <div className="text-xs font-bold text-indigo-400 uppercase tracking-widest mb-1">Agent le plus joué</div>
                        <h3 className="text-3xl font-black text-white uppercase italic">{topAgent.name}</h3>
                        <p className="text-gray-400 text-sm mt-1">{topAgent.matches} matchs joués avec <span className="text-emerald-400 font-bold">{topAgent.winrate}%</span> de victoire.</p>
                    </div>
                    <div className="grid grid-cols-3 gap-4 w-full md:w-auto">
                        <div className="bg-[#0f1923] p-3 rounded-xl border border-white/5 text-center">
                            <div className="text-[10px] text-gray-500 uppercase font-bold">K/D Ratio</div>
                            <div className="text-xl font-black text-white">{topAgent.kd}</div>
                        </div>
                        <div className="bg-[#0f1923] p-3 rounded-xl border border-white/5 text-center">
                            <div className="text-[10px] text-gray-500 uppercase font-bold">ACS</div>
                            <div className="text-xl font-black text-white">{topAgent.acs}</div>
                        </div>
                        <div className="bg-[#0f1923] p-3 rounded-xl border border-white/5 text-center">
                            <div className="text-[10px] text-gray-500 uppercase font-bold">Clutches</div>
                            <div className="text-xl font-black text-purple-400">{topAgent.clutches}</div>
                        </div>
                    </div>
                </div>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-8">
                {agentStats.map((agent, index) => (
                    <Card key={agent.name} className="p-5 flex flex-col hover:border-white/20 transition-all group">
                        <div className="flex items-center gap-4 border-b border-white/5 pb-4 mb-4">
                            <div className="relative">
                                <img src={agent.image} alt={agent.name} className="w-14 h-14 rounded-xl bg-gray-800 shadow-md group-hover:scale-105 transition-transform" />
                                <div className="absolute -bottom-2 -right-2 bg-[#0f1923] border border-white/10 text-white text-[10px] font-black w-6 h-6 rounded flex items-center justify-center shadow-lg">
                                    #{index + 1}
                                </div>
                            </div>
                            <div>
                                <h4 className="text-lg font-black text-white uppercase italic leading-none">{agent.name}</h4>
                                <span className="text-xs text-gray-500 font-bold">{agent.matches} matchs</span>
                            </div>
                            <div className="ml-auto text-right">
                                <div className={`text-xl font-black leading-none ${agent.winrate >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>
                                    {agent.winrate}%
                                </div>
                                <span className="text-[9px] text-gray-500 uppercase font-bold">Winrate</span>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-y-4 gap-x-2 flex-grow">
                            <div>
                                <div className="text-[9px] text-gray-500 uppercase font-bold flex items-center gap-1"><Crosshair size={10} /> K/D Ratio</div>
                                <div className="text-sm font-black text-white">{agent.kd}</div>
                            </div>
                            <div>
                                <div className="text-[9px] text-gray-500 uppercase font-bold flex items-center gap-1"><Activity size={10} /> Score Moyen</div>
                                <div className="text-sm font-black text-white">{agent.acs} ACS</div>
                            </div>
                            <div>
                                <div className="text-[9px] text-gray-500 uppercase font-bold flex items-center gap-1"><Target size={10} /> Headshots</div>
                                <div className="text-sm font-black text-yellow-400">{agent.hsPct}%</div>
                            </div>
                            <div>
                                <div className="text-[9px] text-gray-500 uppercase font-bold flex items-center gap-1"><Skull size={10} /> Entry K/D</div>
                                <div className="text-sm font-black text-white">
                                    {agent.firstKills} <span className="text-gray-500 text-[10px]">/</span> <span className="text-red-400">{agent.firstDeaths}</span>
                                </div>
                            </div>
                        </div>
                    </Card>
                ))}
            </div>
        </div>
    );
};