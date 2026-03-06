import React, { useState, useMemo } from 'react';
import { Cloud, Sun, CloudRain, CloudLightning, ChevronLeft, ChevronRight, Crosshair, Wind, Activity, Umbrella, Map as MapIcon, AlertTriangle, Skull } from 'lucide-react';
import { Card } from '../components/UI';

export const ServerWeather = ({ matches, playersConfig }) => {
    const [selectedDate, setSelectedDate] = useState(new Date());

    const handlePrevDay = () => {
        const newDate = new Date(selectedDate);
        newDate.setDate(selectedDate.getDate() - 1);
        setSelectedDate(newDate);
    };

    const handleNextDay = () => {
        const newDate = new Date(selectedDate);
        newDate.setDate(selectedDate.getDate() + 1);
        if (newDate <= new Date()) setSelectedDate(newDate);
    };

    const weatherStats = useMemo(() => {
        const dateStr = selectedDate.toLocaleDateString();

        const dailyRankedMatches = matches.filter(m => {
            if (m.type !== 'ranked') return false;
            if (!m.matchScore) return false;
            return new Date(m.date).toLocaleDateString() === dateStr;
        });

        const uniqueGames = {};

        dailyRankedMatches.forEach(m => {
            if (!uniqueGames[m.id]) {
                uniqueGames[m.id] = {
                    id: m.id,
                    map: m.map,
                    result: m.result,
                    kills: 0,
                    deaths: 0,
                    rrChange: 0,
                    playerCount: 0
                };
            }
            uniqueGames[m.id].kills += m.kills;
            uniqueGames[m.id].deaths += m.deaths;
            uniqueGames[m.id].rrChange += m.rrChange;
            uniqueGames[m.id].playerCount++;

            if (m.result === 'WIN') uniqueGames[m.id].result = 'WIN';
        });

        const uniqueGamesList = Object.values(uniqueGames);

        const stats = {
            totalGames: uniqueGamesList.length,
            totalWins: 0,
            totalKills: 0,
            totalDeaths: 0,
            totalRRChange: 0,
            mapStats: {}
        };

        uniqueGamesList.forEach(game => {
            if (game.result === 'WIN') stats.totalWins++;
            stats.totalKills += game.kills;
            stats.totalDeaths += game.deaths;
            stats.totalRRChange += game.rrChange;

            if (!stats.mapStats[game.map]) stats.mapStats[game.map] = { wins: 0, games: 0 };
            stats.mapStats[game.map].games++;
            if (game.result === 'WIN') stats.mapStats[game.map].wins++;
        });

        const globalWR = stats.totalGames > 0 ? (stats.totalWins / stats.totalGames) * 100 : 0;
        const globalKD = stats.totalDeaths > 0 ? (stats.totalKills / stats.totalDeaths).toFixed(2) : 0;

        let weatherType = 'cloudy';
        let weatherTitle = 'Mitigé';
        let weatherDesc = 'Des hauts et des bas. Concentrez-vous !';
        let WeatherIcon = Cloud;
        let weatherColor = 'text-gray-400';
        let weatherBg = 'from-gray-800 to-slate-900';

        if (globalWR >= 60) {
            weatherType = 'sunny';
            weatherTitle = 'Grand Soleil';
            weatherDesc = 'Le serveur est en feu ! Continuez comme ça !';
            WeatherIcon = Sun;
            weatherColor = 'text-yellow-400';
            weatherBg = 'from-yellow-900/40 to-orange-900/40';
        } else if (globalWR < 45 && globalWR >= 25) {
            weatherType = 'rainy';
            weatherTitle = 'Averses';
            weatherDesc = 'Sortez les parapluies, le RR coule à flots...';
            WeatherIcon = CloudRain;
            weatherColor = 'text-blue-400';
            weatherBg = 'from-blue-900/40 to-cyan-900/40';
        } else if (globalWR < 25 && stats.totalGames > 0) {
            weatherType = 'stormy';
            weatherTitle = 'Tempête';
            weatherDesc = 'Alerte rouge ! Arrêtez de tag ou c\'est la relégation !';
            WeatherIcon = CloudLightning;
            weatherColor = 'text-purple-500';
            weatherBg = 'from-purple-900/40 to-indigo-900/40';
        }

        let bestMap = { name: 'Aucune', wr: 0 };
        let worstMap = { name: 'Aucune', wr: 100 };

        Object.entries(stats.mapStats).forEach(([name, s]) => {
            const wr = (s.wins / s.games) * 100;
            if (wr >= bestMap.wr) bestMap = { name, wr: Math.round(wr), count: s.games };
            if (wr <= worstMap.wr) worstMap = { name, wr: Math.round(wr), count: s.games };
        });

        return { ...stats, globalWR, globalKD, weatherType, weatherTitle, weatherDesc, WeatherIcon, weatherColor, weatherBg, bestMap, worstMap };
    }, [matches, selectedDate]);

    const { WeatherIcon, weatherColor, weatherBg, weatherTitle, weatherDesc, globalWR, globalKD, totalRRChange, bestMap, worstMap } = weatherStats;

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="flex justify-center mb-4">
                <div className="flex items-center gap-4 bg-[#1c252e] border border-white/10 rounded-xl p-2 px-4 shadow-lg">
                    <button onClick={handlePrevDay} className="p-1 hover:bg-white/10 rounded-full text-gray-400 hover:text-white transition-colors"><ChevronLeft size={24} /></button>
                    <div className="text-center">
                        <span className="block text-xs font-bold text-gray-500 uppercase tracking-widest">Météo du</span>
                        <span className="block text-xl font-black text-white font-mono">{selectedDate.toLocaleDateString()}</span>
                    </div>
                    <button
                        onClick={handleNextDay}
                        disabled={selectedDate.toLocaleDateString() === new Date().toLocaleDateString()}
                        className={`p-1 rounded-full transition-colors ${selectedDate.toLocaleDateString() === new Date().toLocaleDateString() ? 'text-gray-700 cursor-not-allowed' : 'text-gray-400 hover:text-white hover:bg-white/10'}`}
                    >
                        <ChevronRight size={24} />
                    </button>
                </div>
            </div>

            {weatherStats.totalGames === 0 ? (
                <div className="p-12 text-center border-2 border-dashed border-white/10 rounded-xl bg-white/5">
                    <Cloud className="mx-auto text-gray-600 mb-4" size={64} />
                    <h3 className="text-2xl font-bold text-gray-400">Pas de prévision météo.</h3>
                    <p className="text-gray-500 mt-2">Aucune partie Ranked n'a été jouée à cette date.</p>
                </div>
            ) : (
                <>
                    <div className={`rounded-3xl p-8 bg-gradient-to-br ${weatherBg} border border-white/10 shadow-2xl relative overflow-hidden`}>
                        <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none"></div>

                        <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-8">
                            <div className="flex items-center gap-6">
                                <div className={`p-6 rounded-2xl bg-black/20 backdrop-blur-md border border-white/10 shadow-inner ${weatherColor}`}>
                                    <WeatherIcon size={80} strokeWidth={1.5} />
                                </div>
                                <div>
                                    <h2 className={`text-4xl md:text-6xl font-black italic tracking-tighter uppercase ${weatherColor} drop-shadow-md`}>
                                        {weatherTitle}
                                    </h2>
                                    <p className="text-lg text-gray-300 font-medium max-w-md mt-2 flex items-center gap-2">
                                        {weatherDesc}
                                    </p>
                                </div>
                            </div>

                            <div className="bg-black/30 p-6 rounded-2xl border border-white/5 backdrop-blur-md min-w-[250px]">
                                <div className="flex justify-between items-end mb-2">
                                    <span className="text-sm font-bold text-gray-400 uppercase tracking-wider">Winrate Global</span>
                                    <span className={`text-3xl font-black ${globalWR >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>{Math.round(globalWR)}%</span>
                                </div>
                                <div className="w-full h-3 bg-gray-800 rounded-full overflow-hidden">
                                    <div className={`h-full transition-all duration-1000 ease-out ${globalWR >= 50 ? 'bg-emerald-500' : 'bg-red-500'}`} style={{ width: `${globalWR}%` }}></div>
                                </div>
                                <p className="text-xs text-gray-500 mt-2 text-right">{weatherStats.totalWins}W - {weatherStats.totalGames - weatherStats.totalWins}L ({weatherStats.totalGames} Games)</p>
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <Card className="p-6 flex flex-col items-center justify-center relative overflow-hidden group">
                            <div className="absolute inset-0 bg-gradient-to-t from-blue-900/20 to-transparent pointer-events-none"></div>
                            <div className="p-3 bg-blue-500/10 text-blue-400 rounded-full mb-3 group-hover:scale-110 transition-transform">
                                <Crosshair size={32} />
                            </div>
                            <h3 className="text-gray-400 font-bold uppercase text-xs tracking-widest mb-1">Pression (K/D Global)</h3>
                            <p className="text-4xl font-black text-white">{globalKD}</p>
                        </Card>

                        <Card className="p-6 flex flex-col items-center justify-center relative overflow-hidden group">
                            <div className={`absolute inset-0 bg-gradient-to-t ${totalRRChange >= 0 ? 'from-emerald-900/20' : 'from-red-900/20'} to-transparent pointer-events-none`}></div>
                            <div className={`p-3 ${totalRRChange >= 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'} rounded-full mb-3 group-hover:scale-110 transition-transform`}>
                                <Wind size={32} />
                            </div>
                            <h3 className="text-gray-400 font-bold uppercase text-xs tracking-widest mb-1">Vent (Bilan RR)</h3>
                            <p className={`text-4xl font-black ${totalRRChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {totalRRChange > 0 ? '+' : ''}{totalRRChange}
                            </p>
                        </Card>

                        <Card className="p-6 flex flex-col items-center justify-center relative overflow-hidden group">
                            <div className="absolute inset-0 bg-gradient-to-t from-orange-900/20 to-transparent pointer-events-none"></div>
                            <div className="p-3 bg-orange-500/10 text-orange-400 rounded-full mb-3 group-hover:scale-110 transition-transform">
                                <Activity size={32} />
                            </div>
                            <h3 className="text-gray-400 font-bold uppercase text-xs tracking-widest mb-1">Intensité</h3>
                            <p className="text-4xl font-black text-white">{weatherStats.totalGames} <span className="text-lg text-gray-500">Games</span></p>
                        </Card>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <Card className="p-5 flex items-center justify-between bg-gradient-to-r from-[#1c252e] to-emerald-900/20 border-l-4 border-emerald-500">
                            <div>
                                <div className="flex items-center gap-2 mb-1">
                                    <Umbrella size={18} className="text-emerald-400" />
                                    <span className="text-emerald-400 font-black uppercase text-xs tracking-wider">ZONE DE CONFORT</span>
                                </div>
                                <h4 className="text-2xl font-black text-white uppercase">{bestMap.name !== 'Aucune' ? bestMap.name : 'N/A'}</h4>
                                <p className="text-sm text-gray-400 font-mono mt-1">{bestMap.count} Games • <span className="text-emerald-400 font-bold">{bestMap.wr}% WR</span></p>
                            </div>
                            <div className="opacity-20 text-emerald-400">
                                <MapIcon size={64} />
                            </div>
                        </Card>

                        <Card className="p-5 flex items-center justify-between bg-gradient-to-r from-[#1c252e] to-red-900/20 border-l-4 border-red-500">
                            <div>
                                <div className="flex items-center gap-2 mb-1">
                                    <AlertTriangle size={18} className="text-red-400" />
                                    <span className="text-red-400 font-black uppercase text-xs tracking-wider">ZONE À RISQUE</span>
                                </div>
                                <h4 className="text-2xl font-black text-white uppercase">{worstMap.name !== 'Aucune' ? worstMap.name : 'N/A'}</h4>
                                <p className="text-sm text-gray-400 font-mono mt-1">{worstMap.count} Games • <span className="text-red-400 font-bold">{worstMap.wr}% WR</span></p>
                            </div>
                            <div className="opacity-20 text-red-400">
                                <Skull size={64} />
                            </div>
                        </Card>
                    </div>
                </>
            )}
        </div>
    );
};