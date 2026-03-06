import React, { useMemo } from 'react';
import { Trophy, Swords, Target, Crosshair, Skull, Activity, Crown, Medal, Zap, Flame } from 'lucide-react';
import { StatPodium, Card } from '../components/UI';
import { getRankIcon } from '../config/constants';
import { calculateKD, calculateHS, calculateACS, safeDiv } from '../utils/calculations';

export const Leaderboard = ({ matches, playersConfig }) => {

    const currentRanks = useMemo(() => {
        const sorted = playersConfig.map(p => {
            const pMatches = matches.filter(m => m.playerId === p.id && m.type === 'ranked').sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
            if (pMatches.length > 0) {
                return { ...p, currentRank: pMatches[0].currentRank, currentRR: pMatches[0].currentRR, rankValue: pMatches[0].rankValue };
            }
            return { ...p, currentRank: 'Unranked', currentRR: 0, rankValue: 0 };
        }).filter(p => p.rankValue > 0).sort((a, b) => b.rankValue - a.rankValue);

        return sorted;
    }, [matches, playersConfig]); // <-- Modif ici

    const leaderboardStats = useMemo(() => {
        const validMatches = matches.filter(m => m.type === 'ranked');

        const statsByPlayer = {};
        playersConfig.forEach(p => {
            statsByPlayer[p.id] = {
                id: p.id, name: p.name,
                totalKills: 0, totalDeaths: 0,
                maxKillsGame: 0, maxDeathsGame: 0,
                totalHeadshots: 0, totalShots: 0,
                gamesPlayed: 0,
                weightedADR: 0,
                totalRounds: 0
            };
        });

        validMatches.forEach(m => {
            if (statsByPlayer[m.playerId]) {
                const p = statsByPlayer[m.playerId];
                p.gamesPlayed++;
                p.totalKills += m.kills;
                p.totalDeaths += m.deaths;
                p.totalHeadshots += (m.headshots || 0);
                p.totalShots += (m.totalShots || 0);
                if (m.kills > p.maxKillsGame) p.maxKillsGame = m.kills;
                if (m.deaths > p.maxDeathsGame) p.maxDeathsGame = m.deaths;

                const rounds = m.roundsPlayed || 20;
                p.totalRounds += rounds;
                p.weightedADR += (m.adr || 0) * rounds;
            }
        });

        const leaderboard = Object.values(statsByPlayer).map(p => ({
            ...p,
            kd: calculateKD(p.totalKills, p.totalDeaths),
            hsPercent: calculateHS(p.totalHeadshots, p.totalShots),
            avgADR: Math.round(safeDiv(p.weightedADR, p.totalRounds))
        }));

        const validDmMatches = matches.filter(m => m.type === 'dm');

        const dmStatsByPlayer = {};
        playersConfig.forEach(p => {
            dmStatsByPlayer[p.id] = {
                id: p.id, name: p.name,
                games: 0, wins: 0,
                totalPlacement: 0, totalScore: 0,
                totalKills: 0, totalDeaths: 0,
                totalRounds: 0
            };
        });

        validDmMatches.forEach(m => {
            if (dmStatsByPlayer[m.playerId]) {
                const p = dmStatsByPlayer[m.playerId];
                p.games++;
                if (m.placement === 1) p.wins++;
                p.totalPlacement += m.placement;
                p.totalScore += m.score;
                p.totalRounds += m.rounds;
                p.totalKills += m.kills;
                p.totalDeaths += m.deaths;
            }
        });

        const dmLeaderboard = Object.values(dmStatsByPlayer)
            .filter(p => p.games > 0)
            .map(p => ({
                ...p,
                avgPlace: (p.totalPlacement / p.games).toFixed(1),
                avgScore: calculateACS(p.totalScore, p.totalRounds),
                kd: calculateKD(p.totalKills, p.totalDeaths)
            }));

        return {
            byKills: [...leaderboard].sort((a, b) => b.totalKills - a.totalKills),
            byMaxKillGame: [...leaderboard].sort((a, b) => b.maxKillsGame - a.maxKillsGame),
            byKD: [...leaderboard].sort((a, b) => parseFloat(b.kd) - parseFloat(a.kd)),
            byHS: [...leaderboard].sort((a, b) => b.hsPercent - a.hsPercent),
            byDeaths: [...leaderboard].sort((a, b) => b.totalDeaths - a.totalDeaths),
            byADR: [...leaderboard].sort((a, b) => b.avgADR - a.avgADR),

            dmWins: [...dmLeaderboard].sort((a, b) => b.wins - a.wins),
            dmAvgPlace: [...dmLeaderboard].sort((a, b) => parseFloat(a.avgPlace) - parseFloat(b.avgPlace)),
            dmKD: [...dmLeaderboard].sort((a, b) => parseFloat(b.kd) - parseFloat(a.kd)),
            dmAvgScore: [...dmLeaderboard].sort((a, b) => b.avgScore - a.avgScore)
        };
    }, [matches, playersConfig]); // <-- Modif ici

    return (
        <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="mb-12">
                <div className="flex items-center gap-4 mb-6">
                    <div className="p-3 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl shadow-lg shadow-purple-500/20">
                        <Crown size={32} className="text-white" />
                    </div>
                    <div>
                        <h2 className="text-4xl font-black text-white italic tracking-tighter uppercase">COURSE À L'IMMORTAL</h2>
                        <p className="text-gray-400 font-medium uppercase tracking-widest text-xs">Classement actuel en temps réel</p>
                    </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {currentRanks.map((p, index) => {
                        const isFirst = index === 0;
                        return (
                            <Card key={p.id} className={`p-4 flex items-center gap-4 border-l-4 transition-transform hover:scale-[1.02] ${isFirst ? 'border-l-yellow-400 bg-gradient-to-r from-yellow-400/10 to-transparent' : 'border-l-white/10 hover:border-l-white/30'}`}>
                                <div className={`text-2xl font-black w-6 text-center ${isFirst ? 'text-yellow-400 drop-shadow-md' : 'text-gray-600'}`}>#{index + 1}</div>
                                <img src={getRankIcon(p.currentRank)} alt={p.currentRank} className="w-16 h-16 drop-shadow-[0_0_15px_rgba(255,255,255,0.1)]" title={p.currentRank} />
                                <div className="flex flex-col min-w-0">
                                    <span className="text-sm font-black text-white truncate uppercase" style={{ color: p.color }}>{p.name}</span>
                                    <span className="text-xs font-bold text-gray-300 truncate">{p.currentRank}</span>
                                    <span className="text-[10px] font-mono text-emerald-400 font-bold">{p.currentRR} RR</span>
                                </div>
                            </Card>
                        );
                    })}
                </div>
            </div>

            <div className="pt-8 border-t border-white/10">
                <div className="flex items-center gap-4 mb-8">
                    <div className="p-3 bg-gradient-to-br from-yellow-500 to-orange-600 rounded-xl shadow-lg shadow-orange-500/20">
                        <Trophy size={32} className="text-white" />
                    </div>
                    <div>
                        <h2 className="text-4xl font-black text-white italic tracking-tighter uppercase">STATS GLOBALES</h2>
                        <p className="text-gray-400 font-medium uppercase tracking-widest text-xs">Depuis le début du challenge</p>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 auto-rows-fr">
                    <StatPodium title="Top Fragger (Total Kills)" icon={Swords} data={leaderboardStats.byKills.map(p => ({ name: p.name, value: p.totalKills }))} />
                    <StatPodium title="Meilleur K/D" icon={Target} data={leaderboardStats.byKD.map(p => ({ name: p.name, value: p.kd }))} />
                    <StatPodium title="Le Bombardier (ADR)" icon={Flame} data={leaderboardStats.byADR.map(p => ({ name: p.name, value: p.avgADR }))} suffix=" ADR" />
                    <StatPodium title="Aim God (% HS)" icon={Crosshair} data={leaderboardStats.byHS.map(p => ({ name: p.name, value: p.hsPercent }))} suffix="%" />
                    <StatPodium title="Le Sac à PV (Total Morts)" icon={Skull} data={leaderboardStats.byDeaths.map(p => ({ name: p.name, value: p.totalDeaths }))} />
                    <StatPodium title="Sommet (Max Kills en 1 Game)" icon={Activity} data={leaderboardStats.byMaxKillGame.map(p => ({ name: p.name, value: p.maxKillsGame }))} />
                </div>
            </div>

            <div className="pt-8 border-t border-white/10">
                <div className="flex items-center gap-4 mb-8">
                    <div className="p-3 bg-gradient-to-br from-[#ff4655] to-red-700 rounded-xl shadow-lg shadow-red-500/20">
                        <Swords size={32} className="text-white" />
                    </div>
                    <div>
                        <h2 className="text-4xl font-black text-white italic tracking-tighter uppercase">CLASSEMENT DEATHMATCH</h2>
                        <p className="text-gray-400 font-medium uppercase tracking-widest text-xs">Les Rois de l'échauffement</p>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 auto-rows-fr">
                    <StatPodium title="Le Roi du DM (Victoires)" icon={Crown} data={leaderboardStats.dmWins.map(p => ({ name: p.name, value: p.wins }))} suffix=" Wins" />
                    <StatPodium title="La Régularité (Place Moy.)" icon={Medal} data={leaderboardStats.dmAvgPlace.map(p => ({ name: p.name, value: p.avgPlace }))} />
                    <StatPodium title="La Machine (K/D Ratio)" icon={Crosshair} data={leaderboardStats.dmKD.map(p => ({ name: p.name, value: p.kd }))} />
                    <StatPodium title="Gros Scoreur (Score Moy.)" icon={Zap} data={leaderboardStats.dmAvgScore.map(p => ({ name: p.name, value: p.avgScore }))} />
                </div>
            </div>
        </div>
    );
};