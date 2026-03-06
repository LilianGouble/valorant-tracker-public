import React, { useMemo } from 'react';
import { Swords, Target, Shield, Ghost, Crosshair, HelpCircle, Skull } from 'lucide-react';
import { ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, Tooltip, Cell, ReferenceLine, LabelList, ZAxis } from 'recharts';
import { Card } from '../components/UI';

const QUADRANTS = [
    { label: "GIGACHAD (Alpha)", color: "#10b981", x: 90, y: 90, desc: "Agressif & Gagne ses duels" },
    { label: "FEEDER (Inting)", color: "#ef4444", x: 90, y: 10, desc: "Agressif & Meurt en premier" },
    { label: "TURRET (Anchor)", color: "#3b82f6", x: 10, y: 90, desc: "Passif & Solide sur appuis" },
    { label: "BAITER (Ghost)", color: "#9ca3af", x: 10, y: 10, desc: "Passif & Perd ses duels" }
];

const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
        const data = payload[0].payload;
        return (
            <div className="bg-[#1c252e] border border-white/10 p-3 rounded-lg shadow-xl text-xs z-50">
                <div className="font-black text-white uppercase mb-1 flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: data.fill }}></div>
                    {data.name}
                </div>
                <div className="space-y-1 text-gray-300">
                    <div>🔥 Agressivité : <span className="font-bold text-white">{data.x.toFixed(1)}%</span></div>
                    <div>🎯 Winrate Duel : <span className={`font-bold ${data.y >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>{data.y.toFixed(1)}%</span></div>
                    <div className="border-t border-white/10 mt-1 pt-1 opacity-75">
                        {data.stats.fk} FK / {data.stats.fd} FD ({data.stats.rounds} Rounds)
                    </div>
                </div>
            </div>
        );
    }
    return null;
};

export const PlaystyleMatrix = ({ matches, playersConfig, challengeStartDate }) => {
    const data = useMemo(() => {
        const startDate = challengeStartDate ? new Date(challengeStartDate).getTime() : 0;

        const playerStats = {};
        playersConfig.forEach(p => {
            playerStats[p.id] = { ...p, fk: 0, fd: 0, rounds: 0 };
        });

        matches.forEach(m => {
            if (m.type !== 'ranked') return;
            const matchTime = m.timestamp ? m.timestamp * 1000 : new Date(m.date).getTime();
            if (matchTime < startDate) return;

            if (playerStats[m.playerId]) {
                const p = playerStats[m.playerId];
                p.fk += (m.firstKills || 0);
                p.fd += (m.firstDeaths || 0);
                p.rounds += (m.roundsPlayed || 0);
            }
        });

        return Object.values(playerStats)
            .map(p => {
                if (p.rounds < 5) return null;

                const totalDuels = p.fk + p.fd;
                const aggression = (totalDuels / p.rounds) * 100;
                const winrate = totalDuels > 0 ? (p.fk / totalDuels) * 100 : 0;

                return {
                    name: p.name,
                    x: aggression,
                    y: winrate,
                    z: 100,
                    fill: p.color,
                    stats: { fk: p.fk, fd: p.fd, rounds: p.rounds }
                };
            })
            .filter(Boolean);
    }, [matches, playersConfig, challengeStartDate]);

    const avgAggro = data.length > 0 ? data.reduce((acc, curr) => acc + curr.x, 0) / data.length : 15;
    const maxX = Math.max(...data.map(d => d.x), 20) * 1.1;

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="flex items-center gap-4 mb-4">
                <div className="p-3 bg-gradient-to-br from-red-600 to-purple-700 rounded-xl shadow-lg">
                    <Crosshair size={32} className="text-white" />
                </div>
                <div>
                    <h2 className="text-4xl font-black text-white italic tracking-tighter uppercase">MATRICE DE STYLE</h2>
                    <p className="text-gray-400 font-medium uppercase tracking-widest text-xs">Analyse comportementale : Qui rentre ? Qui bait ?</p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                <Card className="lg:col-span-2 p-4 bg-[#1c252e] border-t-4 border-t-white/20 h-[500px] relative">
                    <div className="absolute inset-0 pointer-events-none p-8 flex flex-col justify-between opacity-10 font-black uppercase text-3xl z-0">
                        <div className="flex justify-between">
                            <span className="text-blue-500">Turret</span>
                            <span className="text-emerald-500">Gigachad</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-gray-500">Baiter</span>
                            <span className="text-red-500">Feeder</span>
                        </div>
                    </div>

                    <ResponsiveContainer width="100%" height="100%">
                        <ScatterChart margin={{ top: 20, right: 30, bottom: 20, left: 10 }}>
                            <XAxis
                                type="number"
                                dataKey="x"
                                name="Agressivité"
                                unit="%"
                                stroke="#6b7280"
                                tick={{ fill: '#9ca3af', fontSize: 10, fontWeight: 'bold' }}
                                tickFormatter={(val) => Math.round(val)}
                                label={{ value: 'AGRESSIVITÉ (% DUELS)', position: 'bottom', fill: '#fff', fontSize: 10, fontWeight: 'black', offset: 0 }}
                                domain={[0, maxX]}
                            />
                            <YAxis
                                type="number"
                                dataKey="y"
                                name="Winrate"
                                unit="%"
                                stroke="#6b7280"
                                tick={{ fill: '#9ca3af', fontSize: 10, fontWeight: 'bold' }}
                                label={{ value: '% VICTOIRE DUEL', angle: -90, position: 'insideLeft', fill: '#fff', fontSize: 10, fontWeight: 'black' }}
                                domain={[0, 100]}
                            />
                            <ZAxis type="number" dataKey="z" range={[60, 60]} />

                            <Tooltip content={<CustomTooltip />} cursor={{ strokeDasharray: '3 3', stroke: '#ffffff50' }} />

                            <ReferenceLine x={avgAggro} stroke="#ffffff" strokeOpacity={0.2} strokeDasharray="4 4" />
                            <ReferenceLine y={50} stroke="#ffffff" strokeOpacity={0.2} strokeDasharray="4 4" />

                            <Scatter name="Joueurs" data={data} shape="circle">
                                {data.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={entry.fill} stroke="#fff" strokeWidth={2} />
                                ))}
                                <LabelList
                                    dataKey="name"
                                    position="top"
                                    offset={10}
                                    style={{
                                        fill: '#fff',
                                        fontSize: '11px',
                                        fontWeight: 'bold',
                                        textShadow: '0px 2px 4px #000000',
                                        pointerEvents: 'none'
                                    }}
                                />
                            </Scatter>
                        </ScatterChart>
                    </ResponsiveContainer>
                </Card>

                <div className="space-y-4">
                    <Card className="p-4 bg-[#1c252e]">
                        <h3 className="text-sm font-black text-white uppercase mb-4 flex items-center gap-2">
                            <HelpCircle size={16} /> Comprendre la matrice
                        </h3>
                        <div className="space-y-3">
                            {QUADRANTS.map((q, i) => (
                                <div key={i} className="flex items-start gap-3 p-2 rounded bg-black/20 border border-white/5">
                                    <div className={`w-8 h-8 rounded flex items-center justify-center shrink-0`} style={{ backgroundColor: `${q.color}20`, color: q.color }}>
                                        {i === 0 ? <Swords size={16} /> : i === 1 ? <Skull size={16} /> : i === 2 ? <Shield size={16} /> : <Ghost size={16} />}
                                    </div>
                                    <div>
                                        <div className="text-xs font-black uppercase" style={{ color: q.color }}>{q.label}</div>
                                        <div className="text-[10px] text-gray-400">{q.desc}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </Card>

                    <Card className="p-4 bg-[#1c252e] flex-grow">
                        <h3 className="text-sm font-black text-white uppercase mb-4 flex items-center gap-2">
                            <Target size={16} /> Top "Openers"
                        </h3>
                        <div className="space-y-2">
                            {[...data].sort((a, b) => b.x - a.x).slice(0, 5).map((p, i) => (
                                <div key={i} className="flex justify-between items-center text-xs border-b border-white/5 pb-1">
                                    <div className="flex items-center gap-2">
                                        <span className="font-bold text-gray-500 w-3">{i + 1}.</span>
                                        <span style={{ color: p.fill }} className="font-bold uppercase">{p.name}</span>
                                    </div>
                                    <div className="font-mono text-white">
                                        {p.x.toFixed(1)}% <span className="text-gray-600">Aggro</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </Card>
                </div>
            </div>
        </div>
    );
};