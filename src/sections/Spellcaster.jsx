import React, { useMemo } from 'react';
import { Zap, Hexagon, Fingerprint, Activity } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from 'recharts';
import { Card } from '../components/UI';

const SPELL_COLORS = {
    c: "#10b981",
    q: "#3b82f6",
    e: "#f59e0b",
    x: "#ef4444"
};

const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
        return (
            <div className="bg-[#1c252e] border border-white/10 p-3 rounded-lg shadow-xl text-xs">
                <div className="font-black text-white uppercase mb-2">{label}</div>
                {payload.map((entry, index) => (
                    <div key={index} className="flex items-center gap-2 mb-1">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }}></div>
                        <span className="text-gray-300 capitalize">{entry.name} : <span className="text-white font-bold">{entry.value.toFixed(1)}</span> /game</span>
                    </div>
                ))}
                <div className="border-t border-white/10 mt-1 pt-1 text-gray-500 italic">
                    Total : {payload.reduce((acc, curr) => acc + curr.value, 0).toFixed(1)} sorts/game
                </div>
            </div>
        );
    }
    return null;
};

export const Spellcaster = ({ matches, playersConfig, challengeStartDate }) => {
    const data = useMemo(() => {
        const startDate = challengeStartDate ? new Date(challengeStartDate).getTime() : 0;
        const stats = {};

        playersConfig.forEach(p => {
            stats[p.id] = {
                name: p.name,
                color: p.color,
                c: 0, q: 0, e: 0, x: 0,
                games: 0
            };
        });

        matches.forEach(m => {
            if (m.type !== 'ranked') return;
            const matchTime = m.timestamp ? m.timestamp * 1000 : new Date(m.date).getTime();
            if (matchTime < startDate) return;

            if (stats[m.playerId]) {
                const p = stats[m.playerId];
                const ab = m.abilities || {};
                p.c += (ab.c_cast || 0);
                p.q += (ab.q_cast || 0);
                p.e += (ab.e_cast || 0);
                p.x += (ab.x_cast || 0);
                p.games += 1;
            }
        });

        return Object.values(stats)
            .map(p => {
                if (p.games < 1) return null;
                const div = p.games;

                return {
                    name: p.name,
                    "Basic (C)": p.c / div,
                    "Basic (Q)": p.q / div,
                    "Signature (E)": p.e / div,
                    "Ultime (X)": p.x / div,
                    totalPerMatch: (p.c + p.q + p.e + p.x) / div,
                    gamesPlayed: p.games
                };
            })
            .filter(Boolean)
            .sort((a, b) => b.totalPerMatch - a.totalPerMatch);
    }, [matches, playersConfig, challengeStartDate]);

    const ultFarmer = [...data].sort((a, b) => b["Ultime (X)"] - a["Ultime (X)"])[0];
    const economyPlayer = [...data].sort((a, b) => a.totalPerMatch - b.totalPerMatch)[0];

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="flex items-center gap-4 mb-4">
                <div className="p-3 bg-gradient-to-br from-violet-600 to-fuchsia-700 rounded-xl shadow-lg">
                    <Zap size={32} className="text-white" />
                </div>
                <div>
                    <h2 className="text-4xl font-black text-white italic tracking-tighter uppercase">SPELLCASTER</h2>
                    <p className="text-gray-400 font-medium uppercase tracking-widest text-xs">Analyse de l'utilisation des compétences (Moyenne par Match)</p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {ultFarmer && (
                    <Card className="p-4 bg-[#1c252e] border-l-4 border-l-red-500 flex items-center justify-between">
                        <div>
                            <div className="text-xs text-red-400 font-bold uppercase mb-1">Maire des Ultimes</div>
                            <div className="text-2xl font-black text-white">{ultFarmer.name}</div>
                            <div className="text-[10px] text-gray-500">
                                ~{ultFarmer["Ultime (X)"].toFixed(1)} Ultimes utilisés / match
                            </div>
                        </div>
                        <Hexagon size={32} className="text-red-500 opacity-80" />
                    </Card>
                )}
                {economyPlayer && (
                    <Card className="p-4 bg-[#1c252e] border-l-4 border-l-gray-500 flex items-center justify-between">
                        <div>
                            <div className="text-xs text-gray-400 font-bold uppercase mb-1">Joue "À la dure" (Full Aim)</div>
                            <div className="text-2xl font-black text-white">{economyPlayer.name}</div>
                            <div className="text-[10px] text-gray-500">
                                Seulement {economyPlayer.totalPerMatch.toFixed(0)} sorts / match
                            </div>
                        </div>
                        <Fingerprint size={32} className="text-gray-500 opacity-80" />
                    </Card>
                )}
            </div>

            <Card className="p-6 bg-[#1c252e] h-[500px]">
                <div className="flex items-center gap-2 mb-6">
                    <Activity size={18} className="text-violet-400" />
                    <h3 className="font-black text-white uppercase text-sm">Volume de sorts Moyen par Partie</h3>
                </div>

                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                        <XAxis dataKey="name" stroke="#9ca3af" tick={{ fontSize: 11, fontWeight: 'bold' }} />
                        <YAxis stroke="#9ca3af" tick={{ fontSize: 11, fontWeight: 'bold' }} label={{ value: 'SORTS / MATCH', angle: -90, position: 'insideLeft', fill: '#6b7280', fontSize: 10, fontWeight: 'black' }} />
                        <Tooltip content={<CustomTooltip />} cursor={{ fill: '#ffffff05' }} />
                        <Legend wrapperStyle={{ paddingTop: '20px', fontSize: '12px', fontWeight: 'bold' }} />

                        <Bar dataKey="Ultime (X)" stackId="a" fill={SPELL_COLORS.x} radius={[4, 4, 0, 0]} name="Ultime (X)" />
                        <Bar dataKey="Signature (E)" stackId="a" fill={SPELL_COLORS.e} name="Signature (E)" />
                        <Bar dataKey="Basic (Q)" stackId="a" fill={SPELL_COLORS.q} name="Basic (Q)" />
                        <Bar dataKey="Basic (C)" stackId="a" fill={SPELL_COLORS.c} radius={[0, 0, 4, 4]} name="Basic (C)" />
                    </BarChart>
                </ResponsiveContainer>
            </Card>
        </div>
    );
};