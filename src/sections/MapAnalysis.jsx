import React, { useMemo, useState, useEffect } from 'react';
import { Map as MapIcon, Shield, Flame, Target, X, Eye, BrainCircuit, Users, AlertTriangle, TrendingUp, Check, Award } from 'lucide-react';
import { Card, Badge } from '../components/UI';
import { BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, Cell, PieChart, Pie, Tooltip } from 'recharts';
import { calculateWinrate, calculateKD, safeDiv } from '../utils/calculations';

const SITE_COLORS = { 'A': '#ff4655', 'B': '#10b981', 'C': '#3b82f6' };

const AGENT_ROLES = {
    "Jett": "Duelist", "Phoenix": "Duelist", "Reyna": "Duelist", "Raze": "Duelist", "Yoru": "Duelist", "Neon": "Duelist", "Iso": "Duelist",
    "Brimstone": "Controller", "Viper": "Controller", "Omen": "Controller", "Astra": "Controller", "Harbor": "Controller", "Clove": "Controller",
    "Sova": "Initiator", "Breach": "Initiator", "Skye": "Initiator", "KAY/O": "Initiator", "Fade": "Initiator", "Gekko": "Initiator", "Tejo": "Initiator",
    "Killjoy": "Sentinel", "Cypher": "Sentinel", "Sage": "Sentinel", "Chamber": "Sentinel", "Deadlock": "Sentinel", "Vyse": "Sentinel"
};

const normalizeId = (id) => id ? id.toLowerCase() : '';

const getPlayerColor = (puuid, playersConfig) => {
    if (!puuid) return '#ff0000';
    const player = playersConfig.find(p => normalizeId(p.id) === normalizeId(puuid));
    return player ? player.color : '#ff0000';
};

const CoachModal = ({ mapName, matches, onClose, playersConfig }) => {
    const [selectedPlayers, setSelectedPlayers] = useState(() => {
        const initialSet = new Set();
        playersConfig.slice(0, 5).forEach(p => initialSet.add(p.id));
        return initialSet;
    });

    const togglePlayer = (id) => {
        const newSet = new Set(selectedPlayers);
        if (newSet.has(id)) {
            newSet.delete(id);
        } else {
            if (newSet.size >= 5) {
                alert("Maximum 5 joueurs pour une équipe !");
                return;
            }
            newSet.add(id);
        }
        setSelectedPlayers(newSet);
    };

    const { finalComposition, warnings, statsGlobales } = useMemo(() => {
        const poolOfOptions = [];

        selectedPlayers.forEach(playerId => {
            const playerConfig = playersConfig.find(p => p.id === playerId);
            if (!playerConfig) return;

            const agentStats = {};

            matches.forEach(m => {
                if (m.type !== 'ranked') return;

                let pData = (m.allPlayers || []).find(p => normalizeId(p.puuid) === normalizeId(playerId));
                if (!pData) pData = (m.allPlayers || []).find(p => p.name?.toLowerCase() === playerConfig.name.toLowerCase());

                if (!pData) return;

                const agent = pData.character;
                if (!agent) return;

                if (!agentStats[agent]) {
                    agentStats[agent] = {
                        name: agent, img: pData.assets?.agent?.small,
                        mapGames: 0, mapWins: 0, globalGames: 0, globalWins: 0,
                        kills: 0, deaths: 0
                    };
                }

                const s = agentStats[agent];
                s.globalGames++;
                s.kills += (pData.stats?.kills || 0);
                s.deaths += (pData.stats?.deaths || 0);

                const blueWon = m.teams?.blue?.has_won;
                const redWon = m.teams?.red?.has_won;
                const blueRounds = m.teams?.blue?.rounds_won || 0;
                const redRounds = m.teams?.red?.rounds_won || 0;

                let isWin = false;
                if (pData.team === 'Blue') isWin = blueWon || (blueRounds > redRounds);
                if (pData.team === 'Red') isWin = redWon || (redRounds > blueRounds);

                if (isWin) s.globalWins++;

                if (m.map && m.map.toLowerCase() === mapName.toLowerCase()) {
                    s.mapGames++;
                    if (isWin) s.mapWins++;
                }
            });

            Object.values(agentStats).forEach(stat => {
                const wrMap = stat.mapGames > 0 ? (stat.mapWins / stat.mapGames) : 0;
                const wrGlobal = stat.globalGames > 0 ? (stat.globalWins / stat.globalGames) : 0;

                let score = 0;
                let source = 'Main (Fallback)';

                if (stat.mapGames > 0) {
                    score += (wrMap * 200) + (stat.mapGames * 10);
                    source = 'Expert Map';
                } else {
                    score += (wrGlobal * 50) + (stat.globalGames * 2);
                }

                const kd = stat.deaths > 0 ? stat.kills / stat.deaths : stat.kills;
                if (kd < 0.8) score -= 20;

                poolOfOptions.push({
                    playerId, player: playerConfig, agent: stat, score, source,
                    stats: { wr: Math.round((stat.mapGames > 0 ? wrMap : wrGlobal) * 100), kd: kd.toFixed(2), games: stat.mapGames > 0 ? stat.mapGames : stat.globalGames }
                });
            });
        });

        poolOfOptions.sort((a, b) => b.score - a.score);

        const assignedPlayers = new Set();
        const assignedAgents = new Set();
        const finalComposition = [];

        poolOfOptions.forEach(option => {
            if (assignedPlayers.has(option.playerId) || assignedAgents.has(option.agent.name)) return;
            assignedPlayers.add(option.playerId);
            assignedAgents.add(option.agent.name);
            finalComposition.push(option);
        });

        selectedPlayers.forEach(pId => {
            if (!assignedPlayers.has(pId)) {
                const pConfig = playersConfig.find(p => p.id === pId);
                finalComposition.push({
                    playerId: pId, player: pConfig, agent: null, score: -1, source: "Aucune option valide",
                    stats: { wr: 0, kd: 0, games: 0 }
                });
            }
        });

        const warnings = [];
        const roleCounts = { Duelist: 0, Controller: 0, Initiator: 0, Sentinel: 0 };

        finalComposition.forEach(slot => {
            if (slot.agent) {
                const role = AGENT_ROLES[slot.agent.name];
                if (role) roleCounts[role]++;
            }
        });

        if (roleCounts.Controller === 0) warnings.push("⚠️ MANQUE : SMOKE (Contrôleur)");
        if (roleCounts.Duelist === 0) warnings.push("⚠️ MANQUE : ENTRY (Duelliste)");
        if (roleCounts.Initiator === 0) warnings.push("⚠️ MANQUE : INFO (Initiateur)");
        if (roleCounts.Sentinel === 0) warnings.push("⚠️ MANQUE : DÉFENSE (Sentinelle)");
        if (roleCounts.Duelist > 2) warnings.push("❌ Trop de Duellistes (>2)");
        if (roleCounts.Initiator >= 2) warnings.push("✅ Double Initiateur (Meta)");
        if (roleCounts.Controller >= 2) warnings.push("✅ Double Smoke (Contrôle)");

        if (Object.values(roleCounts).every(c => c >= 1)) warnings.push("🔥 COMPOSITION ÉQUILIBRÉE");

        let avgWr = 0; let count = 0;
        finalComposition.forEach(f => {
            if (f.agent) { avgWr += f.stats.wr; count++; }
        });
        const teamScore = count > 0 ? Math.round(avgWr / count) : 0;

        return { finalComposition, warnings, statsGlobales: { teamScore } };
    }, [matches, mapName, selectedPlayers, playersConfig]);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/95 backdrop-blur-md animate-in fade-in duration-200">
            <div className="relative w-full max-w-6xl bg-[#1c252e] border border-white/10 rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[95vh]">
                <div className="p-6 border-b border-white/5 bg-gradient-to-r from-purple-900/40 to-[#1c252e] flex justify-between items-center shrink-0">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-xl shadow-lg">
                            <BrainCircuit size={24} className="text-white" />
                        </div>
                        <div>
                            <h3 className="text-2xl font-black text-white uppercase italic tracking-tighter">COACH IA : {mapName}</h3>
                            <p className="text-gray-400 font-bold uppercase text-xs">Générateur de Composition Optimale</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors">
                        <X size={24} />
                    </button>
                </div>

                <div className="p-6 overflow-y-auto custom-scrollbar">
                    <div className="mb-6">
                        <div className="flex justify-between items-end mb-3">
                            <h4 className="text-xs font-black uppercase text-gray-500 flex items-center gap-2"><Users size={14} /> Sélection (Max 5)</h4>
                            <span className={`text-xs font-bold ${selectedPlayers.size === 5 ? 'text-emerald-400' : 'text-orange-400'}`}>
                                {selectedPlayers.size} / 5 Joueurs
                            </span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {playersConfig.map(p => {
                                const isSelected = selectedPlayers.has(p.id);
                                return (
                                    <button
                                        key={p.id}
                                        onClick={() => togglePlayer(p.id)}
                                        className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-all ${isSelected ? 'bg-purple-500/20 border-purple-500 text-white shadow' : 'bg-black/20 border-white/5 text-gray-500 hover:bg-white/5'}`}
                                    >
                                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }}></div>
                                        <span className="text-xs font-bold uppercase">{p.name}</span>
                                        {isSelected && <Check size={12} className="ml-auto text-purple-400" />}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div className="bg-black/20 rounded-2xl p-6 border border-white/5">
                        <div className="flex flex-wrap gap-4 mb-6 items-center justify-center bg-white/5 p-3 rounded-xl border border-white/5">
                            <div className="text-sm font-bold text-gray-300 border-r border-white/10 pr-4 mr-2">
                                Potentiel : <span className={`text-lg font-black ${statsGlobales.teamScore > 50 ? 'text-emerald-400' : 'text-yellow-400'}`}>{statsGlobales.teamScore}% WR</span>
                            </div>
                            {warnings.length > 0 ? (
                                warnings.map((w, i) => (
                                    <span key={i} className={`text-xs font-bold px-2 py-1 rounded ${w.includes('✅') || w.includes('🔥') ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'}`}>
                                        {w}
                                    </span>
                                ))
                            ) : (
                                <span className="text-xs text-gray-500 italic">Analyse en cours...</span>
                            )}
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                            {finalComposition.map((slot, idx) => (
                                <Card key={idx} className={`relative overflow-hidden p-4 border flex flex-col items-center text-center transition-all ${slot.agent ? 'bg-[#1c252e] border-white/10' : 'bg-red-900/10 border-red-500/30'}`}>
                                    <div className="mb-3 w-full border-b border-white/5 pb-2">
                                        <div className="text-[9px] font-black uppercase tracking-widest text-gray-500 mb-1">Joueur</div>
                                        <div className="font-bold text-white text-sm" style={{ color: slot.player.color }}>{slot.player.name}</div>
                                    </div>

                                    {slot.agent ? (
                                        <>
                                            <div className="w-20 h-20 rounded-xl bg-gray-800 mb-3 overflow-hidden shadow-lg border border-white/10 relative group">
                                                <img src={slot.agent.img} alt={slot.agent.name} className="w-full h-full object-cover transition-transform group-hover:scale-110" />
                                            </div>
                                            <div className="text-xl font-black text-white italic uppercase mb-1">{slot.agent.name}</div>
                                            <div className="text-[9px] font-bold text-gray-500 mb-2 uppercase tracking-widest">{AGENT_ROLES[slot.agent.name] || 'FLEX'}</div>
                                            <Badge className={`mb-3 ${slot.source === 'Expert Map' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-yellow-500/20 text-yellow-400'}`}>
                                                {slot.source === 'Expert Map' ? 'Expert Map' : 'Main Agent'}
                                            </Badge>
                                            <div className="w-full grid grid-cols-2 gap-2 text-[10px] uppercase font-bold text-gray-400 bg-black/40 p-2 rounded border border-white/5">
                                                <div>WR: <span className={slot.stats.wr >= 50 ? 'text-emerald-400' : 'text-red-400'}>{slot.stats.wr}%</span></div>
                                                <div>K/D: <span className="text-white">{slot.stats.kd}</span></div>
                                                <div className="col-span-2 text-center text-gray-500 border-t border-white/10 pt-1 mt-1">
                                                    {slot.stats.games} Game{slot.stats.games > 1 ? 's' : ''}
                                                </div>
                                            </div>
                                        </>
                                    ) : (
                                        <div className="flex-grow flex flex-col justify-center items-center opacity-50 min-h-[120px]">
                                            <AlertTriangle size={32} className="mb-2 text-red-400" />
                                            <span className="text-[10px] uppercase font-bold text-red-300">Aucun Agent Trouvé</span>
                                            <span className="text-[9px] mt-1 text-gray-400 max-w-[120px]">Pas assez de données.</span>
                                        </div>
                                    )}
                                </Card>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const StrategyModal = ({ mapData, matches, onClose }) => {
    const strategies = useMemo(() => {
        const stats = { A: { plants: 0, wins: 0 }, B: { plants: 0, wins: 0 }, C: { plants: 0, wins: 0 } };
        let hasData = false;

        matches.forEach(m => {
            if (m.type !== 'ranked' || !m.map || m.map.toLowerCase() !== mapData.name.toLowerCase()) return;
            if (m.roundDetails && Array.isArray(m.roundDetails)) {
                m.roundDetails.forEach(r => {
                    if (r.side === 'Attack' && r.plantSite && stats[r.plantSite]) {
                        stats[r.plantSite].plants++;
                        if (r.won) stats[r.plantSite].wins++;
                        hasData = true;
                    }
                });
            }
        });

        if (!hasData) return [];

        const totalPlants = stats.A.plants + stats.B.plants + stats.C.plants;
        return ['A', 'B', 'C'].map(site => {
            const data = stats[site];
            if (data.plants === 0) return null;
            return {
                site,
                plantRate: Math.round((data.plants / totalPlants) * 100),
                postPlantWinRate: Math.round((data.wins / data.plants) * 100),
                plants: data.plants,
                wins: data.wins
            };
        }).filter(Boolean);
    }, [matches, mapData]);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/95 backdrop-blur-md animate-in fade-in duration-200">
            <div className="relative w-full max-w-5xl bg-[#1c252e] border border-white/10 rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
                <div className="p-6 border-b border-white/5 bg-gradient-to-r from-orange-600/20 to-[#1c252e] flex justify-between items-center shrink-0">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-gradient-to-br from-orange-500 to-red-600 rounded-xl shadow-lg">
                            <Target size={24} className="text-white" />
                        </div>
                        <div>
                            <h3 className="text-2xl font-black text-white uppercase italic tracking-tighter">STRATÉGIE DE PUSH : {mapData.name}</h3>
                            <p className="text-gray-400 font-bold uppercase text-xs">Analyse des rounds d'attaque avec plant</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors"><X size={24} /></button>
                </div>

                <div className="p-6 overflow-y-auto custom-scrollbar">
                    {strategies.length > 0 ? (
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                            <div className="lg:col-span-2 space-y-4">
                                {strategies.map(strat => (
                                    <div key={strat.site} className="relative bg-black/20 rounded-xl p-4 border border-white/5 flex flex-col md:flex-row gap-6 items-center">
                                        <div className="w-16 h-16 rounded-lg flex items-center justify-center text-4xl font-black text-white shadow-lg shrink-0" style={{ backgroundColor: SITE_COLORS[strat.site] }}>{strat.site}</div>
                                        <div className="flex-grow w-full space-y-4">
                                            <div>
                                                <div className="flex justify-between text-xs font-bold uppercase mb-1">
                                                    <span className="text-gray-400">Fréquence de Plant</span>
                                                    <span className="text-white">{strat.plantRate}% ({strat.plants} fois)</span>
                                                </div>
                                                <div className="h-2 w-full bg-gray-800 rounded-full overflow-hidden"><div className="h-full bg-white" style={{ width: `${strat.plantRate}%` }}></div></div>
                                            </div>
                                            <div>
                                                <div className="flex justify-between text-xs font-bold uppercase mb-1">
                                                    <span className="text-gray-400">Winrate Post-Plant</span>
                                                    <span className={`${strat.postPlantWinRate > 50 ? 'text-emerald-400' : 'text-red-400'}`}>{strat.postPlantWinRate}%</span>
                                                </div>
                                                <div className="h-2 w-full bg-gray-800 rounded-full overflow-hidden"><div className={`h-full ${strat.postPlantWinRate > 50 ? 'bg-emerald-500' : 'bg-red-500'}`} style={{ width: `${strat.postPlantWinRate}%` }}></div></div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <div className="space-y-4">
                                <Card className="p-4 bg-[#1c252e] border-l-4 border-l-orange-500">
                                    <h4 className="text-sm font-black text-white uppercase mb-4 text-center">Répartition</h4>
                                    <div className="h-40">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <PieChart>
                                                <Pie data={strategies} dataKey="plantRate" nameKey="site" cx="50%" cy="50%" innerRadius={30} outerRadius={50} paddingAngle={5}>
                                                    {strategies.map((entry, index) => <Cell key={`cell-${index}`} fill={SITE_COLORS[entry.site]} />)}
                                                </Pie>
                                                <Tooltip contentStyle={{ backgroundColor: '#1c252e', borderColor: '#333' }} />
                                            </PieChart>
                                        </ResponsiveContainer>
                                    </div>
                                    <Card className="p-4 bg-white/5 mt-4">
                                        {(() => {
                                            const best = [...strategies].sort((a, b) => b.postPlantWinRate - a.postPlantWinRate)[0];
                                            return best ? (
                                                <div className="text-sm text-gray-300">
                                                    <div className="flex items-center gap-2 mb-2 text-emerald-400 font-bold uppercase"><Award size={16} /> Conseil IA</div>
                                                    Poussez le <span className="text-white font-black">Site {best.site}</span> ! ({best.postPlantWinRate}% Win).
                                                </div>
                                            ) : null;
                                        })()}
                                    </Card>
                                </Card>
                            </div>
                        </div>
                    ) : (
                        <div className="text-center py-20 text-gray-500 font-black uppercase text-xl">Aucune donnée stratégique.</div>
                    )}
                </div>
            </div>
        </div>
    );
};

const DeathMapModal = ({ mapName, deaths, onClose, playersConfig }) => {
    const [mapData, setMapData] = useState(null);
    const [visiblePlayers, setVisiblePlayers] = useState(new Set(playersConfig.map(p => p.id)));

    useEffect(() => {
        const fetchMapData = async () => {
            try {
                const res = await fetch('https://valorant-api.com/v1/maps');
                const data = await res.json();
                const foundMap = data.data.find(m => m.displayName.toLowerCase() === mapName.toLowerCase());
                if (foundMap) setMapData(foundMap);
            } catch (e) { }
        };
        fetchMapData();
    }, [mapName]);

    const togglePlayerVisibility = (playerId) => {
        const newSet = new Set(visiblePlayers);
        newSet.has(playerId) ? newSet.delete(playerId) : newSet.add(playerId);
        setVisiblePlayers(newSet);
    };

    const atkDeaths = deaths.filter(d => d.side === 'Attack');
    const defDeaths = deaths.filter(d => d.side === 'Defend');

    const renderMap = (title, icon, borderColor, deathsList) => {
        const filteredDeaths = deathsList.filter(d => !d.puuid || visiblePlayers.has(d.puuid));
        return (
            <div className={`relative w-full aspect-square bg-black border-2 ${borderColor} rounded-xl overflow-hidden flex flex-col`}>
                <div className="absolute top-4 left-4 z-10 pointer-events-none drop-shadow-md">
                    <div className="flex items-center gap-2 text-xl font-black text-white uppercase">{icon} {title}</div>
                    <p className="text-sm font-bold text-gray-300">{filteredDeaths.length} MORTS</p>
                </div>
                <div className="relative w-full h-full flex items-center justify-center overflow-hidden">
                    {mapData ? (
                        <div className="relative w-full h-full">
                            <img src={mapData.displayIcon} alt={mapName} className="w-full h-full object-contain opacity-60" />
                            {filteredDeaths.map((d, i) => {
                                if (!mapData.xMultiplier || !mapData.yMultiplier) return null;
                                const x = (d.y * mapData.xMultiplier) + mapData.xScalarToAdd;
                                const y = (d.x * mapData.yMultiplier) + mapData.yScalarToAdd;
                                const color = getPlayerColor(d.puuid, playersConfig);
                                if (x < 0 || x > 1 || y < 0 || y > 1) return null;
                                return (
                                    <div key={i} className="absolute w-3 h-3 transform -translate-x-1/2 -translate-y-1/2 hover:scale-150 transition-transform cursor-crosshair z-20 flex items-center justify-center group" style={{ left: `${x * 100}%`, top: `${y * 100}%` }}>
                                        <X size={14} strokeWidth={4} color={color} />
                                    </div>
                                );
                            })}
                        </div>
                    ) : <div className="text-white animate-pulse">Chargement...</div>}
                </div>
            </div>
        );
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/95 backdrop-blur-md animate-in fade-in duration-200">
            <div className="relative w-full max-w-[90vh] flex flex-col gap-4">
                <div className="flex justify-between items-center text-white">
                    <h3 className="text-3xl font-black uppercase italic">{mapName} - HEATMAPS</h3>
                    <button onClick={onClose} className="p-2 bg-white/10 hover:bg-red-500 rounded-full transition-colors"><X size={24} /></button>
                </div>
                <div className="flex flex-wrap gap-2 justify-center bg-white/5 p-3 rounded-lg border border-white/5">
                    {playersConfig.map(p => (
                        <button key={p.id} onClick={() => togglePlayerVisibility(p.id)} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all ${visiblePlayers.has(p.id) ? 'bg-white/10 border-white/20' : 'bg-black/40 border-transparent opacity-40 grayscale'}`}>
                            <div className={`w-2.5 h-2.5 rounded-full`} style={{ backgroundColor: p.color }}></div>
                            <span className="text-xs font-bold uppercase text-white">{p.name}</span>
                        </button>
                    ))}
                </div>
                <div className="grid grid-cols-2 gap-4">
                    {renderMap("ATTAQUE", <Flame size={20} className="text-red-500" />, "border-red-500/30", atkDeaths)}
                    {renderMap("DÉFENSE", <Shield size={20} className="text-blue-500" />, "border-blue-500/30", defDeaths)}
                </div>
            </div>
        </div>
    );
};

export const MapAnalysis = ({ matches, playersConfig }) => {
    const [selectedMapForDeathView, setSelectedMapForDeathView] = useState(null);
    const [selectedMapForStrategy, setSelectedMapForStrategy] = useState(null);
    const [selectedMapForCoach, setSelectedMapForCoach] = useState(null);

    const mapStats = useMemo(() => {
        const validMatches = matches.filter(m => m.type === 'ranked');

        const stats = {};
        const processedMatchIds = new Set();

        validMatches.forEach(m => {
            if (!stats[m.map]) {
                stats[m.map] = {
                    name: m.map,
                    games: 0, wins: 0, kills: 0, deaths: 0,
                    atkRounds: 0, atkWins: 0, defRounds: 0, defWins: 0, totalRounds: 0,
                    sitesDisplay: { A: 0, B: 0, C: 0 },
                    deathLocations: []
                };
            }

            const s = stats[m.map];

            if (!processedMatchIds.has(m.id)) {
                processedMatchIds.add(m.id);
                if (m.deathCoordinates) s.deathLocations.push(...m.deathCoordinates);
                s.games++;

                if (m.result === 'WIN') s.wins++;

                if (m.sides) {
                    s.atkRounds += m.sides.atkRounds; s.atkWins += m.sides.atkWins;
                    s.defRounds += m.sides.defRounds; s.defWins += m.sides.defWins;
                    s.totalRounds += (m.sides.atkRounds + m.sides.defRounds);
                }

                if (m.roundDetails) {
                    m.roundDetails.forEach(r => {
                        if (r.side === 'Attack' && r.plantSite && s.sitesDisplay[r.plantSite] !== undefined) {
                            s.sitesDisplay[r.plantSite]++;
                        }
                    });
                }
            }
            s.kills += m.kills;
            s.deaths += m.deaths;
        });

        return Object.values(stats)
            .map(m => {
                const chartData = [
                    { name: 'A', value: m.sitesDisplay.A },
                    { name: 'B', value: m.sitesDisplay.B },
                    { name: 'C', value: m.sitesDisplay.C }
                ].filter(d => d.value > 0);

                return {
                    ...m,
                    winrate: calculateWinrate(m.wins, m.games),
                    kd: calculateKD(m.kills, m.deaths),
                    atkWr: Math.round(safeDiv(m.atkWins, m.atkRounds) * 100),
                    defWr: Math.round(safeDiv(m.defWins, m.defRounds) * 100),
                    chartData
                };
            })
            .sort((a, b) => b.games - a.games);
    }, [matches]);

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {selectedMapForDeathView && <DeathMapModal mapName={selectedMapForDeathView.name} deaths={selectedMapForDeathView.deathLocations} playersConfig={playersConfig} onClose={() => setSelectedMapForDeathView(null)} />}
            {selectedMapForStrategy && <StrategyModal mapData={selectedMapForStrategy} matches={matches} onClose={() => setSelectedMapForStrategy(null)} />}
            {selectedMapForCoach && <CoachModal mapName={selectedMapForCoach.name} matches={matches} playersConfig={playersConfig} onClose={() => setSelectedMapForCoach(null)} />}

            <div className="flex items-center gap-4 mb-4">
                <div className="p-3 bg-gradient-to-br from-blue-500 to-cyan-600 rounded-xl shadow-lg">
                    <MapIcon size={32} className="text-white" />
                </div>
                <div>
                    <h2 className="text-4xl font-black text-white italic tracking-tighter uppercase">CARTOGRAPHIE</h2>
                    <p className="text-gray-400 font-medium uppercase tracking-widest text-xs">Analyse des Sites & Zones de mort</p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {mapStats.map(map => (
                    <Card key={map.name} className="p-0 overflow-hidden bg-[#1c252e] border border-white/5 flex flex-col group hover:border-white/20 transition-all">
                        <div className="p-4 border-b border-white/5 bg-gradient-to-r from-white/5 to-transparent flex justify-between items-center relative overflow-hidden">
                            <h3 className="text-2xl font-black text-white uppercase">{map.name}</h3>
                            <div className="flex gap-1">
                                <button onClick={() => setSelectedMapForDeathView(map)} className="bg-black/40 hover:bg-white/10 text-gray-300 p-2 rounded-lg transition-colors border border-white/10" title="Heatmaps">
                                    <Eye size={16} />
                                </button>
                                <button onClick={() => setSelectedMapForStrategy(map)} className="bg-orange-500/20 hover:bg-orange-500 text-orange-400 hover:text-white p-2 rounded-lg transition-all border border-orange-500/30" title="Stratégie de Push">
                                    <Target size={16} />
                                </button>
                                <button onClick={() => setSelectedMapForCoach(map)} className="bg-purple-500/20 hover:bg-purple-500 text-purple-400 hover:text-white p-2 rounded-lg transition-all border border-purple-500/30" title="Coach IA (Composition)">
                                    <BrainCircuit size={16} />
                                </button>
                            </div>
                        </div>

                        <div className="px-5 pt-4 flex justify-between items-center text-xs border-b border-white/5 pb-3 bg-black/20">
                            <span className="text-gray-400 font-bold uppercase">{map.games} Games</span>
                            <div className="font-mono font-bold text-white">
                                {map.wins}W <span className="text-gray-600 mx-1">-</span> {map.games - map.wins}L
                            </div>
                            <div className={`font-mono font-black ${map.kd >= 1 ? 'text-emerald-400' : 'text-orange-400'}`}>
                                {map.winrate}% WR
                            </div>
                        </div>

                        <div className="p-5 flex flex-col gap-5 flex-grow">
                            <div className="space-y-3">
                                <div>
                                    <div className="flex justify-between text-[10px] font-bold uppercase mb-1">
                                        <span className="text-red-400">ATK Winrate ({map.atkRounds} rds)</span>
                                        <span className="text-white">{map.atkWr}%</span>
                                    </div>
                                    <div className="w-full bg-gray-800 h-1.5 rounded-full overflow-hidden">
                                        <div className="h-full bg-red-500" style={{ width: `${map.atkWr}%` }}></div>
                                    </div>
                                </div>
                                <div>
                                    <div className="flex justify-between text-[10px] font-bold uppercase mb-1">
                                        <span className="text-blue-400">DEF Winrate ({map.defRounds} rds)</span>
                                        <span className="text-white">{map.defWr}%</span>
                                    </div>
                                    <div className="w-full bg-gray-800 h-1.5 rounded-full overflow-hidden">
                                        <div className="h-full bg-blue-500" style={{ width: `${map.defWr}%` }}></div>
                                    </div>
                                </div>
                            </div>

                            <div className="flex-grow flex flex-col pt-2 border-t border-white/5">
                                <div className="h-20 w-full bg-black/20 rounded-lg p-2 border border-white/5">
                                    {map.chartData.length > 0 ? (
                                        <ResponsiveContainer width="100%" height="100%">
                                            <BarChart data={map.chartData} layout="vertical" margin={{ left: 0, right: 30 }}>
                                                <XAxis type="number" hide />
                                                <YAxis dataKey="name" type="category" width={20} tick={{ fontSize: 10, fontWeight: 'bold', fill: '#fff' }} axisLine={false} tickLine={false} />
                                                <Tooltip cursor={{ fill: 'transparent' }} contentStyle={{ backgroundColor: '#1c252e', borderColor: '#333', fontSize: '10px' }} />
                                                <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={8}>
                                                    {map.chartData.map((entry, index) => (
                                                        <Cell key={`cell-${index}`} fill={SITE_COLORS[entry.name]} />
                                                    ))}
                                                </Bar>
                                            </BarChart>
                                        </ResponsiveContainer>
                                    ) : <div className="h-full flex items-center justify-center text-gray-600 text-[10px] italic">Pas de données</div>}
                                </div>
                            </div>
                        </div>
                    </Card>
                ))}
            </div>
        </div>
    );
};