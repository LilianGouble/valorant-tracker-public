import React, { useState, useMemo } from 'react';
import { Target, Shield, Crosshair, Map as MapIcon, ChevronRight, TrendingUp, AlertTriangle } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell, PieChart, Pie } from 'recharts';
import { Card, Badge } from '../components/UI';

const SITE_COLORS = { 'A': '#ff4655', 'B': '#10b981', 'C': '#3b82f6' };

export const GunRoundStrategy = ({ matches, playersConfig }) => {
    const [selectedMap, setSelectedMap] = useState(null);

    const mapStrategies = useMemo(() => {
        const stats = {};

        matches.forEach(m => {
            if (m.type !== 'ranked' || !m.roundDetails) return;

            if (!stats[m.map]) {
                stats[m.map] = {
                    name: m.map,
                    totalGunRoundsAttack: 0,
                    sites: {
                        A: { plants: 0, wins: 0 },
                        B: { plants: 0, wins: 0 },
                        C: { plants: 0, wins: 0 }
                    }
                };
            }

            const gunRoundsAttack = m.roundDetails.filter(r => r.isGunRound && r.side === 'Attack');

            gunRoundsAttack.forEach(r => {
                stats[m.map].totalGunRoundsAttack++;

                if (r.plantSite) {
                    const s = r.plantSite;
                    if (stats[m.map].sites[s]) {
                        stats[m.map].sites[s].plants++;
                        if (r.won) stats[m.map].sites[s].wins++;
                    }
                }
            });
        });

        return Object.values(stats).map(map => {
            const totalPlants = map.sites.A.plants + map.sites.B.plants + map.sites.C.plants;

            const strategies = ['A', 'B', 'C'].map(site => {
                const data = map.sites[site];
                if (data.plants === 0) return null;
                return {
                    site,
                    plantRate: Math.round((data.plants / totalPlants) * 100),
                    postPlantWinRate: Math.round((data.wins / data.plants) * 100),
                    plants: data.plants,
                    wins: data.wins
                };
            }).filter(Boolean);

            return { ...map, strategies, totalPlants };
        }).sort((a, b) => b.totalPlants - a.totalPlants);
    }, [matches, playersConfig]); // <-- Modif ici

    const activeMapData = selectedMap ? mapStrategies.find(m => m.name === selectedMap) : mapStrategies[0];

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-gradient-to-br from-orange-500 to-red-600 rounded-xl shadow-lg">
                        <Crosshair size={32} className="text-white" />
                    </div>
                    <div>
                        <h2 className="text-4xl font-black text-white italic tracking-tighter uppercase">STRATÉGIE GUN ROUND</h2>
                        <p className="text-gray-400 font-medium uppercase tracking-widest text-xs">Où planter pour gagner quand on est armé ?</p>
                    </div>
                </div>

                <div className="flex gap-2 overflow-x-auto pb-2 max-w-full custom-scrollbar">
                    {mapStrategies.map(m => (
                        <button
                            key={m.name}
                            onClick={() => setSelectedMap(m.name)}
                            className={`px-4 py-2 rounded-lg text-xs font-black uppercase whitespace-nowrap transition-all ${(activeMapData?.name === m.name)
                                ? 'bg-[#ff4655] text-white shadow-lg'
                                : 'bg-[#1c252e] text-gray-500 hover:text-white border border-white/5'
                                }`}
                        >
                            {m.name}
                        </button>
                    ))}
                </div>
            </div>

            {activeMapData ? (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <Card className="lg:col-span-2 p-6 bg-[#1c252e] relative overflow-hidden">
                        <div className="absolute top-0 right-0 p-4 opacity-10">
                            <MapIcon size={120} />
                        </div>
                        <h3 className="text-2xl font-black text-white uppercase italic mb-6 flex items-center gap-2">
                            ANALYSE : {activeMapData.name}
                        </h3>

                        {activeMapData.strategies.length > 0 ? (
                            <div className="space-y-6">
                                {activeMapData.strategies.map(strat => (
                                    <div key={strat.site} className="relative bg-black/20 rounded-xl p-4 border border-white/5 flex flex-col md:flex-row gap-6 items-center">
                                        <div className="w-16 h-16 rounded-lg flex items-center justify-center text-4xl font-black text-white shadow-lg shrink-0" style={{ backgroundColor: SITE_COLORS[strat.site] }}>
                                            {strat.site}
                                        </div>
                                        <div className="flex-grow w-full space-y-4">
                                            <div>
                                                <div className="flex justify-between text-xs font-bold uppercase mb-1">
                                                    <span className="text-gray-400">Fréquence de Plant</span>
                                                    <span className="text-white">{strat.plantRate}% ({strat.plants} fois)</span>
                                                </div>
                                                <div className="h-2 w-full bg-gray-800 rounded-full overflow-hidden">
                                                    <div className="h-full bg-white transition-all duration-1000" style={{ width: `${strat.plantRate}%` }}></div>
                                                </div>
                                            </div>
                                            <div>
                                                <div className="flex justify-between text-xs font-bold uppercase mb-1">
                                                    <span className="text-gray-400">Winrate Post-Plant (Une fois posé)</span>
                                                    <span className={`${strat.postPlantWinRate > 50 ? 'text-emerald-400' : 'text-red-400'}`}>{strat.postPlantWinRate}%</span>
                                                </div>
                                                <div className="h-2 w-full bg-gray-800 rounded-full overflow-hidden">
                                                    <div
                                                        className={`h-full transition-all duration-1000 ${strat.postPlantWinRate > 50 ? 'bg-emerald-500' : 'bg-red-500'}`}
                                                        style={{ width: `${strat.postPlantWinRate}%` }}
                                                    ></div>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="w-full md:w-48 shrink-0 text-center md:text-right">
                                            {strat.postPlantWinRate > 60 ? (
                                                <div className="text-emerald-400 font-bold text-sm uppercase flex items-center justify-center md:justify-end gap-1">
                                                    <Shield size={14} /> Forteresse
                                                </div>
                                            ) : strat.postPlantWinRate < 40 ? (
                                                <div className="text-red-400 font-bold text-sm uppercase flex items-center justify-center md:justify-end gap-1">
                                                    <AlertTriangle size={14} /> Piège
                                                </div>
                                            ) : (
                                                <div className="text-yellow-400 font-bold text-sm uppercase flex items-center justify-center md:justify-end gap-1">
                                                    <TrendingUp size={14} /> Contesté
                                                </div>
                                            )}
                                            <p className="text-[10px] text-gray-500 mt-1 leading-tight">
                                                {strat.postPlantWinRate > 60 && strat.plantRate < 30
                                                    ? "Site très fort mais sous-utilisé. Allez-y plus souvent !"
                                                    : strat.postPlantWinRate < 40 && strat.plantRate > 40
                                                        ? "Vous plantez trop souvent ici pour peu de résultats."
                                                        : "Stats équilibrées."
                                                }
                                            </p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="h-40 flex items-center justify-center text-gray-500 italic">
                                Pas assez de données de plant sur cette map.
                            </div>
                        )}
                    </Card>

                    <div className="space-y-6">
                        <Card className="p-6 bg-gradient-to-br from-indigo-900 to-[#1c252e] border-l-4 border-l-indigo-500">
                            <h4 className="text-lg font-black text-white uppercase mb-2 flex items-center gap-2">
                                <Target size={20} /> Stratégie Recommandée
                            </h4>
                            {activeMapData.strategies.length > 0 ? (
                                (() => {
                                    const bestSite = [...activeMapData.strategies].sort((a, b) => b.postPlantWinRate - a.postPlantWinRate)[0];
                                    const worstSite = [...activeMapData.strategies].sort((a, b) => a.postPlantWinRate - b.postPlantWinRate)[0];

                                    return (
                                        <div className="space-y-4 text-sm text-gray-300">
                                            <p>
                                                Sur <span className="text-white font-bold">{activeMapData.name}</span>, votre meilleur site de plant en Gun Round est le <span className="text-emerald-400 font-black text-lg">Site {bestSite.site}</span> avec <span className="text-white font-bold">{bestSite.postPlantWinRate}%</span> de réussite.
                                            </p>
                                            {worstSite && worstSite.postPlantWinRate < 45 && worstSite.site !== bestSite.site && (
                                                <p className="border-t border-white/10 pt-2">
                                                    ⚠️ Évitez le <span className="text-red-400 font-bold">Site {worstSite.site}</span> ({worstSite.postPlantWinRate}% WR). Le retake adverse y est trop facile pour vous.
                                                </p>
                                            )}
                                        </div>
                                    );
                                })()
                            ) : (
                                <p className="text-gray-500 text-sm">Jouez plus de Gun Rounds pour débloquer les conseils.</p>
                            )}
                        </Card>

                        <Card className="p-4 bg-[#1c252e]">
                            <h4 className="text-xs font-black text-gray-500 uppercase mb-4 text-center">Répartition des Plants</h4>
                            <div className="h-40">
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={activeMapData.strategies}
                                            dataKey="plantRate"
                                            nameKey="site"
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={30}
                                            outerRadius={50}
                                            paddingAngle={5}
                                        >
                                            {activeMapData.strategies.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={SITE_COLORS[entry.site]} />
                                            ))}
                                        </Pie>
                                        <Tooltip
                                            contentStyle={{ backgroundColor: '#1c252e', borderColor: '#333', borderRadius: '8px', fontSize: '10px' }}
                                            itemStyle={{ color: '#fff' }}
                                        />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                            <div className="flex justify-center gap-4 text-[10px] font-bold uppercase mt-2">
                                {activeMapData.strategies.map(s => (
                                    <div key={s.site} className="flex items-center gap-1">
                                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: SITE_COLORS[s.site] }}></div>
                                        <span className="text-gray-400">Site {s.site}</span>
                                    </div>
                                ))}
                            </div>
                        </Card>
                    </div>
                </div>
            ) : (
                <div className="text-center py-20 text-gray-500 font-black uppercase text-xl">
                    Aucune donnée de Gun Round disponible
                </div>
            )}
        </div>
    );
};