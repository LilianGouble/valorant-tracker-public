import React, { useMemo } from 'react';
import { BrainCircuit, Crosshair, Shield, Zap, Activity, Trophy, Swords } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, Legend } from 'recharts';
import { Card, Badge } from '../components/UI';
import { calculateKD, calculateWinrate, safeDiv } from '../utils/calculations';

const ROLE_COLORS = {
    Duelist: '#ef4444',
    Initiator: '#eab308',
    Controller: '#3b82f6',
    Sentinel: '#10b981'
};

const AGENT_ROLES = {
    "Jett": "Duelist", "Phoenix": "Duelist", "Reyna": "Duelist", "Raze": "Duelist", "Yoru": "Duelist", "Neon": "Duelist", "Iso": "Duelist",
    "Brimstone": "Controller", "Viper": "Controller", "Omen": "Controller", "Astra": "Controller", "Harbor": "Controller", "Clove": "Controller",
    "Sova": "Initiator", "Breach": "Initiator", "Skye": "Initiator", "KAY/O": "Initiator", "Fade": "Initiator", "Gekko": "Initiator", "Tejo": "Initiator",
    "Killjoy": "Sentinel", "Cypher": "Sentinel", "Sage": "Sentinel", "Chamber": "Sentinel", "Deadlock": "Sentinel", "Vyse": "Sentinel"
};

export const RoleAnalysis = ({ matches, selectedPlayerId, playersConfig, challengeStartDate }) => {

    const roleStats = useMemo(() => {
        const startDate = challengeStartDate ? new Date(challengeStartDate).getTime() : 0;

        const stats = {
            Duelist: { games: 0, wins: 0, kills: 0, deaths: 0, assists: 0, damage: 0, score: 0 },
            Initiator: { games: 0, wins: 0, kills: 0, deaths: 0, assists: 0, damage: 0, score: 0 },
            Controller: { games: 0, wins: 0, kills: 0, deaths: 0, assists: 0, damage: 0, score: 0 },
            Sentinel: { games: 0, wins: 0, kills: 0, deaths: 0, assists: 0, damage: 0, score: 0 }
        };

        const agentStats = {};

        matches.forEach(m => {
            if (m.type !== 'ranked') return;
            const matchTime = m.timestamp ? m.timestamp * 1000 : new Date(m.date).getTime();
            if (matchTime < startDate) return;
            if (selectedPlayerId !== 'all' && m.playerId !== selectedPlayerId) return;

            if (!m.agent || m.agent === 'Undefined') return;

            const role = AGENT_ROLES[m.agent];
            if (!role) return;

            const s = stats[role];
            s.games++;
            if (m.result === 'WIN') s.wins++;
            s.kills += m.kills;
            s.deaths += m.deaths;
            s.assists += m.assists;
            s.score += m.score;
            s.damage += (m.damageMade || 0);

            if (!agentStats[m.agent]) {
                agentStats[m.agent] = {
                    name: m.agent,
                    role: role,
                    games: 0, wins: 0,
                    kills: 0, deaths: 0,
                    img: m.agentImg
                };
            }
            const as = agentStats[m.agent];
            as.games++;
            if (m.result === 'WIN') as.wins++;
            as.kills += m.kills;
            as.deaths += m.deaths;
        });

        const chartData = Object.entries(stats).map(([role, data]) => ({
            role,
            games: data.games,
            winrate: calculateWinrate(data.wins, data.games),
            kd: calculateKD(data.kills, data.deaths),
            acs: Math.round(safeDiv(data.score, data.games)),
            kda: `${Math.round(data.kills / data.games)} / ${Math.round(data.deaths / data.games)} / ${Math.round(data.assists / data.games)}`
        })).filter(r => r.games > 0);

        const topAgents = Object.values(agentStats)
            .filter(a => a.name && a.name !== 'Undefined')
            .sort((a, b) => b.games - a.games)
            .map(a => ({
                ...a,
                winrate: calculateWinrate(a.wins, a.games),
                kd: calculateKD(a.kills, a.deaths)
            }));

        return { chartData, topAgents };
    }, [matches, selectedPlayerId, challengeStartDate]);

    const radarData = roleStats.chartData.map(d => ({
        role: d.role,
        Winrate: d.winrate,
        KD: Math.min(d.kd * 50, 100),
        Playrate: Math.min((d.games / matches.length) * 100 * 4, 100),
        fullMark: 100
    }));

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="flex items-center gap-4 mb-4">
                <div className="p-3 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl shadow-lg">
                    <BrainCircuit size={32} className="text-white" />
                </div>
                <div>
                    <h2 className="text-4xl font-black text-white italic tracking-tighter uppercase">TACTIQUE & RÔLES</h2>
                    <p className="text-gray-400 font-medium uppercase tracking-widest text-xs">Analyse de polyvalence et performance par classe</p>
                </div>
            </div>

            {roleStats.chartData.length > 0 ? (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-2 space-y-6">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            {roleStats.chartData.map(role => (
                                <Card key={role.role} className="p-4 bg-[#1c252e] border-t-4 flex flex-col justify-between" style={{ borderColor: ROLE_COLORS[role.role] }}>
                                    <div className="flex justify-between items-start mb-2">
                                        <h4 className="text-xs font-black uppercase text-gray-400">{role.role}</h4>
                                        <Badge className="bg-white/10 text-white">{role.games} Games</Badge>
                                    </div>
                                    <div className="text-3xl font-black text-white mb-1">{role.winrate}% <span className="text-xs text-gray-500 font-normal">WR</span></div>
                                    <div className="text-xs font-mono text-gray-400">KD: <span className={role.kd >= 1 ? 'text-emerald-400' : 'text-red-400'}>{role.kd}</span></div>
                                </Card>
                            ))}
                        </div>

                        <Card className="p-6 bg-[#1c252e] h-[400px]">
                            <h3 className="text-sm font-black text-white uppercase mb-6 flex items-center gap-2">
                                <Activity size={16} className="text-indigo-400" /> Performance Comparée
                            </h3>
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={roleStats.chartData} barSize={40}>
                                    <XAxis dataKey="role" stroke="#9ca3af" tick={{ fontSize: 12, fontWeight: 'bold' }} />
                                    <YAxis stroke="#9ca3af" tick={{ fontSize: 12, fontWeight: 'bold' }} />
                                    <Tooltip
                                        cursor={{ fill: 'transparent' }}
                                        contentStyle={{ backgroundColor: '#1c252e', borderColor: '#333', borderRadius: '8px' }}
                                    />
                                    <Legend />
                                    <Bar dataKey="winrate" name="Winrate %" fill="#10b981" radius={[4, 4, 0, 0]} />
                                    <Bar dataKey="kd" name="K/D Ratio (x100)" fill="#fbbf24" radius={[4, 4, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </Card>
                    </div>

                    <div className="space-y-6">
                        <Card className="p-4 bg-[#1c252e] h-[300px] flex flex-col items-center justify-center relative">
                            <h4 className="absolute top-4 left-4 text-xs font-black text-gray-500 uppercase tracking-widest">Polyvalence</h4>
                            <ResponsiveContainer width="100%" height="100%">
                                <RadarChart cx="50%" cy="50%" outerRadius="70%" data={radarData}>
                                    <PolarGrid stroke="#374151" />
                                    <PolarAngleAxis dataKey="role" tick={{ fill: '#9ca3af', fontSize: 10, fontWeight: 'bold' }} />
                                    <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                                    <Radar name="Winrate" dataKey="Winrate" stroke="#10b981" strokeWidth={2} fill="#10b981" fillOpacity={0.3} />
                                    <Radar name="K/D (Scaled)" dataKey="KD" stroke="#f59e0b" strokeWidth={2} fill="#f59e0b" fillOpacity={0.3} />
                                    <Legend iconSize={8} wrapperStyle={{ fontSize: '10px' }} />
                                </RadarChart>
                            </ResponsiveContainer>
                        </Card>

                        <Card className="p-0 bg-[#1c252e] overflow-hidden">
                            <div className="p-3 bg-white/5 border-b border-white/5 flex items-center gap-2">
                                <Trophy size={16} className="text-yellow-400" />
                                <span className="text-xs font-black text-white uppercase">Meilleurs Agents</span>
                            </div>
                            <div className="max-h-[300px] overflow-y-auto custom-scrollbar">
                                {roleStats.topAgents.map((agent, i) => (
                                    <div key={agent.name} className="flex items-center justify-between p-3 border-b border-white/5 last:border-0 hover:bg-white/5 transition-colors">
                                        <div className="flex items-center gap-3">
                                            <div className="font-mono text-gray-500 text-xs font-bold w-4">{i + 1}.</div>
                                            <div className="w-8 h-8 rounded-lg bg-gray-800 overflow-hidden border border-white/10">
                                                {agent.img && <img src={agent.img} alt={agent.name} className="w-full h-full object-cover" />}
                                            </div>
                                            <div>
                                                <div className="text-xs font-bold text-white uppercase">{agent.name}</div>
                                                <div className="text-[9px] font-bold uppercase" style={{ color: ROLE_COLORS[agent.role] }}>{agent.role}</div>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <div className={`text-xs font-black ${agent.winrate >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>{agent.winrate}% WR</div>
                                            <div className="text-[9px] text-gray-500">{agent.games} Games</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </Card>
                    </div>
                </div>
            ) : (
                <div className="flex flex-col items-center justify-center h-64 bg-black/20 rounded-2xl border border-white/5">
                    <Swords size={48} className="text-gray-600 mb-4 opacity-50" />
                    <p className="text-gray-400 font-bold uppercase text-sm">Aucune donnée tactique disponible</p>
                    <p className="text-gray-600 text-xs mt-1">Jouez des parties classées pour débloquer cette section.</p>
                </div>
            )}
        </div>
    );
};