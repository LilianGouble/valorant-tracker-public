import React, { useState, useEffect } from 'react';
import { X, Clock, Calendar, Map as MapIcon, Crosshair, Users, Coins, Activity, Layers, Target, Trophy, Skull, Star, Flame, Link2, Shield } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { calculateKD } from '../utils/calculations';
import { getRankIcon } from '../config/constants';
import { User } from 'lucide-react';

const getPlayerColor = (puuid, playersConfig) => {
    if (!puuid) return '#ff0000';
    const player = playersConfig.find(p =>
        (p.puuid && p.puuid.toLowerCase() === puuid.toLowerCase())
        || p.id.toLowerCase() === puuid.toLowerCase()
    );
    return player ? player.color : '#ff0000';
};

const findCfgByPuuid = (cfgs, puuid) => {
    if (!puuid || !cfgs) return null;
    const lp = puuid.toLowerCase();
    return cfgs.find(c =>
        (c.puuid && c.puuid.toLowerCase() === lp)
        || c.id.toLowerCase() === lp
    ) || null;
};

export const Card = ({ children, className = "", style = {}, ...props }) => (
    <div
        className={`bg-[#1c252e] rounded-2xl border border-white/5 shadow-xl ${className}`}
        style={style}
        {...props}
    >
        {children}
    </div>
);

export const Badge = ({ children, className = "bg-gray-700 text-gray-300" }) => (
    <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ${className}`}>
        {children}
    </span>
);

export const StatPodium = ({ title, icon: Icon, data, suffix = "" }) => {
    if (!data || data.length === 0) return null;
    const [first, second, third] = data;

    return (
        <Card className="p-4 sm:p-6 flex flex-col h-full bg-[#1c252e] min-w-[250px]">
            <div className="flex items-center gap-2 mb-6 border-b border-white/5 pb-4">
                <div className="p-2 bg-white/5 rounded-lg text-[#ff4655] shrink-0">
                    <Icon size={20} />
                </div>
                <h3 className="font-black text-white uppercase text-xs sm:text-sm tracking-wide leading-tight">{title}</h3>
            </div>

            <div className="flex items-end justify-center gap-1 sm:gap-2 flex-grow mt-2">
                {second && (
                    <div className="flex flex-col items-center w-1/3 group">
                        <div className="mb-2 text-center opacity-0 group-hover:opacity-100 transition-opacity absolute -mt-8 z-20">
                            <span className="text-[10px] font-bold text-gray-400 bg-[#0f1923] px-2 py-1 rounded border border-white/10">{second.name}</span>
                        </div>
                        <div className="w-full bg-gradient-to-t from-gray-800 to-gray-700 rounded-t-lg relative flex items-end justify-center pb-2" style={{ height: '60px' }}>
                            <span className="text-xs font-bold text-gray-400">2</span>
                        </div>
                        <div className="text-center mt-2 w-full">
                            <div className="font-bold text-[10px] sm:text-xs text-gray-300 truncate w-full px-1">{second.name}</div>
                            <div className="text-[9px] sm:text-[10px] font-mono text-gray-500 truncate">{second.value}{suffix}</div>
                        </div>
                    </div>
                )}

                {first && (
                    <div className="flex flex-col items-center w-1/3 z-10 group">
                        <div className="mb-2 text-center opacity-0 group-hover:opacity-100 transition-opacity absolute -mt-8 z-20">
                            <span className="text-[10px] font-bold text-[#ff4655] bg-[#0f1923] px-2 py-1 rounded border border-white/10">{first.name}</span>
                        </div>
                        <div className="w-full bg-gradient-to-t from-[#ff4655] to-[#d93442] rounded-t-lg relative flex items-end justify-center pb-2 shadow-[0_0_15px_rgba(255,70,85,0.4)]" style={{ height: '90px' }}>
                            <span className="text-xl font-black text-white">1</span>
                        </div>
                        <div className="text-center mt-2 w-full">
                            <div className="font-black text-xs sm:text-sm text-white truncate w-full px-1">{first.name}</div>
                            <div className="text-[10px] sm:text-xs font-mono text-[#ff4655] font-bold truncate">{first.value}{suffix}</div>
                        </div>
                    </div>
                )}

                {third && (
                    <div className="flex flex-col items-center w-1/3 group">
                        <div className="mb-2 text-center opacity-0 group-hover:opacity-100 transition-opacity absolute -mt-8 z-20">
                            <span className="text-[10px] font-bold text-gray-400 bg-[#0f1923] px-2 py-1 rounded border border-white/10">{third.name}</span>
                        </div>
                        <div className="w-full bg-gradient-to-t from-gray-800 to-gray-700 rounded-t-lg relative flex items-end justify-center pb-2" style={{ height: '40px' }}>
                            <span className="text-xs font-bold text-gray-400">3</span>
                        </div>
                        <div className="text-center mt-2 w-full">
                            <div className="font-bold text-[10px] sm:text-xs text-gray-300 truncate w-full px-1">{third.name}</div>
                            <div className="text-[9px] sm:text-[10px] font-mono text-gray-500 truncate">{third.value}{suffix}</div>
                        </div>
                    </div>
                )}
            </div>
        </Card>
    );
};

export const StatCard = ({ title, value, subtitle, icon: Icon, color = "text-white" }) => (
    <Card className="p-4 bg-[#1c252e] border-l-4 border-white/5 relative overflow-hidden group hover:bg-white/5 transition-all">
        <div className="flex justify-between items-start z-10 relative">
            <div>
                <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">{title}</h4>
                <div className={`text-2xl font-black ${color}`}>{value}</div>
                {subtitle && <div className="text-[10px] text-gray-400 mt-1">{subtitle}</div>}
            </div>
            <div className={`p-2 rounded-lg bg-white/5 ${color} bg-opacity-10`}>
                {Icon && <Icon size={20} />}
            </div>
        </div>
    </Card>
);

const MatchDeathMap = ({ mapName, deaths, playersConfig }) => {
    const [mapData, setMapData] = useState(null);

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

    return (
        <div className="relative w-full aspect-square bg-black rounded-lg overflow-hidden border border-white/10 mt-4">
            {mapData ? (
                <div className="relative w-full h-full">
                    <img src={mapData.displayIcon} alt={mapName} className="w-full h-full object-contain opacity-50" />
                    {deaths.map((d, i) => {
                        const x = (d.y * mapData.xMultiplier) + mapData.xScalarToAdd;
                        const y = (d.x * mapData.yMultiplier) + mapData.yScalarToAdd;
                        const playerColor = getPlayerColor(d.puuid, playersConfig);

                        if (x < 0 || x > 1 || y < 0 || y > 1) return null;

                        return (
                            <div
                                key={i}
                                className="absolute transform -translate-x-1/2 -translate-y-1/2 hover:scale-150 transition-transform z-20 group cursor-crosshair"
                                style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
                            >
                                {d.agentImg ? (
                                    <div className="w-4 h-4 rounded-full overflow-hidden border border-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)] bg-black/50">
                                        <img src={d.agentImg} alt="Victim" className="w-full h-full object-cover" />
                                    </div>
                                ) : (
                                    <X size={14} strokeWidth={4} color={playerColor} className="drop-shadow-[0_0_2px_rgba(0,0,0,1)]" />
                                )}

                                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-1.5 py-0.5 bg-black text-white text-[8px] font-bold rounded opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none border border-white/20 z-50">
                                    Round {d.round}
                                </div>
                            </div>
                        );
                    })}
                </div>
            ) : <div className="flex items-center justify-center h-full text-xs text-gray-500">Chargement carte...</div>}
        </div>
    );
};

const PlayerRow = ({ player, match, isGlobalView = false, playersConfig, trackedPartyIds }) => {
    const myCfg = findCfgByPuuid(playersConfig, match.playerId);
    const isMe = player.puuid && myCfg && (
        player.puuid.toLowerCase() === (myCfg.puuid || '').toLowerCase()
        || player.puuid.toLowerCase() === myCfg.id.toLowerCase()
    );
    const playerCfg = findCfgByPuuid(playersConfig, player.puuid);
    const isFriend = !!playerCfg
        || (player.name && playersConfig.some(cfg => cfg.name.toLowerCase() === player.name.toLowerCase()));

    const inTrackedParty = !isFriend && player.party_id && trackedPartyIds && trackedPartyIds.has(player.party_id);

    const teamColorBg = isGlobalView
        ? (player.team === 'Blue' ? 'bg-cyan-500/5 border-l-2 border-l-cyan-500' : 'bg-red-500/5 border-l-2 border-l-red-500')
        : (isMe ? 'bg-white/10 border-l-2 border-l-yellow-400' : (inTrackedParty ? 'bg-purple-500/5 border-l-2 border-l-purple-400/40' : 'hover:bg-white/5 border-l-2 border-l-transparent'));

    const nameColor = isMe ? 'text-yellow-400' : (isFriend ? 'text-purple-400' : (inTrackedParty ? 'text-purple-300' : 'text-white'));
    const rounds = match.roundsPlayed || 1;
    const acs = Math.round(player.stats.score / rounds);

    return (
        <div className={`grid grid-cols-12 gap-1 sm:gap-2 items-center px-2 sm:px-3 py-2 rounded mb-1 transition-colors ${teamColorBg}`}>
            <div className="col-span-5 flex items-center gap-1 sm:gap-2 min-w-0">
                <div className="relative shrink-0">
                    {player.assets?.agent?.small ? (
                        <img src={player.assets.agent.small} className="w-7 h-7 sm:w-8 sm:h-8 rounded-md bg-black object-cover shadow-sm" alt={player.character} />
                    ) : (
                        <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-md bg-gray-700"></div>
                    )}
                </div>
                <div className="w-6 h-6 sm:w-7 sm:h-7 shrink-0 hidden sm:flex items-center justify-center bg-black/30 rounded-md border border-white/5">
                    <img src={getRankIcon(player.currenttier_patched)} alt="Rank" className="w-5 h-5 sm:w-6 sm:h-6 object-contain drop-shadow-md" title={player.currenttier_patched} />
                </div>
                <div className="flex flex-col min-w-0">
                    <span className={`text-[10px] sm:text-xs font-bold truncate ${nameColor} flex items-center gap-1`}>
                        {player.name || player.character || '—'}
                        {inTrackedParty && (
                            <span className="text-[7px] sm:text-[8px] font-black uppercase bg-purple-500/20 text-purple-300 border border-purple-400/40 rounded px-1 py-px tracking-wider" title="Membre du groupe d'un joueur tracké">groupe</span>
                        )}
                    </span>
                    {player.tag ? <span className="text-[8px] sm:text-[9px] text-gray-500 font-mono truncate">#{player.tag}</span> : null}
                </div>
            </div>
            <div className="col-span-3 flex justify-center items-center font-mono text-[10px] sm:text-xs">
                <span className="text-white font-bold">{player.stats.kills}</span>
                <span className="text-gray-600 mx-0.5 sm:mx-1">/</span>
                <span className="text-red-400 font-bold">{player.stats.deaths}</span>
                <span className="text-gray-600 mx-0.5 sm:mx-1">/</span>
                <span className="text-gray-500">{player.stats.assists}</span>
            </div>
            <div className="col-span-2 flex justify-center items-center font-mono text-[9px] sm:text-[10px]">
                <span className="text-emerald-400 font-bold" title="First Kills">{player.stats.first_kills || 0}</span>
                <span className="text-gray-600 mx-0.5">/</span>
                <span className="text-red-400 font-bold" title="First Deaths">{player.stats.first_deaths || 0}</span>
            </div>
            <div className="col-span-2 text-center font-black text-white text-[10px] sm:text-xs">{acs}</div>
        </div>
    );
};

export const MatchDetailModal = ({ match, onClose, playersConfig }) => {
    const [showHeatmap, setShowHeatmap] = useState(false);
    const [selectedRoundIndex, setSelectedRoundIndex] = useState(null);
    const isDM = match.type === 'dm';
    const [scoreboardView, setScoreboardView] = useState(isDM ? 'global' : 'split');

    if (!match) return null;

    const allPlayers = match.allPlayers || [];
    const blueTeam = allPlayers.filter(p => p.team === 'Blue').sort((a, b) => b.stats.score - a.stats.score);
    const redTeam = allPlayers.filter(p => p.team === 'Red').sort((a, b) => b.stats.score - a.stats.score);
    const globalSorted = [...allPlayers].sort((a, b) => b.stats.score - a.stats.score);

    // Set des party_id qui contiennent au moins un joueur tracké
    const trackedPartyIds = new Set(
        allPlayers
            .filter(p => p.party_id && findCfgByPuuid(playersConfig, p.puuid))
            .map(p => p.party_id)
    );

    const deadPlayerIds = new Set((match.deathCoordinates || []).map(d => d.puuid));
    const playersInLegend = playersConfig.filter(cfg =>
        deadPlayerIds.has(cfg.id) || (cfg.puuid && deadPlayerIds.has(cfg.puuid))
    );
    const isTDM = match.type === 'tdm';

    // FIX FUSEAU HORAIRE ICI ! (Le navigateur s'occupe de l'offset)
    const matchTimeMs = match.timestamp ? match.timestamp * 1000 : new Date(match.date).getTime();
    const timeStr = new Date(matchTimeMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const dateStr = new Date(matchTimeMs).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-2 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose}>
            <div className="bg-[#1c252e] w-full max-w-5xl max-h-[95dvh] rounded-2xl border border-white/10 shadow-2xl flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>

                {/* HEADER MODAL RESPONSIVE */}
                <div className="p-4 sm:p-6 border-b border-white/5 bg-gradient-to-r from-[#0f1923] to-[#1c252e] flex justify-between items-start shrink-0">
                    <div className="flex flex-col gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                            <Badge className={match.result === 'WIN' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}>
                                {match.result === 'WIN' ? 'VICTOIRE' : 'DÉFAITE'}
                            </Badge>
                            <span className="text-gray-400 text-[10px] sm:text-xs font-mono flex items-center gap-1">
                                <Calendar size={12} /> {dateStr}
                            </span>
                        </div>
                        <h2 className="text-xl sm:text-3xl font-black text-white italic tracking-tighter uppercase flex items-center gap-2">
                            <span className={match.myTeam === 'Blue' ? 'text-cyan-400' : 'text-red-400'}>
                                {isTDM ? match.scoreTeam : (isDM ? 'FFA' : match.matchScore)}
                            </span>
                            <span className="text-gray-600 text-lg sm:text-xl">//</span>
                            {match.map}
                        </h2>
                    </div>
                    <button onClick={onClose} className="p-2 -mr-2 -mt-2 sm:m-0 hover:bg-white/10 rounded-full text-white transition-colors shrink-0"><X size={24} /></button>
                </div>

                {/* CONTENU SCROLLABLE */}
                <div className="flex-grow overflow-y-auto custom-scrollbar p-4 sm:p-6">

                    {/* STATS RAPIDES */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-6">
                        <div className="bg-black/20 p-2 sm:p-3 rounded-lg border border-white/5">
                            <div className="text-[10px] sm:text-xs text-gray-500 font-bold uppercase mb-1">K/D Ratio</div>
                            <div className={`text-lg sm:text-xl font-black ${calculateKD(match.kills, match.deaths) >= 1 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {calculateKD(match.kills, match.deaths)}
                            </div>
                        </div>
                        <div className="bg-black/20 p-2 sm:p-3 rounded-lg border border-white/5">
                            <div className="text-[10px] sm:text-xs text-gray-500 font-bold uppercase mb-1">Score Moyen</div>
                            <div className="text-lg sm:text-xl font-black text-white">{match.score ? Math.round(match.score / match.roundsPlayed) : 0} ACS</div>
                        </div>
                        <div className="bg-black/20 p-2 sm:p-3 rounded-lg border border-white/5">
                            <div className="text-[10px] sm:text-xs text-gray-500 font-bold uppercase mb-1">Headshot %</div>
                            <div className="text-lg sm:text-xl font-black text-yellow-400">
                                {match.totalShots > 0 ? Math.round((match.headshots / match.totalShots) * 100) : 0}%
                            </div>
                        </div>
                        <div className="bg-black/20 p-2 sm:p-3 rounded-lg border border-white/5">
                            <div className="text-[10px] sm:text-xs text-gray-500 font-bold uppercase mb-1">Impact</div>
                            <div className="text-lg sm:text-xl font-black text-purple-400">{match.adr} ADR</div>
                        </div>
                    </div>

                    {/* TIMELINE DU MATCH */}
                    {match.timeline && match.timeline.length > 0 && (
                        <div className="mb-8 bg-black/20 rounded-xl p-4 border border-white/5">
                            <h3 className="text-xs font-black uppercase text-gray-500 mb-3 tracking-widest flex items-center gap-2">
                                <Clock size={14} /> Timeline du match
                            </h3>
                            <div className="flex flex-wrap gap-1">
                                {match.timeline.map((round, idx) => {
                                    const ecoDiff = round.myTeamEco - round.enemyTeamEco;
                                    const isEcoWin = round.won && ecoDiff < -5000;
                                    const isThriftyLoss = !round.won && ecoDiff > 5000;

                                    const roundButton = (
                                        <button
                                            key={`btn-${idx}`}
                                            onClick={() => setSelectedRoundIndex(selectedRoundIndex === idx ? null : idx)}
                                            className={`w-8 h-8 rounded-sm font-bold text-xs flex items-center justify-center transition-all relative ${round.won ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50 hover:bg-emerald-500/40'
                                                : 'bg-red-500/20 text-red-400 border border-red-500/50 hover:bg-red-500/40'
                                                } ${selectedRoundIndex === idx ? 'ring-2 ring-white scale-110 z-10' : ''}`}
                                        >
                                            {round.roundNum}
                                            {isEcoWin && <span className="absolute -top-1 -right-1 text-[10px]" title="Victoire en étant désavantagé économiquement !">💰</span>}
                                            {isThriftyLoss && <span className="absolute -top-1 -right-1 text-[10px]" title="Défaite malgré un gros avantage économique...">🤡</span>}
                                        </button>
                                    );

                                    if (idx === 12 || idx === 24) {
                                        return (
                                            <React.Fragment key={`frag-${idx}`}>
                                                <div className="flex items-center justify-center px-1">
                                                    <div className="h-5 w-px bg-white/20 mx-1"></div>
                                                    <span className="text-[8px] font-black uppercase text-gray-500 tracking-widest">Swap</span>
                                                    <div className="h-5 w-px bg-white/20 mx-1"></div>
                                                </div>
                                                {roundButton}
                                            </React.Fragment>
                                        );
                                    }

                                    return roundButton;
                                })}
                            </div>

                            {/* Détails du Round Sélectionné */}
                            {selectedRoundIndex !== null && match.timeline[selectedRoundIndex] && (
                                <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mt-4 overflow-hidden">
                                    <div className="p-4 bg-[#0f1923] rounded-lg border border-white/10 grid grid-cols-1 md:grid-cols-3 gap-6 relative">

                                        {/* Status & Durée */}
                                        <div>
                                            <div className="text-[10px] text-gray-500 uppercase font-bold mb-1 flex items-center justify-between w-full">
                                                <span>Issue du Round {match.timeline[selectedRoundIndex].roundNum}</span>
                                                {match.timeline[selectedRoundIndex].duration > 0 && (
                                                    <span className="text-gray-400 flex items-center gap-1 bg-white/5 px-1.5 rounded">
                                                        <Clock size={10} />
                                                        {Math.floor(match.timeline[selectedRoundIndex].duration / 60)}m {match.timeline[selectedRoundIndex].duration % 60}s
                                                    </span>
                                                )}
                                            </div>
                                            <div className={`text-lg font-black uppercase mt-1 ${match.timeline[selectedRoundIndex].won ? 'text-emerald-400' : 'text-red-400'}`}>
                                                {match.timeline[selectedRoundIndex].won ? 'Victoire' : 'Défaite'}
                                            </div>
                                            <div className="text-[10px] text-gray-400 mt-1 capitalize">{match.timeline[selectedRoundIndex].endType.replace('_', ' ')}</div>
                                        </div>

                                        {/* First Blood */}
                                        <div>
                                            <div className="text-[10px] text-gray-500 uppercase font-bold mb-2">Premier Sang</div>
                                            {match.timeline[selectedRoundIndex].firstBlood ? (
                                                <div className="flex items-center gap-2 bg-black/40 p-2 rounded border border-white/5">
                                                    <div className="relative shrink-0">
                                                        {match.timeline[selectedRoundIndex].firstBlood.killerAgent ? <img src={match.timeline[selectedRoundIndex].firstBlood.killerAgent} className="w-7 h-7 rounded object-cover border border-emerald-500/50" /> : <div className="w-7 h-7 bg-gray-800 rounded"></div>}
                                                    </div>
                                                    <div className="flex flex-col min-w-0 flex-grow">
                                                        <span className="text-xs font-bold text-white truncate">{match.timeline[selectedRoundIndex].firstBlood.killerName}</span>
                                                        <span className="text-[9px] text-gray-500 truncate">{match.timeline[selectedRoundIndex].firstBlood.weapon}</span>
                                                    </div>
                                                    <div className="flex items-center justify-center px-2 shrink-0">
                                                        <Crosshair size={12} className="text-red-500" />
                                                    </div>
                                                    <div className="relative shrink-0">
                                                        {match.timeline[selectedRoundIndex].firstBlood.victimAgent ? <img src={match.timeline[selectedRoundIndex].firstBlood.victimAgent} className="w-7 h-7 rounded object-cover border border-red-500/50 opacity-50 grayscale" /> : <div className="w-7 h-7 bg-gray-800 rounded"></div>}
                                                    </div>
                                                </div>
                                            ) : <span className="text-xs text-gray-600 italic">Aucun / Donnée manquante</span>}
                                        </div>

                                        {/* Eco & Objectif */}
                                        <div className="flex flex-col justify-between">
                                            <div>
                                                <div className="text-[10px] text-gray-500 uppercase font-bold mb-1">Valeur d'équipement</div>
                                                <div className="flex items-center gap-3 w-full">
                                                    <div className="flex flex-col items-end w-1/2">
                                                        <span className="text-[9px] text-gray-400">Alliés</span>
                                                        <span className="text-xs font-mono font-bold text-emerald-400">{match.timeline[selectedRoundIndex].myTeamEco.toLocaleString()} ¤</span>
                                                    </div>
                                                    <div className="w-px h-6 bg-white/10 shrink-0"></div>
                                                    <div className="flex flex-col items-start w-1/2">
                                                        <span className="text-[9px] text-gray-400">Ennemis</span>
                                                        <span className="text-xs font-mono font-bold text-red-400">{match.timeline[selectedRoundIndex].enemyTeamEco.toLocaleString()} ¤</span>
                                                    </div>
                                                </div>
                                            </div>

                                            {(match.timeline[selectedRoundIndex].planter || match.timeline[selectedRoundIndex].defuser) && (
                                                <div className="mt-3 pt-2 border-t border-white/5 text-[10px] flex flex-col gap-1">
                                                    {match.timeline[selectedRoundIndex].planter && (
                                                        <div className="flex items-center gap-1 text-yellow-500">
                                                            <span>💣 Planté par <strong className="text-white">{match.timeline[selectedRoundIndex].planter}</strong></span>
                                                            {match.timeline[selectedRoundIndex].plantSite && <span className="bg-yellow-500/20 px-1 rounded text-yellow-300">Sur {match.timeline[selectedRoundIndex].plantSite}</span>}
                                                        </div>
                                                    )}
                                                    {match.timeline[selectedRoundIndex].defuser && (
                                                        <div className="flex items-center gap-1 text-cyan-400">
                                                            <span>🔧 Désamorcé par <strong className="text-white">{match.timeline[selectedRoundIndex].defuser}</strong></span>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </motion.div>
                            )}
                        </div>
                    )}

                    {/* BOUTON HEATMAP */}
                    {match.deathCoordinates && match.deathCoordinates.length > 0 && !isTDM && !isDM && (
                        <div className="mb-8 bg-black/20 rounded-xl p-1 border border-white/5">
                            <button
                                onClick={() => setShowHeatmap(!showHeatmap)}
                                className={`w-full py-3 rounded-lg text-xs font-black uppercase flex items-center justify-center gap-2 transition-all ${showHeatmap
                                    ? 'bg-gradient-to-r from-red-500 to-blue-600 text-white shadow-lg'
                                    : 'bg-transparent text-gray-400 hover:text-white hover:bg-white/5'
                                    }`}
                            >
                                <Target size={14} /> {showHeatmap ? "Masquer la Carte des Morts" : "Analyser qui m'a tué (Positions)"}
                            </button>

                            {showHeatmap && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-4 animate-in slide-in-from-top-4">
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between text-red-400 border-b border-red-500/20 pb-2 mb-2">
                                            <span className="text-xs font-black uppercase flex items-center gap-2">Attaque</span>
                                            <span className="text-[10px] font-mono opacity-70">{match.deathCoordinates.filter(d => d.side === 'Attack').length} Morts</span>
                                        </div>
                                        <MatchDeathMap mapName={match.map} deaths={match.deathCoordinates.filter(d => d.side === 'Attack')} playersConfig={playersConfig} />
                                    </div>
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between text-blue-400 border-b border-blue-500/20 pb-2 mb-2">
                                            <span className="text-xs font-black uppercase flex items-center gap-2">Défense</span>
                                            <span className="text-[10px] font-mono opacity-70">{match.deathCoordinates.filter(d => d.side === 'Defend').length} Morts</span>
                                        </div>
                                        <MatchDeathMap mapName={match.map} deaths={match.deathCoordinates.filter(d => d.side === 'Defend')} playersConfig={playersConfig} />
                                    </div>

                                    <div className="col-span-1 md:col-span-2 flex flex-wrap gap-3 justify-center mt-2 bg-white/5 p-3 rounded-lg border border-white/5">
                                        <span className="text-[10px] text-gray-400 w-full text-center">Les icônes représentent les agents qui ont éliminé les joueurs de notre groupe.</span>
                                        {playersInLegend.length > 0 ? (
                                            playersInLegend.map(p => (
                                                <div key={p.id} className="flex items-center gap-2 px-2 py-1 bg-black/40 rounded border border-white/10">
                                                    <div className="w-2.5 h-2.5 rounded-full shadow-[0_0_5px_rgba(0,0,0,0.5)]" style={{ backgroundColor: p.color }}></div>
                                                    <span className="text-[10px] text-gray-300 font-bold uppercase">{p.name}</span>
                                                </div>
                                            ))
                                        ) : (
                                            <span className="text-[10px] text-gray-600 italic">Aucune donnée de groupe</span>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* TABLEAU DES SCORES */}
                    <div className="mt-8">
                        {!isDM && (
                            <div className="flex justify-center mb-4">
                                <div className="bg-black/40 p-1 rounded-lg flex gap-1 border border-white/10">
                                    <button onClick={() => setScoreboardView('split')} className={`px-4 py-1.5 rounded-md text-[10px] font-black uppercase flex items-center gap-2 transition-all ${scoreboardView === 'split' ? 'bg-[#ff4655] text-white shadow' : 'text-gray-500 hover:text-white'}`}><Layers size={12} /> Par Équipe</button>
                                    <button onClick={() => setScoreboardView('global')} className={`px-4 py-1.5 rounded-md text-[10px] font-black uppercase flex items-center gap-2 transition-all ${scoreboardView === 'global' ? 'bg-[#ff4655] text-white shadow' : 'text-gray-500 hover:text-white'}`}><Activity size={12} /> Global</button>
                                </div>
                            </div>
                        )}

                        <div className="pb-4">
                            {scoreboardView === 'split' && !isDM ? (
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                    <div>
                                        <div className="flex items-center justify-between mb-3 pb-2 border-b-2 border-cyan-500/50">
                                            <h4 className="text-cyan-400 font-black uppercase text-sm">ÉQUIPE BLEUE</h4>
                                            <span className="text-white font-mono font-bold">{match.teamInfo?.blue?.rounds_won || 0}</span>
                                        </div>
                                        <div className="grid grid-cols-12 gap-1 sm:gap-2 px-2 sm:px-3 py-1 text-[9px] font-bold uppercase text-gray-600 mb-2">
                                            <div className="col-span-5">Joueur</div>
                                            <div className="col-span-3 text-center">K/D/A</div>
                                            <div className="col-span-2 text-center" title="First Kills / First Deaths">FK/FD</div>
                                            <div className="col-span-2 text-center">ACS</div>
                                        </div>
                                        {blueTeam.map(p => <PlayerRow key={p.puuid} player={p} match={match} playersConfig={playersConfig} trackedPartyIds={trackedPartyIds} isGlobalView={false} />)}
                                    </div>
                                    <div>
                                        <div className="flex items-center justify-between mb-3 pb-2 border-b-2 border-red-500/50">
                                            <h4 className="text-red-400 font-black uppercase text-sm">ÉQUIPE ROUGE</h4>
                                            <span className="text-white font-mono font-bold">{match.teamInfo?.red?.rounds_won || 0}</span>
                                        </div>
                                        <div className="grid grid-cols-12 gap-1 sm:gap-2 px-2 sm:px-3 py-1 text-[9px] font-bold uppercase text-gray-600 mb-2">
                                            <div className="col-span-5">Joueur</div>
                                            <div className="col-span-3 text-center">K/D/A</div>
                                            <div className="col-span-2 text-center" title="First Kills / First Deaths">FK/FD</div>
                                            <div className="col-span-2 text-center">ACS</div>
                                        </div>
                                        {redTeam.map(p => <PlayerRow key={p.puuid} player={p} match={match} playersConfig={playersConfig} trackedPartyIds={trackedPartyIds} isGlobalView={false} />)}
                                    </div>
                                </div>
                            ) : (
                                <div className="max-w-3xl mx-auto">
                                    <div className="grid grid-cols-12 gap-1 sm:gap-2 px-2 sm:px-3 py-2 text-[10px] font-black uppercase text-gray-500 border-b border-white/10 mb-2">
                                        <div className="col-span-5">Joueur (Global)</div>
                                        <div className="col-span-3 text-center">K/D/A</div>
                                        <div className="col-span-2 text-center" title="First Kills / First Deaths">FK/FD</div>
                                        <div className="col-span-2 text-center">ACS</div>
                                    </div>
                                    {globalSorted.map(p => <PlayerRow key={p.puuid} player={p} match={match} playersConfig={playersConfig} trackedPartyIds={trackedPartyIds} isGlobalView={true} />)}
                                </div>
                            )}
                        </div>
                    </div>

                </div>
            </div>
        </div>
    );
};