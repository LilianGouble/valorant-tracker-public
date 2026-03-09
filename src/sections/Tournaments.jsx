import React, { useState, useEffect } from 'react';
import { Trophy, Calendar, Users, ChevronLeft, Swords } from 'lucide-react';
import { LOCAL_SERVER_URL } from '../config/constants';

export const Tournaments = () => {
    const [tournaments, setTournaments] = useState([]);
    const [selectedTourney, setSelectedTourney] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch(`${LOCAL_SERVER_URL}/api/public/tournaments`)
            .then(res => res.json())
            .then(data => {
                setTournaments(data);
                setLoading(false);
            })
            .catch(() => setLoading(false));
    }, []);

    if (loading) return <div className="text-center text-gray-500 mt-20">Chargement des tournois...</div>;

    // VUE DE L'ARBRE DU TOURNOI SÉLECTIONNÉ
    if (selectedTourney) {
        return (
            <div className="space-y-6 animate-in fade-in zoom-in duration-300">
                <button onClick={() => setSelectedTourney(null)} className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors bg-white/5 px-4 py-2 rounded-lg w-fit">
                    <ChevronLeft size={20} /> Retour aux tournois
                </button>

                <div className="bg-[#1c252e] p-6 sm:p-10 rounded-2xl border border-white/5 shadow-2xl">
                    <div className="text-center mb-12">
                        <Trophy size={48} className="mx-auto text-[#ff4655] mb-4" />
                        <h2 className="text-3xl font-black text-white uppercase italic tracking-tighter">{selectedTourney.name}</h2>
                        <p className="text-gray-400 mt-2 flex items-center justify-center gap-2">
                            <Calendar size={16} /> {new Date(selectedTourney.date).toLocaleDateString('fr-FR')}
                            <span className="mx-2">•</span>
                            <Users size={16} /> {selectedTourney.players.length} Participants
                        </p>
                    </div>

                    {/* DESSIN DE L'ARBRE AVEC ALIGNEMENT FLEX PARFAIT */}
                    <div className="flex gap-4 sm:gap-10 overflow-x-auto pb-10 pt-6 custom-scrollbar items-stretch min-h-[500px]">
                        {selectedTourney.bracket.map((round, rIndex) => (
                            <div key={rIndex} className="flex flex-col flex-1 min-w-[220px] relative justify-around gap-4">
                                {/* Titre du round */}
                                <div className="absolute -top-8 left-0 w-full text-center text-sm font-black text-[#ff4655] uppercase tracking-widest bg-[#0f1923]/50 py-1 rounded-full border border-white/5 shadow-sm">
                                    {rIndex === selectedTourney.bracket.length - 1 ? '🏆 Finale' : `Round ${rIndex + 1}`}
                                </div>

                                {round.map((match, mIndex) => (
                                    <div key={mIndex} className="flex-1 flex flex-col justify-center py-2 relative">
                                        <div className="bg-[#0f1923] border border-white/10 rounded-xl p-4 relative shadow-[0_8px_30px_rgb(0,0,0,0.5)] z-10 w-full">

                                            <div className={`py-1.5 px-3 rounded text-sm font-bold truncate transition-colors ${match.winner === match.player1 ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'text-gray-300'}`}>
                                                {match.player1 === 'BYE' ? <span className="text-gray-600 italic font-normal">Passage Auto</span> : (match.player1 || 'À déterminer')}
                                            </div>

                                            <div className="flex items-center my-2">
                                                <div className="h-px flex-grow bg-white/5"></div>
                                                <div className="px-3 text-xs font-mono font-black text-gray-500 tracking-wider">
                                                    {match.score ? <span className="text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20">{match.score}</span> : 'VS'}
                                                </div>
                                                <div className="h-px flex-grow bg-white/5"></div>
                                            </div>

                                            <div className={`py-1.5 px-3 rounded text-sm font-bold truncate transition-colors ${match.winner === match.player2 ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'text-gray-300'}`}>
                                                {match.player2 === 'BYE' ? <span className="text-gray-600 italic font-normal">Passage Auto</span> : (match.player2 || 'À déterminer')}
                                            </div>

                                        </div>
                                    </div>
                                ))}
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    // VUE DE LA LISTE DES TOURNOIS
    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-black text-white uppercase tracking-tight flex items-center gap-3">
                    <Trophy className="text-[#ff4655]" /> Tournois KSL
                </h2>
                <p className="text-gray-400 text-sm mt-1">Découvrez les arbres de tournois générés et mis à jour en direct par les administrateurs.</p>
            </div>

            {tournaments.length === 0 ? (
                <div className="bg-[#1c252e] p-10 rounded-2xl border border-white/5 text-center">
                    <Swords size={48} className="mx-auto text-gray-600 mb-4" />
                    <h3 className="text-xl font-bold text-gray-400">Aucun tournoi pour le moment</h3>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                    {tournaments.map(t => (
                        <div
                            key={t.id}
                            onClick={() => setSelectedTourney(t)}
                            className="bg-[#1c252e] border border-white/5 hover:border-[#ff4655]/50 rounded-2xl p-6 cursor-pointer transition-all hover:-translate-y-1 shadow-lg group relative overflow-hidden"
                        >
                            <div className="absolute top-0 right-0 w-32 h-32 bg-[#ff4655]/5 rounded-bl-full -mr-10 -mt-10 transition-transform group-hover:scale-110"></div>
                            <div className="flex justify-between items-start mb-4 relative z-10">
                                <div className="bg-[#0f1923] p-3 rounded-xl text-[#ff4655] border border-white/5 group-hover:bg-[#ff4655] group-hover:text-white transition-colors shadow-inner">
                                    <Trophy size={24} />
                                </div>
                                <span className="text-[10px] font-black text-gray-400 bg-black/40 px-3 py-1.5 rounded-full border border-white/5">
                                    {new Date(t.date).toLocaleDateString('fr-FR')}
                                </span>
                            </div>
                            <h3 className="text-xl font-black text-white uppercase italic tracking-tighter mb-2 relative z-10">{t.name}</h3>
                            <div className="flex items-center gap-2 text-xs font-bold text-gray-500 relative z-10">
                                <Users size={14} className="text-emerald-400" /> {t.players.length} Inscrits
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};