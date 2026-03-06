import React, { useMemo, useState } from 'react';
import { Skull, Ghost, UserX, Swords, Crown, ShieldAlert, X, Calendar, Map as MapIcon, Users } from 'lucide-react';
import { Card } from '../components/UI';
import { motion, AnimatePresence } from 'framer-motion';

// Seuil de rencontres min pour apparaître
const MIN_ENCOUNTERS = 2;

// --- MODALE DE DETAILS ---
const NemesisDetailModal = ({ nemesis, onClose }) => {
    if (!nemesis) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
            <div className="bg-[#1c252e] border border-white/10 w-full max-w-3xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">

                {/* HEADER */}
                <div className="p-6 border-b border-white/5 bg-gradient-to-r from-[#0f1923] to-[#1c252e] flex justify-between items-start">
                    <div className="flex items-center gap-4">
                        <div className="relative">
                            <img src={nemesis.agentImg} alt={nemesis.agent} className="w-16 h-16 rounded-xl border-2 border-white/10 object-cover bg-black" />
                            <div className="absolute -bottom-2 -right-2 bg-black text-xs font-bold px-2 py-0.5 rounded text-white border border-white/20 shadow-lg">
                                {nemesis.games}x
                            </div>
                        </div>
                        <div>
                            <h3 className="text-2xl font-black text-white italic tracking-tighter uppercase">{nemesis.name}</h3>
                            <div className="flex items-center gap-2 text-sm font-mono text-gray-400">
                                <span>#{nemesis.tag}</span>
                                <span className="w-1 h-1 rounded-full bg-gray-600"></span>
                                <span className={nemesis.winsAgainst >= nemesis.lossesAgainst ? "text-emerald-400 font-bold" : "text-red-400 font-bold"}>
                                    {nemesis.winsAgainst}W - {nemesis.lossesAgainst}L
                                </span>
                            </div>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors text-white">
                        <X size={24} />
                    </button>
                </div>

                {/* HISTORIQUE DES MATCHS */}
                <div className="p-6 overflow-y-auto custom-scrollbar space-y-4">
                    <h4 className="text-xs font-black text-gray-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                        <Swords size={14} /> Historique des confrontations
                    </h4>

                    {nemesis.history.map((match) => (
                        <div key={match.id} className="bg-black/20 border border-white/5 rounded-xl p-4 hover:border-white/10 transition-colors">
                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-3 border-b border-white/5 pb-3">
                                {/* Info Match */}
                                <div className="flex items-center gap-4">
                                    <div className={`px-2 py-1 rounded text-[10px] font-black uppercase border ${match.win ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' : 'bg-red-500/10 text-red-400 border-red-500/30'}`}>
                                        {match.win ? 'VICTOIRE' : 'DÉFAITE'}
                                    </div>
                                    <div className="flex items-center gap-2 text-white font-black text-sm uppercase">
                                        <MapIcon size={14} className="text-gray-500" /> {match.map}
                                    </div>
                                    <div className="flex items-center gap-2 text-gray-500 text-xs font-mono">
                                        <Calendar size={12} /> {new Date(match.date).toLocaleDateString()}
                                    </div>
                                </div>
                                <div className="text-right font-mono font-bold text-white text-sm">
                                    {match.score}
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {/* NOTRE SQUAD */}
                                <div>
                                    <p className="text-[10px] font-bold text-gray-500 uppercase mb-2 flex items-center gap-1.5">
                                        <Users size={10} /> Notre Squad ({match.mySquad.length})
                                    </p>
                                    <div className="space-y-1.5">
                                        {match.mySquad.map((mate, idx) => (
                                            <div key={idx} className="flex items-center gap-2 bg-white/5 p-1 rounded border border-white/5">
                                                <img src={mate.agentImg} alt={mate.agent} className="w-5 h-5 rounded bg-black object-cover" />
                                                <div className="flex flex-col leading-none">
                                                    <span className="text-[10px] font-bold text-gray-300">{mate.name}</span>
                                                    <span className="text-[8px] text-gray-600">{mate.agent}</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* L'ENNEMI */}
                                <div>
                                    <p className="text-[10px] font-bold text-red-400/70 uppercase mb-2 flex items-center gap-1.5">
                                        <Skull size={10} /> Son Rôle
                                    </p>
                                    <div className="flex items-center gap-3 bg-red-500/10 p-2 rounded border border-red-500/20">
                                        <img src={match.nemesisAgentImg} alt={match.nemesisAgent} className="w-8 h-8 rounded bg-black object-cover border border-red-500/30" />
                                        <div>
                                            <span className="block text-xs font-black text-red-200">{match.nemesisAgent}</span>
                                            <span className="text-[9px] text-red-400/60 font-mono">KDA: {match.nemesisKDA}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export const Nemesis = ({ matches, playersConfig }) => {
    const [selectedNemesis, setSelectedNemesis] = useState(null);

    const { victims, nightmares } = useMemo(() => {
        const encounters = {};
        const processedMatchIds = new Set();

        const validMatches = matches.filter(m => m.type === 'ranked');

        validMatches.forEach(m => {
            if (processedMatchIds.has(m.id)) return;
            processedMatchIds.add(m.id);

            const kslWon = m.result === 'WIN';

            let mySquad = [];
            if (m.allPlayers) {
                mySquad = m.allPlayers
                    .filter(p => p.team === m.myTeam && playersConfig.some(cfg => cfg.id === p.puuid || cfg.name.toLowerCase() === p.name.toLowerCase()))
                    .map(p => {
                        const cfg = playersConfig.find(c => c.id === p.puuid || c.name.toLowerCase() === p.name.toLowerCase());
                        return {
                            name: cfg ? cfg.name : p.name,
                            agent: p.character,
                            agentImg: p.assets?.agent?.small
                        };
                    });
            }

            if (m.allPlayers) {
                m.allPlayers.forEach(p => {
                    const isFriend = playersConfig.some(cfg => cfg.id === p.puuid || cfg.name.toLowerCase() === p.name.toLowerCase());

                    if (!isFriend) {
                        if (p.team !== m.myTeam) {
                            if (!encounters[p.puuid]) {
                                encounters[p.puuid] = {
                                    id: p.puuid,
                                    name: p.name,
                                    tag: p.tag,
                                    agent: p.character,
                                    agentImg: p.assets?.agent?.small,
                                    games: 0,
                                    winsAgainst: 0,
                                    lossesAgainst: 0,
                                    history: []
                                };
                            }

                            const enemy = encounters[p.puuid];
                            enemy.games++;

                            if (kslWon) enemy.winsAgainst++;
                            else enemy.lossesAgainst++;

                            enemy.history.push({
                                id: m.id,
                                date: m.date,
                                map: m.map,
                                win: kslWon,
                                score: m.matchScore,
                                mySquad: mySquad,
                                nemesisAgent: p.character,
                                nemesisAgentImg: p.assets?.agent?.small,
                                nemesisKDA: `${p.stats.kills}/${p.stats.deaths}/${p.stats.assists}`
                            });
                        }
                    }
                });
            }
        });

        const allRivals = Object.values(encounters).filter(e => e.games >= MIN_ENCOUNTERS);

        allRivals.forEach(r => r.history.sort((a, b) => new Date(b.date) - new Date(a.date)));

        const victimsList = allRivals
            .filter(e => e.winsAgainst >= e.lossesAgainst)
            .sort((a, b) => {
                if (b.winsAgainst !== a.winsAgainst) return b.winsAgainst - a.winsAgainst;
                return b.games - a.games;
            });

        const nightmaresList = allRivals
            .filter(e => e.lossesAgainst > e.winsAgainst)
            .sort((a, b) => {
                if (b.lossesAgainst !== a.lossesAgainst) return b.lossesAgainst - a.lossesAgainst;
                return b.games - a.games;
            });

        return { victims: victimsList, nightmares: nightmaresList };
    }, [matches, playersConfig]);

    const RivalCard = ({ player, type }) => {
        const isVictim = type === 'victim';
        const borderColor = isVictim ? 'border-emerald-500/50 hover:border-emerald-400' : 'border-red-500/50 hover:border-red-400';
        const shadowColor = isVictim ? 'shadow-[0_0_20px_rgba(16,185,129,0.1)]' : 'shadow-[0_0_20px_rgba(239,68,68,0.1)]';
        const icon = isVictim ? <Ghost size={18} className="text-emerald-400" /> : <Skull size={18} className="text-red-400" />;
        const label = isVictim ? "VICTIME" : "CAUCHEMAR";

        return (
            <Card
                onClick={() => setSelectedNemesis(player)}
                className={`p-3 bg-[#1c252e] border-2 transition-all hover:scale-105 cursor-pointer ${borderColor} ${shadowColor}`}
            >
                <div className="flex items-center gap-3 mb-3">
                    <div className="relative">
                        {player.agentImg ? (
                            <img src={player.agentImg} alt={player.agent} className="w-10 h-10 rounded-full border border-white/10 object-cover bg-black" />
                        ) : (
                            <div className="w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center text-gray-400 font-bold">?</div>
                        )}
                        <div className="absolute -bottom-1 -right-1 bg-black text-[9px] font-bold px-1.5 py-0.5 rounded text-white border border-white/20">
                            {player.games}x
                        </div>
                    </div>
                    <div className="overflow-hidden min-w-0">
                        <h4 className="font-black text-white truncate text-sm" title={player.name}>{player.name}</h4>
                        <span className="text-[10px] text-gray-500 font-mono">#{player.tag}</span>
                    </div>
                </div>

                <div className="bg-black/30 rounded p-2 flex justify-between items-center mb-2">
                    <div className="flex items-center gap-1.5 text-xs font-black text-gray-300">
                        {icon} {label}
                    </div>
                    <div className="text-[10px] font-mono">
                        <span className="text-emerald-400 font-bold">{player.winsAgainst}W</span>
                        <span className="text-gray-600 mx-1">-</span>
                        <span className="text-red-400 font-bold">{player.lossesAgainst}L</span>
                    </div>
                </div>

                <div className="w-full bg-gray-800 h-1.5 rounded-full overflow-hidden flex">
                    <div className="bg-emerald-500 h-full" style={{ width: `${(player.winsAgainst / player.games) * 100}%` }}></div>
                    <div className="bg-red-500 h-full" style={{ width: `${(player.lossesAgainst / player.games) * 100}%` }}></div>
                </div>

                <div className="mt-2 text-center text-[9px] text-gray-500 font-bold uppercase opacity-0 group-hover:opacity-100 transition-opacity">
                    Cliquez pour voir l'historique
                </div>
            </Card>
        );
    };

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {selectedNemesis && <NemesisDetailModal nemesis={selectedNemesis} onClose={() => setSelectedNemesis(null)} />}

            <div className="flex items-center gap-4 mb-4">
                <div className="p-3 bg-gradient-to-br from-purple-600 to-indigo-700 rounded-xl shadow-lg">
                    <Swords size={32} className="text-white" />
                </div>
                <div>
                    <h2 className="text-4xl font-black text-white italic tracking-tighter uppercase">CARNET NOIR</h2>
                    <p className="text-gray-400 font-medium uppercase tracking-widest text-xs">Adversaires récurrents (Rencontrés {MIN_ENCOUNTERS}+ fois)</p>
                </div>
            </div>

            {victims.length === 0 && nightmares.length === 0 ? (
                <div className="p-12 text-center border-2 border-dashed border-white/10 rounded-xl bg-white/5">
                    <UserX className="mx-auto text-gray-600 mb-4" size={48} />
                    <h3 className="text-xl font-bold text-gray-400">Aucune rivalité détectée.</h3>
                    <p className="text-sm text-gray-500 mt-2">
                        Continuez à jouer pour recroiser vos adversaires !
                    </p>
                </div>
            ) : (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                    <div>
                        <div className="flex items-center gap-2 mb-4 text-red-400 border-b border-red-500/30 pb-2">
                            <ShieldAlert size={20} />
                            <h3 className="text-lg font-black uppercase tracking-wide">VOS PIRES CAUCHEMARS (DÉFAITES)</h3>
                        </div>
                        {nightmares.length > 0 ? (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {nightmares.map(enemy => <RivalCard key={enemy.id} player={enemy} type="nightmare" />)}
                            </div>
                        ) : (
                            <div className="text-center py-8 text-gray-600 italic text-xs bg-black/20 rounded-lg">
                                Aucun adversaire ne vous domine pour l'instant.
                            </div>
                        )}
                    </div>

                    <div>
                        <div className="flex items-center gap-2 mb-4 text-emerald-400 border-b border-emerald-500/30 pb-2">
                            <Crown size={20} />
                            <h3 className="text-lg font-black uppercase tracking-wide">VOS VICTIMES PRÉFÉRÉES (VICTOIRES)</h3>
                        </div>
                        {victims.length > 0 ? (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {victims.map(enemy => <RivalCard key={enemy.id} player={enemy} type="victim" />)}
                            </div>
                        ) : (
                            <div className="text-center py-8 text-gray-600 italic text-xs bg-black/20 rounded-lg">
                                Vous n'avez pas encore de victime attitrée.
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};