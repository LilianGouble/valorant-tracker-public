import React, { useMemo } from 'react';
import { Target, Crosshair, Zap, Crown, Swords } from 'lucide-react';
import { Card } from '../components/UI';
import { BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, Cell } from 'recharts';

const WEAPON_COLORS = {
    'Vandal': '#d4af37', // Or
    'Phantom': '#3b82f6', // Bleu
    'Operator': '#ef4444', // Rouge
    'Sheriff': '#10b981', // Vert
    'Spectre': '#a855f7', // Violet
    'Ghost': '#9ca3af', // Gris clair
    'Classic': '#6b7280', // Gris foncé
    'Odin': '#f97316', // Orange
    'Judge': '#ec4899', // Rose
    'Marshall': '#06b6d4', // Cyan
    'Guardian': '#facc15', // Jaune
    'Bulldog': '#84cc16', // Lime
    'Outlaw': '#00ffff'  // Cyan vif
};

const WeaponRow = ({ name, stats, maxKills, totalKills, isTop }) => {
    const widthPercent = Math.max(2, (stats.kills / maxKills) * 100);
    const usagePercent = Math.round((stats.kills / totalKills) * 100);

    return (
        <div className={`flex items-center gap-3 text-xs py-2 border-b border-white/5 last:border-0 ${isTop ? 'bg-white/5 -mx-4 px-4 rounded-lg border-b-0 mb-1' : ''}`}>
            <div className="w-24 flex items-center gap-2 shrink-0">
                <div className="w-1.5 h-6 rounded-full" style={{ backgroundColor: WEAPON_COLORS[name] || '#555' }}></div>
                <div className="flex items-center gap-1">
                    <span className={`font-bold truncate ${isTop ? 'text-white' : 'text-gray-300'}`}>{name}</span>
                    {isTop && <Crown size={12} className="text-yellow-500" />}
                </div>
            </div>

            <div className="flex-grow flex flex-col justify-center gap-1 min-w-0">
                <div className="flex justify-between text-[10px] font-bold uppercase">
                    <span className={isTop ? 'text-white' : 'text-gray-400'}>{stats.kills} Kills</span>
                    <span className="text-gray-500">{usagePercent}% des kills</span>
                </div>
                <div className="w-full bg-black/50 h-2 rounded-full overflow-hidden border border-white/5">
                    <div
                        className="h-full rounded-full transition-all duration-1000 relative"
                        style={{ width: `${widthPercent}%`, backgroundColor: WEAPON_COLORS[name] || '#777' }}
                    >
                        <div className="absolute top-0 right-0 bottom-0 w-10 bg-gradient-to-r from-transparent to-white/30" />
                    </div>
                </div>
            </div>
        </div>
    );
};

export const Arsenal = ({ matches, selectedPlayerId, playersConfig }) => {
    const stats = useMemo(() => {
        let validMatches = matches.filter(m => m.type === 'ranked');

        if (selectedPlayerId !== 'all') {
            validMatches = validMatches.filter(m => m.playerId === selectedPlayerId);
        }

        const globalWeapons = {};
        const playerWeapons = {};

        playersConfig.forEach(p => playerWeapons[p.id] = { totalKills: 0, weapons: {} });

        let totalVandal = 0;
        let totalPhantom = 0;
        let totalOperator = 0;

        validMatches.forEach(m => {
            if (m.weaponStats) {
                Object.entries(m.weaponStats).forEach(([weapon, data]) => {
                    const kills = typeof data === 'number' ? data : data.kills;

                    // Global Stats
                    if (!globalWeapons[weapon]) globalWeapons[weapon] = 0;
                    globalWeapons[weapon] += kills;

                    // Débat Vandal vs Phantom
                    if (weapon === 'Vandal') totalVandal += kills;
                    if (weapon === 'Phantom') totalPhantom += kills;
                    if (weapon === 'Operator') totalOperator += kills;

                    // Player Stats
                    if (playerWeapons[m.playerId]) {
                        const pw = playerWeapons[m.playerId];
                        pw.totalKills += kills;

                        if (!pw.weapons[weapon]) pw.weapons[weapon] = { kills: 0 };
                        pw.weapons[weapon].kills += kills;
                    }
                });
            }
        });

        const totalRifles = totalVandal + totalPhantom;
        const vandalPercent = totalRifles > 0 ? Math.round((totalVandal / totalRifles) * 100) : 50;
        const phantomPercent = totalRifles > 0 ? Math.round((totalPhantom / totalRifles) * 100) : 50;

        const chartData = Object.entries(globalWeapons)
            .map(([name, value]) => ({ name, value }))
            .sort((a, b) => b.value - a.value)
            .slice(0, 10);

        const playerDetails = playersConfig.map(p => {
            const data = playerWeapons[p.id];
            const sortedWeapons = Object.entries(data.weapons)
                .sort((a, b) => b[1].kills - a[1].kills)
                .slice(0, 6);

            const topWeapon = sortedWeapons[0];
            const maxKills = topWeapon ? topWeapon[1].kills : 1;

            const sniperKills = (data.weapons['Operator']?.kills || 0) + (data.weapons['Marshall']?.kills || 0) + (data.weapons['Outlaw']?.kills || 0);
            const sniperPercent = data.totalKills > 0 ? Math.round((sniperKills / data.totalKills) * 100) : 0;

            const ecoKills = (data.weapons['Classic']?.kills || 0) + (data.weapons['Ghost']?.kills || 0) + (data.weapons['Sheriff']?.kills || 0) + (data.weapons['Frenzy']?.kills || 0) + (data.weapons['Stinger']?.kills || 0);
            const ecoPercent = data.totalKills > 0 ? Math.round((ecoKills / data.totalKills) * 100) : 0;

            return {
                ...p,
                totalKills: data.totalKills,
                topWeapons: sortedWeapons,
                maxKillsLocal: maxKills,
                sniperPercent,
                ecoPercent
            };
        }).sort((a, b) => b.totalKills - a.totalKills);

        return {
            chartData,
            playerDetails,
            vandalPercent,
            phantomPercent,
            totalOperator,
            totalGlobalKills: chartData.reduce((acc, curr) => acc + curr.value, 0)
        };
    }, [matches, selectedPlayerId, playersConfig]); // <-- Ajout ici

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="flex items-center gap-4 mb-4">
                <div className="p-3 bg-gradient-to-br from-red-500 to-orange-600 rounded-xl shadow-lg shadow-red-500/20">
                    <Target size={32} className="text-white" />
                </div>
                <div>
                    <h2 className="text-4xl font-black text-white italic tracking-tighter uppercase">L'ARSENAL</h2>
                    <p className="text-gray-400 font-medium uppercase tracking-widest text-xs">Analyse détaillée de l'armement</p>
                </div>
            </div>

            {selectedPlayerId === 'all' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <Card className="p-6 bg-[#1c252e] border-t-4 border-[#d4af37]">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-sm font-black text-white uppercase tracking-widest flex items-center gap-2">
                                <Swords size={16} className="text-[#d4af37]" /> Le Grand Débat
                            </h3>
                            <span className="text-[10px] text-gray-500 font-bold uppercase">Fusils d'assaut</span>
                        </div>

                        <div className="flex justify-between items-end mb-2">
                            <div className="flex flex-col">
                                <span className="text-2xl font-black text-[#d4af37]">{stats.vandalPercent}%</span>
                                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Vandal</span>
                            </div>
                            <div className="text-[10px] text-gray-600 font-black italic mb-1 uppercase tracking-widest">VS</div>
                            <div className="flex flex-col items-end">
                                <span className="text-2xl font-black text-[#3b82f6]">{stats.phantomPercent}%</span>
                                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Phantom</span>
                            </div>
                        </div>

                        <div className="w-full h-3 rounded-full flex overflow-hidden border border-white/5 bg-black">
                            <div className="h-full transition-all duration-1000 relative" style={{ width: `${stats.vandalPercent}%`, backgroundColor: '#d4af37' }}>
                                <div className="absolute inset-0 bg-white/20 w-1/2"></div>
                            </div>
                            <div className="h-full transition-all duration-1000 relative" style={{ width: `${stats.phantomPercent}%`, backgroundColor: '#3b82f6' }}>
                                <div className="absolute inset-0 bg-black/20 w-1/2"></div>
                            </div>
                        </div>
                    </Card>

                    <Card className="p-6 bg-[#1c252e] border-t-4 border-[#ef4444]">
                        <div className="flex justify-between items-center mb-2">
                            <h3 className="text-sm font-black text-white uppercase tracking-widest flex items-center gap-2">
                                <Crosshair size={16} className="text-[#ef4444]" /> L'Arme Fatale
                            </h3>
                        </div>
                        <div className="flex items-center gap-4">
                            <div className="flex flex-col">
                                <span className="text-4xl font-black text-white">{stats.totalOperator}</span>
                                <span className="text-xs font-bold text-[#ef4444] uppercase tracking-wider">Kills à l'Operator</span>
                            </div>
                            <div className="h-12 w-px bg-white/10 mx-2"></div>
                            <div className="flex-grow">
                                <p className="text-xs text-gray-400 font-medium">L'Operator représente <strong className="text-white">{stats.totalGlobalKills > 0 ? Math.round((stats.totalOperator / stats.totalGlobalKills) * 100) : 0}%</strong> de la létalité globale du groupe.</p>
                            </div>
                        </div>
                    </Card>
                </div>
            )}

            <Card className="p-6 bg-[#1c252e]">
                <h3 className="text-sm font-black text-white uppercase mb-6 flex items-center gap-2 tracking-widest">
                    <Target size={16} className="text-purple-500" /> Les Armes les plus meurtrières
                </h3>
                <div className="h-[250px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={stats.chartData} layout="vertical" margin={{ left: 20 }}>
                            <XAxis type="number" stroke="#9ca3af" fontSize={10} hide />
                            <YAxis dataKey="name" type="category" stroke="#fff" width={80} fontSize={11} fontWeight="bold" />
                            <RechartsTooltip
                                contentStyle={{ backgroundColor: '#0f1923', borderColor: 'rgba(255,255,255,0.1)', color: '#fff', borderRadius: '8px' }}
                                cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                                itemStyle={{ color: '#fff', fontWeight: 'bold' }}
                            />
                            <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={16}>
                                {stats.chartData.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={WEAPON_COLORS[entry.name] || '#6b7280'} />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {stats.playerDetails.filter(p => p.totalKills > 0).map((p) => (
                    <Card key={p.id} className="flex flex-col bg-[#1c252e] border-t-4 hover:scale-[1.02] transition-transform duration-300" style={{ borderTopColor: p.color }}>
                        <div className="p-4 border-b border-white/5 bg-gradient-to-b from-white/5 to-transparent">
                            <div className="flex items-center gap-3 mb-3">
                                <div className="w-12 h-12 rounded-xl flex items-center justify-center font-black text-xl text-white shadow-lg border border-white/10" style={{ backgroundColor: p.color }}>
                                    {p.name.charAt(0)}
                                </div>
                                <div className="flex flex-col min-w-0">
                                    <h4 className="font-black text-white uppercase text-base leading-none truncate">{p.name}</h4>
                                    <span className="text-[10px] text-gray-400 font-bold uppercase mt-1">{p.totalKills} Kills Trackés</span>
                                </div>
                            </div>
                            <div className="flex gap-2">
                                {p.sniperPercent > 15 && (
                                    <div className="bg-red-500/20 border border-red-500/50 text-red-400 text-[9px] font-bold px-2 py-0.5 rounded flex items-center gap-1">
                                        <Crosshair size={10} /> SNIPER ({p.sniperPercent}%)
                                    </div>
                                )}
                                {p.ecoPercent > 20 && (
                                    <div className="bg-green-500/20 border border-green-500/50 text-green-400 text-[9px] font-bold px-2 py-0.5 rounded flex items-center gap-1">
                                        <Zap size={10} /> ROI DE L'ÉCO ({p.ecoPercent}%)
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="p-4 flex-grow flex flex-col gap-1">
                            {p.topWeapons.map(([weaponName, weaponData], index) => (
                                <WeaponRow
                                    key={weaponName}
                                    name={weaponName}
                                    stats={weaponData}
                                    maxKills={p.maxKillsLocal}
                                    totalKills={p.totalKills}
                                    isTop={index === 0}
                                />
                            ))}
                        </div>
                    </Card>
                ))}
            </div>
        </div>
    );
};