import React, { useState } from 'react';
import { ChevronRight, Star, Trophy, Flame, Crosshair, Target, Link2 } from 'lucide-react';
import { User } from 'lucide-react';

const formatRelativeDate = (dateString) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    const now = new Date();
    const diffInSeconds = Math.floor((now - date) / 1000);

    if (diffInSeconds < 3600) return `Il y a ${Math.floor(diffInSeconds / 60)} min`;
    if (diffInSeconds < 86400) return `Il y a ${Math.floor(diffInSeconds / 3600)} h`;
    if (diffInSeconds < 172800) return 'Hier';
    return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
};

export const MatchHistoryTable = ({ matches, onSelectMatch, mode = 'full', playersConfig }) => {
    // --- PAGINATION ---
    const [visibleCount, setVisibleCount] = useState(20);

    if (!matches || matches.length === 0) {
        return (
            <div className="p-8 text-center text-gray-500 text-xs font-bold uppercase tracking-widest">
                Aucun match enregistré
            </div>
        );
    }

    const visibleMatches = matches.slice(0, visibleCount);
    const hasMore = visibleCount < matches.length;

    return (
        <div className="w-full text-left">
            {/* EN-TÊTE FIXE (Masqué sur Mobile) */}
            <div className="hidden md:grid sticky top-0 bg-[#1c252e] z-20 grid-cols-12 gap-2 p-3 text-[9px] font-black uppercase text-gray-500 border-b border-white/5 tracking-wider shadow-sm min-w-[500px]">
                <div className="col-span-4">Agent / Map / Événements</div>
                <div className="col-span-2 text-center">Score</div>
                <div className="col-span-3 text-center">K / D / A</div>
                <div className="col-span-1 text-center">K/D</div>
                <div className="col-span-2 text-right">Résultat</div>
            </div>

            {/* LISTE DES MATCHS (Responsive) */}
            <div className="flex flex-col gap-3 md:gap-1.5 p-2 md:p-1.5">
                {visibleMatches.map((match) => {
                    const kills = match.kills || 0;
                    const deaths = match.deaths || 0;
                    const assists = match.assists || 0;

                    const kd = match.kd !== undefined ? match.kd : (deaths > 0 ? (kills / deaths).toFixed(2) : kills);

                    let isMatchMVP = match.isMatchMVP;
                    let isTeamMVP = match.isTeamMVP;

                    if (isMatchMVP === undefined && match.allPlayers && match.score > 0) {
                        const allScores = match.allPlayers.map(p => p.stats?.score || 0);
                        const maxScore = Math.max(...allScores);
                        isMatchMVP = match.score >= maxScore;
                        if (!isMatchMVP && match.myTeam) {
                            const teamScores = match.allPlayers.filter(p => p.team === match.myTeam).map(p => p.stats?.score || 0);
                            const maxTeamScore = Math.max(...teamScores);
                            isTeamMVP = match.score >= maxTeamScore;
                        }
                    }

                    const isWin = match.result === 'WIN';
                    const isDraw = match.result === 'DRAW';

                    let rowStyle = 'border-l-red-500 bg-red-500/5 hover:bg-red-500/10 border-white/5';
                    let textColor = 'text-red-400';
                    let resultText = 'DÉFAITE';

                    if (isWin) {
                        rowStyle = 'border-l-[#10b981] bg-gradient-to-r from-[#10b981]/20 via-[#10b981]/5 to-transparent hover:from-[#10b981]/30 border-[#10b981]/20 shadow-[inset_4px_0_20px_rgba(16,185,129,0.2)]';
                        textColor = 'text-[#10b981] drop-shadow-[0_0_5px_rgba(16,185,129,0.8)]';
                        resultText = 'VICTOIRE';
                    } else if (isDraw) {
                        rowStyle = 'border-l-gray-500 bg-gray-500/5 hover:bg-gray-500/10 border-white/5';
                        textColor = 'text-gray-400';
                        resultText = 'ÉGALITÉ';
                    }

                    if (mode === 'dm') {
                        resultText = `${match.placement || '?'}${match.placement === 1 ? 'er' : 'ème'}`;
                        if (match.placement === 1) {
                            rowStyle = 'border-l-yellow-500 bg-gradient-to-r from-yellow-500/20 to-transparent hover:from-yellow-500/30 shadow-[inset_4px_0_20px_rgba(234,179,8,0.2)] border-yellow-500/20';
                            textColor = 'text-yellow-400 drop-shadow-[0_0_5px_rgba(234,179,8,0.8)]';
                        } else if (match.placement <= 3) {
                            rowStyle = 'border-l-blue-400 bg-blue-500/5 hover:bg-blue-500/10 border-white/5';
                            textColor = 'text-blue-300';
                        } else {
                            rowStyle = 'border-l-gray-600 bg-gray-800/30 hover:bg-gray-800/50 border-white/5';
                            textColor = 'text-gray-500';
                        }
                    }

                    // Calcul de la taille du groupe pour cet historique
                    let partySize = 1;
                    if (match.partyId && match.allPlayers) {
                        partySize = match.allPlayers.filter(p => p.party_id === match.partyId).length;
                    }

                    return (
                        <div
                            key={match.id + match.playerId}
                            onClick={() => onSelectMatch(match)}
                            className={`flex flex-col md:grid md:grid-cols-12 gap-3 md:gap-2 p-3 md:p-2.5 items-start md:items-center transition-all cursor-pointer border border-l-[4px] rounded-xl md:rounded-r-xl md:rounded-l-none ${rowStyle} group relative`}
                        >
                            {/* Petit indicateur de groupe en haut à gauche */}
                            {partySize > 1 && (
                                <div className="absolute top-1 left-2 flex items-center gap-0.5 text-[8px] font-bold text-gray-500/50 group-hover:text-gray-400 transition-colors">
                                    <Link2 size={8} /> {partySize}
                                </div>
                            )}

                            {/* HAUT DE CARTE (Mobile) / COLONNE 1 (Desktop) */}
                            <div className="col-span-4 flex items-center justify-between w-full md:w-auto overflow-hidden mt-1 md:mt-0">
                                <div className="flex items-center gap-3">
                                    <div className="relative w-10 h-10 rounded-lg overflow-hidden bg-gray-800 shrink-0 border border-white/10 shadow-sm group-hover:scale-105 transition-transform">
                                        {match.agentImg ? <img src={match.agentImg} alt={match.agent} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center"><User size={16} className="text-gray-500" /></div>}
                                    </div>
                                    <div className="flex flex-col min-w-0">
                                        <div className="flex items-center gap-1">
                                            <span className="text-xs font-bold text-white truncate uppercase">
                                                {match.agent || '?'}
                                            </span>
                                            {isMatchMVP && <span className="flex items-center gap-0.5 px-1 py-0.5 bg-yellow-500 text-black text-[7px] font-black rounded ml-1 leading-none shadow-[0_0_5px_rgba(234,179,8,0.6)]" title="Match MVP"><Trophy size={8} fill="currentColor" /> MVP</span>}
                                            {!isMatchMVP && isTeamMVP && <span className="flex items-center gap-0.5 px-1 py-0.5 bg-gray-300 text-black text-[7px] font-black rounded ml-1 leading-none" title="Team MVP"><Star size={8} fill="currentColor" /> TMVP</span>}
                                        </div>
                                        <span className="text-[10px] text-gray-400 truncate mt-0.5" title={match.map || '?'}>{match.map || '?'}</span>
                                        <div className="flex items-center gap-1 mt-1 flex-wrap">
                                            {match.mk5 > 0 && <span className="bg-red-500 text-white text-[8px] font-black px-1.5 py-0.5 rounded shadow-[0_0_5px_rgba(239,68,68,0.5)]">ACE</span>}
                                            {match.mk4 > 0 && <span className="bg-orange-500 text-white text-[8px] font-black px-1.5 py-0.5 rounded">4K</span>}
                                            {match.mk3 > 0 && <span className="bg-gray-600 text-white text-[8px] font-bold px-1.5 py-0.5 rounded border border-white/10">3K</span>}
                                            {match.clutches > 0 && <span className="bg-purple-500 text-white text-[8px] font-black px-1.5 py-0.5 rounded flex items-center gap-0.5"><Flame size={8} /> CLUTCH</span>}
                                            {match.firstKills > 0 && <span className="bg-blue-500 text-white text-[8px] font-black px-1.5 py-0.5 rounded flex items-center gap-0.5"><Crosshair size={8} /> {match.firstKills} FK</span>}
                                        </div>
                                    </div>
                                </div>
                                {/* Résultat visible uniquement sur mobile ici */}
                                <div className="md:hidden flex flex-col items-end pl-2 shrink-0">
                                    <span className={`text-xs font-black uppercase tracking-wider ${textColor}`}>{resultText}</span>
                                    <span className="text-[9px] font-medium text-gray-500 mt-0.5">{formatRelativeDate(match.date)}</span>
                                </div>
                            </div>

                            {/* BAS DE CARTE (Mobile) / COLONNES 2-4 (Desktop) */}
                            <div className="w-full md:contents flex justify-between items-center mt-1 md:mt-0 pt-2 md:pt-0 border-t border-white/5 md:border-none">
                                <div className="col-span-2 flex flex-col md:items-center justify-center font-mono text-sm font-black text-gray-300">
                                    <span className="md:hidden text-[8px] text-gray-500 uppercase tracking-widest leading-none mb-1">Score</span>
                                    {match.matchScore || match.scoreTeam || '-'}
                                </div>

                                <div className="col-span-3 flex flex-col md:flex-row items-center justify-center gap-1 font-mono text-sm">
                                    <span className="md:hidden text-[8px] text-gray-500 uppercase tracking-widest leading-none mb-1">K/D/A</span>
                                    <div>
                                        <span className="text-white font-bold">{kills}</span>
                                        <span className="text-gray-600 mx-1">/</span>
                                        <span className="text-red-400 font-bold">{deaths}</span>
                                        <span className="text-gray-600 mx-1">/</span>
                                        <span className="text-gray-500">{assists}</span>
                                    </div>
                                </div>

                                <div className="col-span-1 flex flex-col items-end md:items-center justify-center">
                                    <span className="md:hidden text-[8px] text-gray-500 uppercase tracking-widest leading-none mb-1">Ratio</span>
                                    <span className={`text-sm font-black ${Number(kd) >= 1 ? 'text-white' : 'text-gray-500'}`}>
                                        {Number(kd).toFixed(2)}
                                    </span>
                                    {mode === 'ranked' && match.rrChange !== undefined && match.rrChange !== 0 && (
                                        <span className={`text-[10px] font-black ${match.rrChange > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                            {match.rrChange > 0 ? '+' : ''}{match.rrChange}
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* Résultat visible uniquement sur desktop ici */}
                            <div className="hidden md:flex col-span-2 flex-col items-end justify-center pl-1">
                                <span className={`text-[10px] font-black uppercase tracking-wider ${textColor}`}>{resultText}</span>
                                <span className="text-[9px] text-gray-600 flex items-center gap-1 whitespace-nowrap mt-0.5">
                                    {formatRelativeDate(match.date)}
                                </span>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* BOUTON CHARGER PLUS */}
            {hasMore && (
                <div className="p-2">
                    <button
                        onClick={() => setVisibleCount(v => v + 20)}
                        className="w-full py-3 bg-white/5 hover:bg-white/10 border border-white/5 rounded-xl text-xs font-bold text-gray-300 hover:text-white transition-colors"
                    >
                        Charger plus de matchs ({matches.length - visibleCount} restants)
                    </button>
                </div>
            )}
        </div>
    );
};