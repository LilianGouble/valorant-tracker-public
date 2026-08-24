import React, { useState, useMemo } from 'react';
import {
    Wrench, Crosshair, Target, Zap, ArrowUp, ArrowDown, Check,
    RotateCcw, TrendingUp, Info, Trophy
} from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ReferenceDot } from 'recharts';
import { Card, SectionHeader } from '../components/UI';
import {
    createSession, addTrial, nextSens, bestTrial, perfScore, edpi, edpiCategory, EDPI_REFERENCES
} from '../utils/sensOptimizer';

const LS_KEY = 'sensOptimizerSession';

const SensOptimizer = () => {
    // Configuration
    const [dpi, setDpi] = useState(() => Number(localStorage.getItem('sensDpi')) || 800);
    const [startSens, setStartSens] = useState('');
    const [session, setSession] = useState(() => {
        try { const raw = localStorage.getItem(LS_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
    });

    // Saisie de la manche courante
    const [kills, setKills] = useState('');
    const [timeSec, setTimeSec] = useState('');

    const persist = (s) => {
        setSession(s);
        if (s) localStorage.setItem(LS_KEY, JSON.stringify(s)); else localStorage.removeItem(LS_KEY);
    };

    const reco = useMemo(() => session ? nextSens(session) : null, [session]);
    const best = useMemo(() => session ? bestTrial(session) : null, [session]);

    const start = () => {
        const s = Number(startSens);
        if (!s || s <= 0) return;
        localStorage.setItem('sensDpi', String(dpi));
        persist(createSession(s));
        setKills(''); setTimeSec('');
    };

    const submitRound = () => {
        if (!session || !reco || reco.done) return;
        const k = Number(kills), t = Number(timeSec);
        if (isNaN(k) || isNaN(t) || t <= 0) return;
        persist(addTrial(session, { sens: reco.sens, kills: k, timeSec: t }));
        setKills(''); setTimeSec('');
    };

    const reset = () => { persist(null); setStartSens(''); setKills(''); setTimeSec(''); };

    // Données du graphe (score par sens, trié par sens)
    const chartData = useMemo(() => {
        if (!session) return [];
        return [...session.trials]
            .map(t => ({ sens: t.sens, score: +(t.score * 100).toFixed(1), kills: t.kills, timeSec: t.timeSec }))
            .sort((a, b) => a.sens - b.sens);
    }, [session]);

    // --- Écran de configuration initiale ---
    if (!session) {
        return (
            <Card className="p-6 max-w-xl">
                <h3 className="text-lg font-black text-white uppercase flex items-center gap-2 mb-1">
                    <Crosshair size={20} className="text-[#ff4655]" /> Optimiseur de sensibilité
                </h3>
                <p className="text-sm text-gray-400 mb-5">
                    Trouve ta sens idéale en quelques manches à <strong className="text-white">The Range (Difficulté Hard, 30 bots)</strong>.
                    L'algorithme adapte la sens à tester selon tes résultats et converge vers ton optimum.
                </p>
                <div className="grid grid-cols-2 gap-4 mb-5">
                    <div>
                        <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-1 block">DPI souris</label>
                        <input type="number" value={dpi} onChange={e => setDpi(Number(e.target.value))}
                            className="w-full bg-[#0f1923] text-white p-3 rounded-lg border border-white/10 outline-none focus:border-[#ff4655] font-bold" />
                    </div>
                    <div>
                        <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-1 block">Sens Valorant actuelle</label>
                        <input type="number" step="0.001" value={startSens} onChange={e => setStartSens(e.target.value)} placeholder="0.40"
                            className="w-full bg-[#0f1923] text-white p-3 rounded-lg border border-white/10 outline-none focus:border-[#ff4655] font-bold" />
                    </div>
                </div>
                {startSens && Number(startSens) > 0 && (
                    <div className="text-xs text-gray-400 mb-4 bg-black/20 rounded-lg p-3">
                        eDPI de départ : <strong className="text-cyan-400">{edpi(startSens, dpi)}</strong> — {edpiCategory(edpi(startSens, dpi))}
                    </div>
                )}
                <button onClick={start} disabled={!startSens || Number(startSens) <= 0}
                    className="w-full bg-gradient-to-r from-[#ff4655] to-[#d93442] text-white font-black uppercase tracking-wider py-3 rounded-xl hover:from-[#e03543] transition-all disabled:opacity-40">
                    Démarrer l'optimisation
                </button>
            </Card>
        );
    }

    const currentEdpi = reco ? edpi(reco.sens, dpi) : 0;
    const bestEdpi = best ? edpi(best.sens, dpi) : 0;

    return (
        <div className="space-y-5">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                {/* PANNEAU D'ACTION */}
                <Card className="lg:col-span-1 p-5">
                    {reco?.done ? (
                        <div className="text-center py-4">
                            <Trophy size={40} className="text-yellow-400 mx-auto mb-3" />
                            <div className="text-[10px] font-black uppercase tracking-widest text-gray-500">Sens optimale</div>
                            <div className="text-5xl font-black text-emerald-400 my-2">{best?.sens}</div>
                            <div className="text-xs text-gray-400">eDPI {bestEdpi} · {edpiCategory(bestEdpi)}</div>
                            <p className="text-xs text-gray-500 mt-3 italic">{reco.reason}</p>
                            <button onClick={reset} className="mt-5 flex items-center gap-2 mx-auto px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-xs font-bold text-gray-300">
                                <RotateCcw size={14} /> Nouvelle optimisation
                            </button>
                        </div>
                    ) : (
                        <>
                            <div className="flex items-center justify-between mb-3">
                                <h3 className="text-xs font-black uppercase tracking-widest text-gray-400 flex items-center gap-2">
                                    <Target size={14} className="text-[#ff4655]" /> Manche {session.trials.length + 1}
                                </h3>
                                <button onClick={reset} title="Recommencer" className="text-gray-600 hover:text-white"><RotateCcw size={14} /></button>
                            </div>

                            {/* Sens à tester */}
                            <div className="bg-black/30 rounded-xl p-4 mb-4 text-center border border-[#ff4655]/20">
                                <div className="text-[10px] font-black uppercase tracking-widest text-gray-500">Règle ta sens sur</div>
                                <div className="text-4xl font-black text-white my-1">{reco?.sens}</div>
                                <div className="text-[10px] text-cyan-400 font-bold">eDPI {currentEdpi}</div>
                                {best && (
                                    <div className="mt-2 text-[10px] font-bold flex items-center justify-center gap-1">
                                        {reco.sens > best.sens
                                            ? <span className="text-orange-400"><ArrowUp size={11} className="inline" /> plus haut que ton meilleur ({best.sens})</span>
                                            : reco.sens < best.sens
                                                ? <span className="text-blue-400"><ArrowDown size={11} className="inline" /> plus bas que ton meilleur ({best.sens})</span>
                                                : <span className="text-emerald-400">= ton meilleur</span>}
                                    </div>
                                )}
                            </div>
                            <p className="text-[11px] text-gray-500 mb-4 flex items-start gap-1.5">
                                <Info size={13} className="shrink-0 mt-0.5" /> {reco?.reason}
                            </p>

                            {/* Saisie du résultat */}
                            <div className="space-y-3">
                                <div>
                                    <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-1 block">Bots tués (/30)</label>
                                    <input type="number" min="0" max="30" value={kills} onChange={e => setKills(e.target.value)} placeholder="30"
                                        className="w-full bg-[#0f1923] text-white p-2.5 rounded-lg border border-white/10 outline-none focus:border-[#ff4655] font-bold" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-1 block">Temps (secondes)</label>
                                    <input type="number" step="0.1" min="0" value={timeSec} onChange={e => setTimeSec(e.target.value)} placeholder="30.5"
                                        className="w-full bg-[#0f1923] text-white p-2.5 rounded-lg border border-white/10 outline-none focus:border-[#ff4655] font-bold" />
                                </div>
                                {kills && timeSec && Number(timeSec) > 0 && (
                                    <div className="text-[10px] text-gray-500 text-center">Score de cette manche : <strong className="text-white">{(perfScore({ kills: Number(kills), timeSec: Number(timeSec) }) * 100).toFixed(0)}</strong>/100</div>
                                )}
                                <button onClick={submitRound} disabled={!kills || !timeSec || Number(timeSec) <= 0}
                                    className="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-black uppercase tracking-wider py-2.5 rounded-xl transition-colors disabled:opacity-40 flex items-center justify-center gap-2">
                                    <Check size={16} /> Valider & manche suivante
                                </button>
                            </div>
                        </>
                    )}
                </Card>

                {/* GRAPHE + HISTORIQUE */}
                <Card className="lg:col-span-2 p-5">
                    <h3 className="text-xs font-black uppercase tracking-widest text-gray-400 mb-4 flex items-center gap-2">
                        <TrendingUp size={14} className="text-cyan-400" /> Performance par sensibilité
                    </h3>
                    {chartData.length >= 2 ? (
                        <div className="h-56">
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={chartData} margin={{ left: -10, right: 10, top: 5, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                                    <XAxis dataKey="sens" type="number" domain={['dataMin', 'dataMax']} tick={{ fill: '#6b7280', fontSize: 10 }} stroke="#ffffff10" />
                                    <YAxis domain={[0, 110]} tick={{ fill: '#6b7280', fontSize: 10 }} stroke="#ffffff10" />
                                    <RechartsTooltip
                                        contentStyle={{ backgroundColor: '#1c252e', border: '1px solid #ffffff15', borderRadius: 8, fontSize: 12 }}
                                        formatter={(v, n) => n === 'score' ? [`${v}/100`, 'Score'] : [v, n]}
                                        labelFormatter={(l) => `Sens ${l}`} />
                                    <Line type="monotone" dataKey="score" stroke="#22d3ee" strokeWidth={2.5} dot={{ r: 4, fill: '#22d3ee' }} />
                                    {best && <ReferenceDot x={best.sens} y={+(best.score * 100).toFixed(1)} r={6} fill="#facc15" stroke="#fff" strokeWidth={2} />}
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    ) : (
                        <div className="h-56 flex items-center justify-center text-gray-600 text-sm italic">Fais au moins 2 manches pour voir la courbe.</div>
                    )}

                    {/* Historique */}
                    {session.trials.length > 0 && (
                        <div className="mt-4 space-y-1.5 max-h-40 overflow-y-auto custom-scrollbar">
                            {[...session.trials].reverse().map((t, i) => {
                                const isBest = best && t.sens === best.sens && t.score === best.score;
                                return (
                                    <div key={i} className={`flex items-center justify-between text-xs rounded-lg px-3 py-2 ${isBest ? 'bg-yellow-500/10 border border-yellow-500/20' : 'bg-black/20'}`}>
                                        <span className="font-black text-white">{t.sens} {isBest && <Trophy size={11} className="inline text-yellow-400 ml-1" />}</span>
                                        <span className="text-gray-400 font-mono">{t.kills}/30 · {t.timeSec}s</span>
                                        <span className={`font-black ${t.score >= 0.85 ? 'text-emerald-400' : 'text-gray-400'}`}>{(t.score * 100).toFixed(0)}</span>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </Card>
            </div>

            {/* Repères eDPI */}
            <Card className="p-5">
                <h3 className="text-xs font-black uppercase tracking-widest text-gray-400 mb-3 flex items-center gap-2">
                    <Zap size={14} className="text-yellow-400" /> Repères eDPI (sens × DPI)
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                    {EDPI_REFERENCES.map(r => {
                        const inRange = bestEdpi >= r.min && bestEdpi < r.max;
                        return (
                            <div key={r.label} className={`rounded-lg p-2.5 border text-center ${inRange ? 'border-cyan-400 bg-cyan-500/10' : 'border-white/5 bg-black/20'}`}>
                                <div className="text-sm font-black text-white">{r.min}–{r.max}</div>
                                <div className="text-[9px] text-gray-500 leading-tight mt-1">{r.label}</div>
                            </div>
                        );
                    })}
                </div>
            </Card>
        </div>
    );
};

export const Utilities = () => {
    return (
        <div className="space-y-6">
            <SectionHeader icon={Wrench} title="Utilitaires" accent="#22d3ee"
                subtitle="Outils pratiques pour progresser — à commencer par l'optimiseur de sensibilité." />
            <SensOptimizer />
        </div>
    );
};
