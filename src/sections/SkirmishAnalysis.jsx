import React, { useMemo } from 'react';
import { Users, Swords, Trophy, Target, Crosshair } from 'lucide-react';
import { StatCard } from '../components/UI';

export const SkirmishAnalysis = ({ matches, selectedPlayerId, challengeStartDate }) => {
    // On filtre pour ne garder que le mode skirmish
    const skirmishData = useMemo(() => {
        let data = matches.filter(m => m.type === 'skirmish');

        if (selectedPlayerId !== 'all') {
            data = data.filter(m => m.playerId === selectedPlayerId);
        }

        if (challengeStartDate) {
            const startDate = new Date(challengeStartDate).getTime();
            data = data.filter(m => {
                const matchTime = m.timestamp ? m.timestamp * 1000 : new Date(m.date).getTime();
                return matchTime >= startDate;
            });
        }
        return data.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    }, [matches, selectedPlayerId, challengeStartDate]);

    if (skirmishData.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-[50vh] text-center">
                <Users size={48} className="text-gray-600 mb-4" />
                <h2 className="text-2xl font-black text-gray-500 uppercase">Aucun match Skirmish</h2>
                <p className="text-gray-600 mt-2">Jouez quelques parties en 2v2 pour voir vos statistiques ici.</p>
            </div>
        );
    }

    const totalMatches = skirmishData.length;
    const wins = skirmishData.filter(m => m.result === 'WIN').length;
    const winrate = Math.round((wins / totalMatches) * 100);
    const totalKills = skirmishData.reduce((acc, m) => acc + (m.kills || 0), 0);
    const totalDeaths = skirmishData.reduce((acc, m) => acc + (m.deaths || 0), 0);
    const kd = totalDeaths > 0 ? (totalKills / totalDeaths).toFixed(2) : totalKills;

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-black text-white uppercase tracking-tight flex items-center gap-3">
                    <Users className="text-[#ff4655]" /> Skirmish 2v2
                </h2>
                <p className="text-gray-400 text-sm mt-1">Analyse de vos performances dans le mode duo (Premier à 10 manches).</p>
            </div>

            {/* STATISTIQUES GLOBALES */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard title="Matchs Joués" value={totalMatches} icon={Swords} />
                <StatCard
                    title="Winrate"
                    value={`${winrate}%`}
                    subtitle={`${wins} Victoires`}
                    icon={Trophy}
                    color={winrate >= 50 ? 'text-emerald-400' : 'text-red-400'}
                />
                <StatCard
                    title="K/D Ratio"
                    value={kd}
                    icon={Crosshair}
                    color={kd >= 1 ? 'text-emerald-400' : 'text-red-400'}
                />
                <StatCard title="Kills Totaux" value={totalKills} icon={Target} />
            </div>

            {/* HISTORIQUE DES MATCHS 2v2 */}
            <div className="bg-[#1c252e] rounded-xl border border-white/5 overflow-hidden">
                <div className="p-4 border-b border-white/5 bg-black/20">
                    <h3 className="font-bold text-white uppercase">Historique Récent (Skirmish)</h3>
                </div>
                <div className="divide-y divide-white/5">
                    {skirmishData.slice(0, 20).map(m => {
                        const isWin = m.result === 'WIN';
                        return (
                            <div key={m.id} className="p-4 flex items-center justify-between hover:bg-white/5 transition-colors">
                                <div className="flex items-center gap-4">
                                    <div className={`w-1.5 h-12 rounded-full ${isWin ? 'bg-emerald-500' : 'bg-red-500'}`}></div>
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <span className={`font-black uppercase text-lg ${isWin ? 'text-emerald-400' : 'text-red-400'}`}>
                                                {isWin ? 'VICTOIRE' : 'DÉFAITE'}
                                            </span>
                                            <span className="text-gray-500 font-bold">{m.scoreTeam}</span>
                                        </div>
                                        <div className="text-xs text-gray-400 flex items-center gap-2">
                                            <span>{new Date(m.date).toLocaleDateString('fr-FR')}</span>
                                            <span>•</span>
                                            <span>{m.map}</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex items-center gap-6">
                                    <div className="text-right hidden sm:block">
                                        <div className="text-xs text-gray-500 uppercase font-bold">K / D / A</div>
                                        <div className="font-mono text-sm">
                                            <span className="text-white">{m.kills}</span> / <span className="text-red-400">{m.deaths}</span> / <span className="text-gray-400">{m.assists}</span>
                                        </div>
                                    </div>
                                    {m.agentImg && (
                                        <img src={m.agentImg} alt={m.agent} className="w-10 h-10 rounded-lg border border-white/10 bg-black/50 object-cover" />
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};