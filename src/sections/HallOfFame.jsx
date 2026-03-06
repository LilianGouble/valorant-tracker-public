import React, { useState, useMemo } from 'react';
import {
    Trophy, Crosshair, Swords, Award, Ghost, Target, HeartCrack,
    ShieldAlert, Ban, Globe, History, ChevronLeft, ChevronRight,
    Mountain, Footprints, Skull, UserMinus, ZapOff, Coins, Wallet,
    Sparkles, Brain, Flame, Sprout, Scissors
} from 'lucide-react';
import { Card } from '../components/UI';
import { safeDiv, parseRoundsFromScore } from '../utils/calculations';

// --- COMPOSANTS CARTES ---

const FameCard = ({ title, icon: Icon, player, value, subtext }) => (
    <Card className="p-6 relative overflow-hidden border-yellow-500/50 group hover:border-yellow-400 transition-all bg-gradient-to-br from-yellow-900/40 to-black hover:shadow-[0_0_30px_rgba(234,179,8,0.2)]">
        <div className="absolute -right-6 -top-6 text-yellow-500/10 rotate-12 group-hover:scale-110 transition-transform duration-500">
            <Icon size={120} />
        </div>
        <div className="relative z-10">
            <div className="flex items-center gap-3 mb-4">
                <div className="p-3 bg-yellow-500/20 rounded-xl border border-yellow-500/30 text-yellow-400 shadow-[0_0_15px_rgba(250,204,21,0.3)]">
                    <Icon size={24} />
                </div>
                <h3 className="font-black text-lg uppercase text-yellow-100 tracking-tighter italic">{title}</h3>
            </div>
            {player ? (
                <div className="mt-4">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 rounded-lg bg-yellow-600/20 flex items-center justify-center font-bold text-yellow-200 border border-yellow-500/20" style={{ backgroundColor: player.color + '20', borderColor: player.color }}>
                            {player.name.charAt(0)}
                        </div>
                        <div>
                            <p className="text-xl font-black text-white leading-none">{player.name}</p>
                            <p className="text-[10px] font-bold text-yellow-500 uppercase tracking-widest mt-1">Légende</p>
                        </div>
                    </div>
                    <div className="mt-4 bg-black/40 p-3 rounded-lg border border-yellow-500/20 backdrop-blur-sm">
                        <p className="text-2xl font-black text-yellow-400 font-mono text-center">{value}</p>
                        <p className="text-center text-xs text-gray-400 font-medium italic mt-1">"{subtext}"</p>
                    </div>
                </div>
            ) : (
                <div className="h-32 flex items-center justify-center text-gray-500 text-sm italic">Pas assez de données...</div>
            )}
        </div>
    </Card>
);

const ShameCard = ({ title, icon: Icon, player, value, subtext, color = "from-red-900/50 to-red-800/20", accentColor = "text-red-400" }) => (
    <Card className={`p-6 relative overflow-hidden border-white/5 group hover:border-white/10 transition-all bg-gradient-to-br ${color}`}>
        <div className="absolute -right-6 -top-6 text-white/5 rotate-12 group-hover:scale-110 transition-transform duration-500">
            <Icon size={120} />
        </div>
        <div className="relative z-10">
            <div className="flex items-center gap-3 mb-4">
                <div className={`p-3 bg-black/20 rounded-xl border border-white/10 ${accentColor} shadow-inner`}>
                    <Icon size={24} />
                </div>
                <h3 className={`font-black text-lg uppercase tracking-tighter italic ${accentColor === 'text-red-400' ? 'text-red-100' : 'text-gray-200'}`}>{title}</h3>
            </div>
            {player ? (
                <div className="mt-4">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 rounded-lg bg-black/40 flex items-center justify-center font-bold text-gray-500 border border-white/10">
                            {player.name.charAt(0)}
                        </div>
                        <div>
                            <p className="text-xl font-black text-white leading-none">{player.name}</p>
                            <p className={`text-[10px] font-bold uppercase tracking-widest mt-1 ${accentColor}`}>Coupable</p>
                        </div>
                    </div>
                    <div className="mt-4 bg-black/20 p-3 rounded-lg border border-white/5 backdrop-blur-sm">
                        <p className={`text-2xl font-black font-mono text-center ${accentColor}`}>{value}</p>
                        <p className="text-center text-xs text-gray-400 font-medium italic mt-1">"{subtext}"</p>
                    </div>
                </div>
            ) : (
                <div className="h-32 flex items-center justify-center text-gray-500 text-sm italic">Personne n'est coupable...</div>
            )}
        </div>
    </Card>
);

// --- COMPOSANT PRINCIPAL ---

export const HallOfFameAndShame = ({ matches, playersConfig }) => {
    const [viewMode, setViewMode] = useState('global');
    const [selectedDate, setSelectedDate] = useState(new Date());

    const handlePrevDay = () => { const newDate = new Date(selectedDate); newDate.setDate(selectedDate.getDate() - 1); setSelectedDate(newDate); };
    const handleNextDay = () => { const newDate = new Date(selectedDate); newDate.setDate(selectedDate.getDate() + 1); if (newDate <= new Date()) setSelectedDate(newDate); };

    const aggregatedStats = useMemo(() => {
        let validMatches = matches.filter(m => {
            if (m.type !== 'ranked') return false;
            return true;
        });

        if (viewMode === 'daily') {
            const dateStr = selectedDate.toLocaleDateString();
            validMatches = validMatches.filter(m => new Date(m.date).toLocaleDateString() === dateStr);
        }

        const stats = {};
        playersConfig.forEach(p => {
            stats[p.id] = {
                id: p.id, name: p.name, color: p.color,
                games: 0, wins: 0, losses: 0,
                totalKills: 0, totalDeaths: 0, totalAssists: 0,
                totalHS: 0, totalShots: 0,
                totalRR_Lost: 0, totalRR_Gained: 0,
                totalScore: 0, totalRounds: 0,

                // Nouveaux accumulateurs
                weightedADR: 0,
                totalSpent: 0,
                totalAbilities: 0,
                totalPlants: 0,
                totalDefuses: 0
            };
        });

        validMatches.forEach(m => {
            if (stats[m.playerId]) {
                const p = stats[m.playerId];
                p.games++;
                if (m.result === 'WIN') p.wins++; else p.losses++;
                p.totalKills += m.kills;
                p.totalDeaths += m.deaths;
                p.totalAssists += (m.assists || 0);
                p.totalHS += (m.headshots || 0);
                p.totalShots += (m.totalShots || 0);
                if (m.rrChange < 0) p.totalRR_Lost += Math.abs(m.rrChange);
                if (m.rrChange > 0) p.totalRR_Gained += m.rrChange;
                p.totalScore += (m.score || 0);

                let roundsPlayed = m.roundsPlayed || (m.rounds ? m.rounds.length : 20);
                if (!roundsPlayed && m.matchScore) roundsPlayed = parseRoundsFromScore(m.matchScore);
                roundsPlayed = roundsPlayed || 1; // Sécurité

                p.totalRounds += roundsPlayed;
                p.weightedADR += (m.adr || 0) * roundsPlayed;

                if (m.economy?.avgSpent) p.totalSpent += m.economy.avgSpent * roundsPlayed;
                if (m.abilities?.total) p.totalAbilities += m.abilities.total;

                // Accumulation Plants / Defuses (venant de App.jsx)
                p.totalPlants += (m.plants || 0);
                p.totalDefuses += (m.defuses || 0);
            }
        });

        const minGamesRequired = viewMode === 'daily' ? 1 : 5;
        const activePlayers = Object.values(stats).filter(p => p.games >= minGamesRequired);

        if (activePlayers.length === 0) return null;

        // --- CALCULS DE FAME ---

        // Chirurgien : Meilleur HS%
        const surgeon = [...activePlayers].sort((a, b) => safeDiv(b.totalHS, b.totalShots) - safeDiv(a.totalHS, a.totalShots))[0];

        // Alpiniste : Plus gros gain de RR
        const alpinist = [...activePlayers].sort((a, b) => b.totalRR_Gained - a.totalRR_Gained)[0];

        // Terminator : Meilleur K/D
        const terminator = [...activePlayers].sort((a, b) => safeDiv(b.totalKills, b.totalDeaths) - safeDiv(a.totalKills, a.totalDeaths))[0];

        // Le Bombardier (Best ADR)
        const bomber = [...activePlayers].sort((a, b) => safeDiv(b.weightedADR, b.totalRounds) - safeDiv(a.weightedADR, a.totalRounds))[0];

        // Le Banquier (Plus grosse dépense moy/round)
        const banker = [...activePlayers].sort((a, b) => safeDiv(b.totalSpent, b.totalRounds) - safeDiv(a.totalSpent, a.totalRounds))[0];

        // Le Magicien (Plus de sorts par round)
        const wizard = [...activePlayers].sort((a, b) => safeDiv(b.totalAbilities, b.totalRounds) - safeDiv(a.totalAbilities, a.totalRounds))[0];

        // Le Jardinier (Plus de plants par game)
        const gardener = [...activePlayers].sort((a, b) => safeDiv(b.totalPlants, b.games) - safeDiv(a.totalPlants, a.games))[0];

        // Le Démineur (Plus de defuses par game)
        const defuser = [...activePlayers].sort((a, b) => safeDiv(b.totalDefuses, b.games) - safeDiv(a.totalDefuses, a.games))[0];


        // --- CALCULS DE SHAME ---

        // Stormtrooper : Pire HS%
        const stormtrooper = [...activePlayers]
            .filter(p => p.totalShots > 50)
            .sort((a, b) => safeDiv(a.totalHS, a.totalShots) - safeDiv(b.totalHS, b.totalShots))[0];

        // Donateur : Plus grosse perte de RR
        const donor = [...activePlayers].sort((a, b) => b.totalRR_Lost - a.totalRR_Lost)[0];

        // Touriste : Plus bas ACS
        const tourist = [...activePlayers]
            .sort((a, b) => safeDiv(a.totalScore, a.totalRounds) - safeDiv(b.totalScore, b.totalRounds))[0];

        // L'Oncle Picsou (Plus petite dépense moy/round)
        const miser = [...activePlayers].sort((a, b) => safeDiv(a.totalSpent, a.totalRounds) - safeDiv(b.totalSpent, b.totalRounds))[0];

        // Le Boomer (Moins de sorts par round)
        const boomer = [...activePlayers].sort((a, b) => safeDiv(a.totalAbilities, a.totalRounds) - safeDiv(b.totalAbilities, b.totalRounds))[0];

        return {
            fame: { surgeon, alpinist, terminator, bomber, banker, wizard, gardener, defuser },
            shame: { stormtrooper, donor, tourist, miser, boomer }
        };
    }, [matches, viewMode, selectedDate, playersConfig]); // <-- La correction est ici

    return (
        <div className="space-y-8 animate-in slide-in-from-bottom duration-700">
            <div className="flex flex-col items-center gap-4 mb-4">
                <div className="bg-[#1c252e] p-1 rounded-lg border border-white/10 flex">
                    <button onClick={() => setViewMode('global')} className={`px-4 py-2 rounded-md text-sm font-bold transition-all ${viewMode === 'global' ? 'bg-[#ff4655] text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}>
                        <Globe size={16} className="inline mr-2" /> GLOBAL
                    </button>
                    <button onClick={() => setViewMode('daily')} className={`px-4 py-2 rounded-md text-sm font-bold transition-all ${viewMode === 'daily' ? 'bg-[#ff4655] text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}>
                        <History size={16} className="inline mr-2" /> JOURNALIER
                    </button>
                </div>
                {viewMode === 'daily' && (
                    <div className="flex items-center gap-2 bg-[#0f1923] border border-white/10 rounded-lg p-1.5 px-3">
                        <button onClick={handlePrevDay} className="text-gray-400 hover:text-white transition-colors"><ChevronLeft size={20} /></button>
                        <span className="text-white font-mono font-bold min-w-[100px] text-center">{selectedDate.toLocaleDateString()}</span>
                        <button onClick={handleNextDay} disabled={selectedDate.toLocaleDateString() === new Date().toLocaleDateString()} className={`text-gray-400 transition-colors ${selectedDate.toLocaleDateString() === new Date().toLocaleDateString() ? 'opacity-30 cursor-not-allowed' : 'hover:text-white'}`}>
                            <ChevronRight size={20} />
                        </button>
                    </div>
                )}
            </div>

            {!aggregatedStats ? (
                <div className="p-12 text-center border-2 border-dashed border-white/10 rounded-xl bg-white/5">
                    <Ghost className="mx-auto text-gray-600 mb-4" size={48} />
                    <h3 className="text-xl font-bold text-gray-400">Le Hall est vide...</h3>
                    <p className="text-sm text-gray-500 mt-2">
                        {viewMode === 'daily'
                            ? "Pas de Ranked jouée à cette date."
                            : "Il faut au moins 5 parties pour apparaître dans le classement global."}
                    </p>
                </div>
            ) : (
                <div className="space-y-12">
                    {/* --- HALL OF FAME --- */}
                    <div>
                        <h2 className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-yellow-300 to-yellow-600 italic tracking-tighter uppercase mb-6 flex items-center gap-3 drop-shadow-sm border-b border-yellow-500/30 pb-4">
                            <Trophy className="text-yellow-400" size={32} /> HALL OF FAME
                        </h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                            <FameCard title="L'Alpiniste" icon={Mountain} player={aggregatedStats.fame.alpinist} value={`+${aggregatedStats.fame.alpinist?.totalRR_Gained} RR`} subtext="Il grimpe les échelons vers l'Immortal." />
                            <FameCard title="Le Terminator" icon={Swords} player={aggregatedStats.fame.terminator} value={`${aggregatedStats.fame.terminator ? safeDiv(aggregatedStats.fame.terminator.totalKills, aggregatedStats.fame.terminator.totalDeaths, 2) : 0} K/D`} subtext="Une machine à tuer." />
                            <FameCard title="Le Bombardier" icon={Flame} player={aggregatedStats.fame.bomber} value={`${aggregatedStats.fame.bomber ? Math.round(safeDiv(aggregatedStats.fame.bomber.weightedADR, aggregatedStats.fame.bomber.totalRounds)) : 0} ADR`} subtext="Dégâts massifs à chaque round." />
                            <FameCard title="Le Chirurgien" icon={Crosshair} player={aggregatedStats.fame.surgeon} value={`${aggregatedStats.fame.surgeon ? Math.round(safeDiv(aggregatedStats.fame.surgeon.totalHS, aggregatedStats.fame.surgeon.totalShots) * 100) : 0}% HS`} subtext="Vise la tête, et rien d'autre." />

                            <FameCard title="Le Banquier" icon={Coins} player={aggregatedStats.fame.banker} value={`${aggregatedStats.fame.banker ? Math.round(safeDiv(aggregatedStats.fame.banker.totalSpent, aggregatedStats.fame.banker.totalRounds)) : 0} ¤`} subtext="Dépense moyenne par round." />
                            <FameCard title="Le Magicien" icon={Sparkles} player={aggregatedStats.fame.wizard} value={`${aggregatedStats.fame.wizard ? safeDiv(aggregatedStats.fame.wizard.totalAbilities, aggregatedStats.fame.wizard.totalRounds, 1) : 0}`} subtext="Sorts utilisés par round." />
                            <FameCard title="Le Jardinier" icon={Sprout} player={aggregatedStats.fame.gardener} value={`${aggregatedStats.fame.gardener?.totalPlants} Plants`} subtext="Il plante le spike partout." />
                            <FameCard title="Le Démineur" icon={Scissors} player={aggregatedStats.fame.defuser} value={`${aggregatedStats.fame.defuser?.totalDefuses} Defuses`} subtext="Ne tremble jamais devant le bip." />
                        </div>
                    </div>

                    {/* --- HALL OF SHAME --- */}
                    <div>
                        <h2 className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-red-400 to-red-800 italic tracking-tighter uppercase mb-6 flex items-center gap-3 drop-shadow-sm border-b border-red-500/30 pb-4">
                            <Ghost className="text-red-500" size={32} /> HALL OF SHAME (ET FUN)
                        </h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            <ShameCard title="Le Donateur" icon={HeartCrack} player={aggregatedStats.shame.donor} value={`-${aggregatedStats.shame.donor?.totalRR_Lost} RR`} subtext="Généreux avec Riot Games." color="from-pink-900/50 to-purple-900/20" accentColor="text-pink-400" />
                            <ShameCard title="Le Stormtrooper" icon={Target} player={aggregatedStats.shame.stormtrooper} value={`${aggregatedStats.shame.stormtrooper ? Math.round(safeDiv(aggregatedStats.shame.stormtrooper.totalHS, aggregatedStats.shame.stormtrooper.totalShots) * 100) : 0}% HS`} subtext="Vise les pieds, c'est plus gros." />
                            <ShameCard title="Le Touriste" icon={Footprints} player={aggregatedStats.shame.tourist} value={`${aggregatedStats.shame.tourist ? Math.round(safeDiv(aggregatedStats.shame.tourist.totalScore, aggregatedStats.shame.tourist.totalRounds)) : 0} ACS`} subtext="Il est juste venu visiter la map." color="from-green-900/50 to-emerald-900/20" accentColor="text-emerald-400" />

                            <ShameCard title="Oncle Picsou" icon={Wallet} player={aggregatedStats.shame.miser} value={`${aggregatedStats.shame.miser ? Math.round(safeDiv(aggregatedStats.shame.miser.totalSpent, aggregatedStats.shame.miser.totalRounds)) : 0} ¤`} subtext="Mourir avec 9000 crédits, un art." color="from-yellow-900/50 to-orange-900/20" accentColor="text-yellow-500" />
                            <ShameCard title="Le Boomer" icon={Brain} player={aggregatedStats.shame.boomer} value={`${aggregatedStats.shame.boomer ? safeDiv(aggregatedStats.shame.boomer.totalAbilities, aggregatedStats.shame.boomer.totalRounds, 1) : 0}`} subtext="Il a oublié qu'il avait des sorts." color="from-gray-800 to-black" accentColor="text-gray-400" />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};