import React, { useState, useMemo } from 'react';
import { Crown, Swords, Scale, Zap, Target, Shield, Skull, Activity } from 'lucide-react';
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer } from 'recharts';
import { Card } from '../components/UI';

const calculateStats = (matches, playerId, challengeStartDate) => {
    const startDate = challengeStartDate ? new Date(challengeStartDate).getTime() : 0;
    const playerMatches = matches.filter(m => {
        if (m.playerId !== playerId || m.type !== 'ranked') return false;
        const matchTime = m.timestamp ? m.timestamp * 1000 : new Date(m.date).getTime();
        return matchTime >= startDate;
    });

    const stats = {
        games: playerMatches.length,
        wins: 0,
        kills: 0, deaths: 0, assists: 0,
        headshots: 0, shots: 0,
        score: 0, rounds: 0,
        rrChange: 0,
        currentRank: 'Unranked',
        topAgents: {}
    };

    if (playerMatches.length > 0) {
        const lastMatch = playerMatches.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))[0];
        stats.currentRank = lastMatch.currentRank;
    }

    playerMatches.forEach(m => {
        if (m.result === 'WIN') stats.wins++;
        stats.kills += (m.kills || 0);
        stats.deaths += (m.deaths || 0);
        stats.assists += (m.assists || 0);
        stats.headshots += (m.headshots || 0);
        stats.shots += (m.totalShots || 0);
        stats.rrChange += (m.rrChange || 0);

        if (m.agent) {
            stats.topAgents[m.agent] = (stats.topAgents[m.agent] || 0) + 1;
        }

        const roundsInMatch = (m.matchScore && m.matchScore.split('-').length === 2)
            ? m.matchScore.split('-').reduce((a, b) => parseInt(a) + parseInt(b), 0)
            : 20;
        stats.rounds += roundsInMatch;
        if (m.score && m.score > 0) stats.score += m.score;
    });

    stats.winrate = stats.games > 0 ? (stats.wins / stats.games) * 100 : 0;
    stats.kd = stats.deaths > 0 ? stats.kills / stats.deaths : stats.kills;
    stats.kda = stats.deaths > 0 ? (stats.kills + stats.assists) / stats.deaths : (stats.kills + stats.assists);
    stats.hsPercent = stats.shots > 0 ? (stats.headshots / stats.shots) * 100 : 0;
    stats.acs = stats.rounds > 0 ? stats.score / stats.rounds : 0;
    stats.kpr = stats.rounds > 0 ? stats.kills / stats.rounds : 0;

    stats.radar = {
        Aim: Math.min(100, (stats.hsPercent / 40) * 100),
        Combat: Math.min(100, (stats.kd / 1.5) * 100),
        Impact: Math.min(100, (stats.acs / 280) * 100),
        Win: Math.min(100, (stats.winrate / 70) * 100)
    };

    stats.mainAgent = Object.entries(stats.topAgents).sort((a, b) => b[1] - a[1])[0]?.[0] || "Inconnu";
    stats.powerScore = (stats.kd * 400) + (stats.acs * 1.5) + (stats.winrate * 5) + (stats.hsPercent * 3);

    return stats;
};

export const VersusMode = ({ matches, players, challengeStartDate }) => {

    const [p1Id, setP1Id] = useState(players[0].id);
    const [p2Id, setP2Id] = useState(players[1].id);

    const s1 = useMemo(() => calculateStats(matches, p1Id, challengeStartDate), [matches, p1Id, challengeStartDate]);
    const s2 = useMemo(() => calculateStats(matches, p2Id, challengeStartDate), [matches, p2Id, challengeStartDate]);

    // Si aucun joueur n'est configuré, on ne peut pas afficher de VS
    if (!players || players.length < 2) {
        return <div className="text-center p-10 text-gray-500">Il faut au moins 2 joueurs configurés pour utiliser ce mode.</div>;
    }

    const p1 = players.find(p => p.id === p1Id);
    const p2 = players.find(p => p.id === p2Id);

    const radarData = [
        { subject: 'AIM (HS%)', A: s1.radar.Aim, B: s2.radar.Aim, fullMark: 100 },
        { subject: 'COMBAT (KD)', A: s1.radar.Combat, B: s2.radar.Combat, fullMark: 100 },
        { subject: 'IMPACT (ACS)', A: s1.radar.Impact, B: s2.radar.Impact, fullMark: 100 },
        { subject: 'WINRATE', A: s1.radar.Win, B: s2.radar.Win, fullMark: 100 },
    ];

    const StatRow = ({ label, v1, v2, format = (v) => v, icon: Icon }) => {
        const safeV1 = isNaN(v1) ? 0 : v1;
        const safeV2 = isNaN(v2) ? 0 : v2;

        const val1 = parseFloat(safeV1);
        const val2 = parseFloat(safeV2);
        let win1 = val1 > val2;
        let win2 = val2 > val1;
        if (val1 === val2) { win1 = false; win2 = false; }

        const total = val1 + val2;
        const p1Percent = total > 0 ? (val1 / total) * 100 : 50;
        const p2Percent = total > 0 ? (val2 / total) * 100 : 50;

        return (
            <div className="mb-6 group">
                <div className="flex justify-between items-end mb-2 px-2">
                    <span className={`font-black text-2xl font-mono ${win1 ? 'text-white scale-110' : 'text-gray-500'} transition-all`}>{format(safeV1)}</span>
                    <div className="flex flex-col items-center">
                        {Icon && <Icon size={16} className="text-gray-600 mb-1 group-hover:text-white transition-colors" />}
                        <span className="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em]">{label}</span>
                    </div>
                    <span className={`font-black text-2xl font-mono ${win2 ? 'text-white scale-110' : 'text-gray-500'} transition-all`}>{format(safeV2)}</span>
                </div>

                <div className="h-4 bg-[#0f1923] rounded-sm overflow-hidden flex relative border border-white/5 group-hover:border-white/20 transition-colors">
                    <div className="h-full transition-all duration-1000 ease-out flex items-center justify-end pr-2 relative overflow-hidden"
                        style={{ width: `${p1Percent}%`, backgroundColor: win1 ? p1.color : '#333' }}>
                        {win1 && <div className="absolute inset-0 bg-gradient-to-l from-white/20 to-transparent"></div>}
                    </div>

                    <div className="w-1 h-full bg-black z-10 transform -skew-x-12 scale-y-150"></div>

                    <div className="h-full transition-all duration-1000 ease-out flex items-center pl-2 relative overflow-hidden"
                        style={{ width: `${p2Percent}%`, backgroundColor: win2 ? p2.color : '#333' }}>
                        {win2 && <div className="absolute inset-0 bg-gradient-to-r from-white/20 to-transparent"></div>}
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="animate-in fade-in slide-in-from-bottom-8 duration-700 pb-20">
            <div className="flex flex-col md:flex-row justify-between items-center gap-8 mb-12 relative">
                <div className="flex flex-col items-center gap-4 w-full md:w-1/3 relative z-10">
                    <div className="relative group">
                        <div className="w-32 h-32 md:w-40 md:h-40 rounded-full border-4 flex items-center justify-center shadow-[0_0_50px_rgba(0,0,0,0.5)] relative overflow-hidden bg-black" style={{ borderColor: p1.color }}>
                            <span className="text-6xl font-black text-gray-700 select-none">{p1.name.charAt(0)}</span>
                            <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/80"></div>
                            <div className="absolute bottom-4 text-xs font-black text-white uppercase tracking-widest">{s1.mainAgent} Main</div>
                        </div>
                        {s1.powerScore > s2.powerScore && (
                            <div className="absolute -top-2 -right-2 bg-yellow-500 text-black p-2 rounded-full shadow-xl animate-bounce border-4 border-[#0f1923]">
                                <Crown size={24} fill="currentColor" />
                            </div>
                        )}
                    </div>

                    <select
                        value={p1Id}
                        onChange={(e) => setP1Id(e.target.value)}
                        className="bg-[#1c252e] text-white font-black text-lg py-3 px-6 rounded-xl border-2 border-white/10 outline-none focus:border-white/50 text-center w-full max-w-[250px] shadow-lg uppercase tracking-wide appearance-none cursor-pointer hover:bg-[#25303b] transition-colors"
                        style={{ color: p1.color }}
                    >
                        {players.map(p => <option key={p.id} value={p.id} disabled={p.id === p2Id}>{p.name}</option>)}
                    </select>

                    <div className="text-center bg-black/40 px-6 py-2 rounded-lg border border-white/5">
                        <div className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mb-1">Score de Puissance</div>
                        <div className="text-4xl font-black italic tracking-tighter text-white drop-shadow-md">
                            {Math.round(s1.powerScore)}
                        </div>
                    </div>
                </div>

                <div className="flex flex-col items-center justify-center relative z-0">
                    <div className="absolute inset-0 bg-[#ff4655]/20 blur-[100px] rounded-full"></div>
                    <Swords size={64} className="text-white drop-shadow-[0_0_25px_rgba(255,255,255,0.8)] relative z-10 animate-pulse" />
                    <div className="text-9xl font-black text-white/5 italic absolute select-none transform scale-150">VS</div>
                </div>

                <div className="flex flex-col items-center gap-4 w-full md:w-1/3 relative z-10">
                    <div className="relative group">
                        <div className="w-32 h-32 md:w-40 md:h-40 rounded-full border-4 flex items-center justify-center shadow-[0_0_50px_rgba(0,0,0,0.5)] relative overflow-hidden bg-black" style={{ borderColor: p2.color }}>
                            <span className="text-6xl font-black text-gray-700 select-none">{p2.name.charAt(0)}</span>
                            <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/80"></div>
                            <div className="absolute bottom-4 text-xs font-black text-white uppercase tracking-widest">{s2.mainAgent} Main</div>
                        </div>
                        {s2.powerScore > s1.powerScore && (
                            <div className="absolute -top-2 -left-2 bg-yellow-500 text-black p-2 rounded-full shadow-xl animate-bounce border-4 border-[#0f1923]">
                                <Crown size={24} fill="currentColor" />
                            </div>
                        )}
                    </div>

                    <select
                        value={p2Id}
                        onChange={(e) => setP2Id(e.target.value)}
                        className="bg-[#1c252e] text-white font-black text-lg py-3 px-6 rounded-xl border-2 border-white/10 outline-none focus:border-white/50 text-center w-full max-w-[250px] shadow-lg uppercase tracking-wide appearance-none cursor-pointer hover:bg-[#25303b] transition-colors"
                        style={{ color: p2.color }}
                    >
                        {players.map(p => <option key={p.id} value={p.id} disabled={p.id === p1Id}>{p.name}</option>)}
                    </select>

                    <div className="text-center bg-black/40 px-6 py-2 rounded-lg border border-white/5">
                        <div className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mb-1">Score de Puissance</div>
                        <div className="text-4xl font-black italic tracking-tighter text-white drop-shadow-md">
                            {Math.round(s2.powerScore)}
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 max-w-7xl mx-auto">
                <Card className="p-6 bg-[#1c252e] border-t-4 border-t-white/20 flex flex-col items-center justify-center min-h-[400px]">
                    <h3 className="text-lg font-black text-white uppercase mb-4 flex items-center gap-2">
                        <Activity className="text-purple-500" /> Analyse Tactique
                    </h3>
                    <div className="w-full h-[350px] relative">
                        <ResponsiveContainer width="100%" height="100%">
                            <RadarChart cx="50%" cy="50%" outerRadius="80%" data={radarData}>
                                <PolarGrid stroke="rgba(255,255,255,0.1)" />
                                <PolarAngleAxis dataKey="subject" tick={{ fill: '#9ca3af', fontSize: 10, fontWeight: 'bold' }} />
                                <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />

                                <Radar name={p1.name} dataKey="A" stroke={p1.color} strokeWidth={3} fill={p1.color} fillOpacity={0.3} />
                                <Radar name={p2.name} dataKey="B" stroke={p2.color} strokeWidth={3} fill={p2.color} fillOpacity={0.3} />
                            </RadarChart>
                        </ResponsiveContainer>
                        <div className="absolute bottom-0 left-0 right-0 flex justify-center gap-6">
                            <div className="flex items-center gap-2">
                                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: p1.color }}></div>
                                <span className="text-xs font-bold text-gray-400">{p1.name}</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: p2.color }}></div>
                                <span className="text-xs font-bold text-gray-400">{p2.name}</span>
                            </div>
                        </div>
                    </div>
                </Card>

                <Card className="p-8 bg-[#1c252e] border-t-4 border-t-white/20">
                    <h3 className="text-lg font-black text-white uppercase mb-8 flex items-center gap-2">
                        <Scale className="text-emerald-500" /> Comparatif Direct
                    </h3>

                    <div className="space-y-4">
                        <StatRow label="K/D Ratio" v1={s1.kd} v2={s2.kd} format={v => (v || 0).toFixed(2)} icon={Swords} />
                        <StatRow label="Score Combat (ACS)" v1={s1.acs} v2={s2.acs} format={v => Math.round(v || 0)} icon={Zap} />
                        <StatRow label="Précision Tête (HS%)" v1={s1.hsPercent} v2={s2.hsPercent} format={v => (v || 0).toFixed(1) + '%'} icon={Target} />
                        <StatRow label="Winrate" v1={s1.winrate} v2={s2.winrate} format={v => Math.round(v || 0) + '%'} icon={Crown} />
                        <StatRow label="Survie (KDA)" v1={s1.kda} v2={s2.kda} format={v => (v || 0).toFixed(2)} icon={Shield} />
                    </div>

                    <div className="mt-10 pt-6 border-t border-white/10 grid grid-cols-2 gap-4">
                        <div className="bg-black/30 p-4 rounded-xl text-center border border-white/5">
                            <div className="text-[10px] text-gray-500 uppercase font-bold mb-1">Gain RR (Période)</div>
                            <div className={`text-2xl font-black ${s1.rrChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {s1.rrChange > 0 ? '+' : ''}{s1.rrChange}
                            </div>
                        </div>
                        <div className="bg-black/30 p-4 rounded-xl text-center border border-white/5">
                            <div className="text-[10px] text-gray-500 uppercase font-bold mb-1">Gain RR (Période)</div>
                            <div className={`text-2xl font-black ${s2.rrChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {s2.rrChange > 0 ? '+' : ''}{s2.rrChange}
                            </div>
                        </div>
                    </div>
                </Card>
            </div>
        </div>
    );
};