import React, { useMemo } from 'react';
import { Trophy, Target, Skull, Crown, Activity, Calendar } from 'lucide-react';
import { StatCard } from '../components/UI';

export const SeasonWrapUp = ({ matches, playersConfig }) => {
    const wrapUpStats = useMemo(() => {
        const rankedMatches = matches.filter(m => m.type === 'ranked');
        if (rankedMatches.length === 0) return null;

        const totalMatches = rankedMatches.length;
        const totalWins = rankedMatches.filter(m => m.result === 'WIN').length;
        const winrate = Math.round((totalWins / totalMatches) * 100);

        // Stats par joueur
        const playerStats = {};
        playersConfig.forEach(p => {
            playerStats[p.id] = { id: p.id, name: p.name, color: p.color, rr: 0, kills: 0, deaths: 0, games: 0, wins: 0 };
        });

        const agentCounts = {};
        const nemesisCounts = {};

        rankedMatches.forEach(m => {
            if (playerStats[m.playerId]) {
                const ps = playerStats[m.playerId];
                ps.games++;
                ps.rr += (m.rrChange || 0);
                ps.kills += (m.kills || 0);
                ps.deaths += (m.deaths || 0);
                if (m.result === 'WIN') ps.wins++;
            }

            // Agents les plus joués
            if (m.agent) {
                agentCounts[m.agent] = (agentCounts[m.agent] || 0) + 1;
            }

            // Pire Némésis
            if (m.deathCoordinates && m.deathCoordinates.length > 0) {
                m.deathCoordinates.forEach(death => {
                    const victimId = death.puuid;
                    const killerAgent = death.agentImg; // C'est l'agent ennemi qui a tué
                    if (killerAgent) {
                        nemesisCounts[killerAgent] = (nemesisCounts[killerAgent] || 0) + 1;
                    }
                });
            }
        });

        const activePlayers = Object.values(playerStats).filter(p => p.games > 0);

        // Classements
        const mvp = [...activePlayers].sort((a, b) => b.rr - a.rr)[0];
        const butcher = [...activePlayers].sort((a, b) => {
            const kdA = a.deaths > 0 ? a.kills / a.deaths : a.kills;
            const kdB = b.deaths > 0 ? b.kills / b.deaths : b.kills;
            return kdB - kdA;
        })[0];

        const mostPlayedAgent = Object.entries(agentCounts).sort((a, b) => b[1] - a[1])[0];
        const worstNemesis = Object.entries(nemesisCounts).sort((a, b) => b[1] - a[1])[0];

        return {
            totalMatches, winrate, totalWins,
            mvp, butcher,
            mostPlayedAgent: mostPlayedAgent ? { name: mostPlayedAgent[0], count: mostPlayedAgent[1] } : null,
            worstNemesis: worstNemesis ? { img: worstNemesis[0], count: worstNemesis[1] } : null
        };

    }, [matches, playersConfig]);

    if (!wrapUpStats) {
        return (
            <div className="flex flex-col items-center justify-center h-[50vh] text-center">
                <Calendar size={48} className="text-gray-600 mb-4" />
                <h2 className="text-2xl font-black text-gray-500 uppercase">Aucune donnée classée</h2>
                <p className="text-gray-600 mt-2">Changez de période ou jouez des matchs pour générer le bilan.</p>
            </div>
        );
    }

    return (
        <div className="space-y-8 animate-in fade-in zoom-in duration-500">
            <div className="text-center space-y-2 mb-10">
                <h1 className="text-4xl md:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-[#ff4655] to-orange-400 uppercase italic tracking-tighter drop-shadow-lg">
                    Rétrospective
                </h1>
                <p className="text-gray-400">Le grand bilan de la période sélectionnée.</p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard title="Matchs Joués" value={wrapUpStats.totalMatches} icon={Activity} />
                <StatCard title="Victoires" value={wrapUpStats.totalWins} icon={Trophy} color="text-emerald-400" />
                <StatCard title="Winrate Global" value={`${wrapUpStats.winrate}%`} icon={Target} color={wrapUpStats.winrate >= 50 ? 'text-emerald-400' : 'text-red-400'} />
                <StatCard title="RR Généré" value={`${wrapUpStats.mvp?.rr > 0 ? '+' : ''}${wrapUpStats.mvp?.rr || 0}`} subtitle={`Par ${wrapUpStats.mvp?.name || 'Personne'}`} icon={Crown} color="text-yellow-400" />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8">
                {/* Le Joueur MVP */}
                {wrapUpStats.mvp && (
                    <div className="bg-gradient-to-br from-[#1c252e] to-[#0f1923] p-8 rounded-2xl border border-yellow-500/20 shadow-[0_0_30px_rgba(234,179,8,0.1)] relative overflow-hidden flex items-center gap-6">
                        <Crown size={100} className="absolute -right-6 -bottom-6 text-yellow-500/10 rotate-12" />
                        <div className="w-20 h-20 rounded-2xl flex items-center justify-center text-4xl font-black text-white shadow-xl z-10" style={{ backgroundColor: wrapUpStats.mvp.color }}>
                            {wrapUpStats.mvp.name.charAt(0)}
                        </div>
                        <div className="z-10">
                            <h3 className="text-sm font-bold text-yellow-500 uppercase tracking-widest mb-1">MVP de la Période</h3>
                            <div className="text-3xl font-black text-white uppercase">{wrapUpStats.mvp.name}</div>
                            <div className="text-gray-400 font-bold mt-2">
                                <span className={wrapUpStats.mvp.rr >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                                    {wrapUpStats.mvp.rr >= 0 ? '+' : ''}{wrapUpStats.mvp.rr} RR
                                </span> générés
                            </div>
                        </div>
                    </div>
                )}

                {/* Le Boucher (K/D) */}
                {wrapUpStats.butcher && (
                    <div className="bg-gradient-to-br from-[#1c252e] to-[#0f1923] p-8 rounded-2xl border border-red-500/20 shadow-[0_0_30px_rgba(239,68,68,0.1)] relative overflow-hidden flex items-center gap-6">
                        <Target size={100} className="absolute -right-6 -bottom-6 text-red-500/10 -rotate-12" />
                        <div className="w-20 h-20 rounded-2xl flex items-center justify-center text-4xl font-black text-white shadow-xl z-10 bg-[#0f1923] border border-white/10">
                            <span className="text-red-500 font-mono text-xl">{(wrapUpStats.butcher.deaths > 0 ? wrapUpStats.butcher.kills / wrapUpStats.butcher.deaths : wrapUpStats.butcher.kills).toFixed(2)}</span>
                        </div>
                        <div className="z-10">
                            <h3 className="text-sm font-bold text-red-500 uppercase tracking-widest mb-1">Le Boucher (K/D)</h3>
                            <div className="text-3xl font-black text-white uppercase">{wrapUpStats.butcher.name}</div>
                            <div className="text-gray-400 font-bold mt-2">
                                {wrapUpStats.butcher.kills} Kills au total
                            </div>
                        </div>
                    </div>
                )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Agent le plus joué */}
                {wrapUpStats.mostPlayedAgent && (
                    <div className="bg-[#1c252e] p-6 rounded-xl border border-white/5 flex items-center justify-between">
                        <div>
                            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">Agent Favori du Groupe</h3>
                            <div className="text-2xl font-black text-white uppercase">{wrapUpStats.mostPlayedAgent.name}</div>
                            <div className="text-emerald-400 font-bold mt-1">{wrapUpStats.mostPlayedAgent.count} sélections</div>
                        </div>
                    </div>
                )}

                {/* Pire Némésis */}
                {wrapUpStats.worstNemesis && (
                    <div className="bg-[#1c252e] p-6 rounded-xl border border-white/5 flex items-center justify-between">
                        <div>
                            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">Bête Noire (Némésis)</h3>
                            <div className="text-2xl font-black text-red-400 uppercase">La Terreur</div>
                            <div className="text-gray-400 font-bold mt-1">Vous a tué {wrapUpStats.worstNemesis.count} fois</div>
                        </div>
                        {wrapUpStats.worstNemesis.img && (
                            <img src={wrapUpStats.worstNemesis.img} alt="Nemesis" className="w-16 h-16 rounded-lg object-cover border border-red-500/30" />
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};