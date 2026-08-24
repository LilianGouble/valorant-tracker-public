import React, { useState, useCallback } from 'react';
import {
    Search, ShieldAlert, AlertTriangle, Crosshair, Swords,
    Trophy, EyeOff, Loader, Activity
} from 'lucide-react';
import { Card, SectionHeader } from '../components/UI';
import { getRankIcon, LOCAL_SERVER_URL } from '../config/constants';

const agentImg = (id) => id ? `https://media.valorant-api.com/agents/${id}/displayicon.png` : null;

const fmtDate = (iso) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

// Petite jauge horizontale colorée (pour visualiser HS%, précision…)
const Bar = ({ pct, color }) => (
    <div className="h-1.5 bg-white/5 rounded-full overflow-hidden w-full">
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, backgroundColor: color }} />
    </div>
);

// --- Analyse anti-cheat : privilégie le gros échantillon (deep) si disponible ---
const analyzeCheatSignals = (agg, matches, deep) => {
    // On raisonne sur l'échantillon le plus large possible.
    const sample = deep || agg;
    if (!sample || !sample.games) return [];
    const flags = [];
    const n = sample.games;

    // HS% moyen anormalement élevé
    if (sample.avgHs >= 40) flags.push({ level: 'high', text: `HS% moyen très élevé (${sample.avgHs}%) sur ${n} games — au-dessus du niveau pro (~30%).` });
    else if (sample.avgHs >= 30) flags.push({ level: 'mid', text: `HS% moyen élevé (${sample.avgHs}%) sur ${n} games — niveau pro, suspect selon le rang.` });

    // Régularité anormale du HS% (un humain varie ; un aimbot est constant).
    // Bien plus fiable sur 90 games que sur 10.
    if (n >= 20 && sample.hsStdev <= 4 && sample.avgHs >= 25) {
        flags.push({ level: 'high', text: `HS% anormalement régulier (écart-type ${sample.hsStdev} sur ${n} games) — la constance trahit un aimbot.` });
    }

    // Distribution : proportion de games à HS% très élevé (histogramme deep)
    if (deep?.hsBuckets) {
        const highGames = deep.hsBuckets[4] + deep.hsBuckets[5]; // 45%+
        const ratio = highGames / n;
        if (ratio >= 0.25) flags.push({ level: 'high', text: `${highGames} games sur ${n} (${Math.round(ratio * 100)}%) au-dessus de 45% HS — distribution très anormale.` });
        else if (highGames >= 2) flags.push({ level: 'mid', text: `${highGames} game(s) à 45%+ de HS sur ${n} — pics à surveiller.` });
    } else {
        const spikeGames = matches.filter(m => m.hsPct >= 55);
        if (spikeGames.length > 0) flags.push({ level: spikeGames.length >= 2 ? 'high' : 'mid', text: `${spikeGames.length} game(s) à 55%+ de HS (pic suspect).` });
    }

    // KD élevé combiné à un HS% élevé = double signal
    if (sample.avgKd >= 1.6 && sample.avgHs >= 30) {
        flags.push({ level: 'mid', text: `KD (${sample.avgKd}) et HS% (${sample.avgHs}%) tous deux très élevés sur ${n} games.` });
    }

    // First-bloods (uniquement dispo sur l'échantillon détaillé de 10)
    if (agg?.totalFirstBloods && agg.games) {
        const fbRate = agg.totalFirstBloods / agg.games;
        if (fbRate >= 4) flags.push({ level: 'mid', text: `Taux de first-blood élevé (${fbRate.toFixed(1)}/game sur les 10 dernières) — préfire/info suspecte.` });
    }

    if (flags.length === 0) flags.push({ level: 'ok', text: `Aucun signal statistique flagrant sur ${n} games. Profil de tir cohérent avec un humain.` });
    return flags;
};

// Histogramme de la distribution du HS% (visualise si un joueur est "trop souvent" haut).
const HsHistogram = ({ buckets, games }) => {
    const labels = ['<15%', '15-25', '25-35', '35-45', '45-55', '55%+'];
    const colors = ['#22d3ee', '#34d399', '#a3e635', '#facc15', '#fb923c', '#f87171'];
    const max = Math.max(...buckets, 1);
    return (
        <div>
            <div className="flex items-end gap-2 h-32">
                {buckets.map((b, i) => (
                    <div key={i} className="flex-1 flex flex-col items-center justify-end h-full">
                        <span className="text-[10px] font-black text-gray-400 mb-1">{b}</span>
                        <div className="w-full rounded-t" style={{ height: `${(b / max) * 100}%`, minHeight: b > 0 ? 4 : 0, backgroundColor: colors[i] }} />
                    </div>
                ))}
            </div>
            <div className="flex gap-2 mt-1.5">
                {labels.map((l, i) => <span key={i} className="flex-1 text-center text-[8px] font-bold text-gray-600">{l}</span>)}
            </div>
            <p className="text-[10px] text-gray-500 mt-2 text-center">Répartition du HS% sur {games} parties · <span className="text-red-400">les barres à droite = games suspectes</span></p>
        </div>
    );
};

const StatCol = ({ label, value, color = '#fff', sub }) => (
    <div className="text-center">
        <div className="text-[9px] font-black uppercase tracking-widest text-gray-500">{label}</div>
        <div className="text-lg font-black" style={{ color }}>{value}</div>
        {sub && <div className="text-[8px] text-gray-600 font-bold">{sub}</div>}
    </div>
);

export const Scout = () => {
    const [query, setQuery] = useState('');
    const [region, setRegion] = useState('eu');
    const [state, setState] = useState('idle'); // idle | loading | ok | error
    const [data, setData] = useState(null);
    const [errMsg, setErrMsg] = useState('');

    const search = useCallback(async (e) => {
        if (e) e.preventDefault();
        const parts = query.split('#');
        if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) {
            setState('error'); setErrMsg("Format attendu : Pseudo#Tag (ex: TenZ#SEN)"); return;
        }
        setState('loading'); setData(null); setErrMsg('');
        try {
            const url = `${LOCAL_SERVER_URL}/api/scout/${encodeURIComponent(parts[0].trim())}/${encodeURIComponent(parts[1].trim())}?region=${region}`;
            const res = await fetch(url);
            const json = await res.json();
            if (!res.ok) { setState('error'); setErrMsg(json.message || 'Erreur de recherche'); return; }
            setData(json); setState('ok');
        } catch {
            setState('error'); setErrMsg('Impossible de joindre le serveur.');
        }
    }, [query, region]);

    return (
        <div className="space-y-6">
            <SectionHeader icon={ShieldAlert} title="Scout / Anti-Cheat" accent="#ef4444"
                subtitle="Analyse publique des 10 dernières ranked de n'importe quel joueur." />

            {/* BARRE DE RECHERCHE */}
            <form onSubmit={search} className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-grow">
                    <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" />
                    <input
                        value={query} onChange={e => setQuery(e.target.value)}
                        placeholder="Pseudo#Tag  (ex: TenZ#SEN)"
                        className="w-full bg-[#0f1923] text-white pl-12 pr-4 py-3.5 rounded-xl border border-white/10 outline-none focus:border-[#ff4655] font-bold"
                    />
                </div>
                <select value={region} onChange={e => setRegion(e.target.value)}
                    className="bg-[#0f1923] text-white px-4 py-3.5 rounded-xl border border-white/10 outline-none focus:border-[#ff4655] font-bold uppercase text-sm cursor-pointer">
                    <option value="eu">EU</option><option value="na">NA</option><option value="ap">AP</option>
                    <option value="kr">KR</option><option value="latam">LATAM</option><option value="br">BR</option>
                </select>
                <button type="submit" disabled={state === 'loading'}
                    className="px-8 py-3.5 bg-gradient-to-r from-[#ff4655] to-[#d93442] text-white font-black uppercase tracking-wider rounded-xl hover:from-[#e03543] transition-all disabled:opacity-60 flex items-center justify-center gap-2">
                    {state === 'loading' ? <Loader size={18} className="animate-spin" /> : <Search size={18} />} Analyser
                </button>
            </form>

            {state === 'error' && (
                <div className="flex items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-300 font-bold">
                    <AlertTriangle size={20} /> {errMsg}
                </div>
            )}

            {state === 'idle' && (
                <div className="text-center py-16 text-gray-600">
                    <Crosshair size={48} className="mx-auto mb-4 opacity-40" />
                    <p className="font-bold">Entre un pseudo pour lancer l'analyse.</p>
                    <p className="text-xs mt-2 max-w-md mx-auto">Le "profil privé" de tracker.gg n'a aucun effet ici — seul le masquage Riot officiel limite l'historique.</p>
                </div>
            )}

            {state === 'ok' && data && <ScoutResult data={data} />}
        </div>
    );
};

const ScoutResult = ({ data }) => {
    const { account, mmr, matches, agg, deep, hidden, message } = data;
    const bannerUrl = account.card ? `https://media.valorant-api.com/playercards/${account.card}/wideart.png` : null;
    const flags = analyzeCheatSignals(agg, matches, deep);
    const hasHighFlag = flags.some(f => f.level === 'high');

    return (
        <div className="space-y-5">
            {/* CARTE D'IDENTITÉ */}
            <Card className="p-0 overflow-hidden">
                <div className="relative p-6">
                    {bannerUrl && <>
                        <img src={bannerUrl} alt="" className="absolute inset-0 w-full h-full object-cover opacity-30" />
                        <div className="absolute inset-0 bg-gradient-to-r from-[#1c252e] via-[#1c252e]/85 to-[#1c252e]/40" />
                    </>}
                    <div className="relative flex items-center gap-5 flex-wrap">
                        {mmr?.current && <img src={getRankIcon(mmr.current)} alt={mmr.current} className="w-16 h-16 object-contain" />}
                        <div className="flex-grow min-w-0">
                            <h1 className="text-3xl font-black text-white italic uppercase tracking-tighter">
                                {account.name} <span className="text-gray-500 text-lg not-italic">#{account.tag}</span>
                            </h1>
                            <div className="flex items-center gap-3 mt-1 flex-wrap text-sm">
                                {mmr?.current && <span className="font-bold text-[#ff4655]">{mmr.current} · {mmr.rr}RR</span>}
                                {mmr?.peak && <span className="text-yellow-500/80 font-bold flex items-center gap-1"><Trophy size={13} /> Peak {mmr.peak}</span>}
                                {account.level != null && <span className="text-gray-400 font-bold">Niveau {account.level}</span>}
                                <span className="text-gray-600 uppercase text-xs font-black">{account.region}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </Card>

            {hidden ? (
                <div className="flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-5 text-amber-200">
                    <EyeOff size={22} className="shrink-0" />
                    <div><div className="font-black uppercase text-sm text-amber-300">Historique masqué</div><p className="text-sm mt-1">{message}</p></div>
                </div>
            ) : (
                <>
                    {/* VERDICT ANTI-CHEAT */}
                    <Card className={`p-5 border ${hasHighFlag ? 'border-red-500/40' : 'border-white/5'}`}
                        style={hasHighFlag ? { boxShadow: '0 0 24px rgba(239,68,68,0.15)' } : {}}>
                        <h3 className="text-xs font-black uppercase tracking-widest text-gray-400 mb-4 flex items-center gap-2">
                            <ShieldAlert size={15} className={hasHighFlag ? 'text-red-400' : 'text-emerald-400'} /> Analyse statistique
                        </h3>
                        <div className="space-y-2">
                            {flags.map((f, i) => {
                                const c = f.level === 'high' ? 'text-red-300 bg-red-500/10 border-red-500/20'
                                    : f.level === 'mid' ? 'text-amber-300 bg-amber-500/10 border-amber-500/20'
                                    : 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20';
                                const Icon = f.level === 'ok' ? Activity : AlertTriangle;
                                return (
                                    <div key={i} className={`flex items-start gap-2.5 rounded-lg border p-3 text-sm font-medium ${c}`}>
                                        <Icon size={16} className="shrink-0 mt-0.5" /> {f.text}
                                    </div>
                                );
                            })}
                        </div>
                        {agg && (
                            <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mt-5 pt-4 border-t border-white/5">
                                <StatCol label="Winrate" value={`${Math.round((agg.wins / agg.games) * 100)}%`} color={agg.wins / agg.games >= 0.5 ? '#34d399' : '#f87171'} sub={`${agg.wins}/${agg.games}`} />
                                <StatCol label="K/D moy" value={agg.avgKd} color={agg.avgKd >= 1 ? '#fff' : '#9ca3af'} />
                                <StatCol label="ACS moy" value={agg.avgAcs} color="#22d3ee" />
                                <StatCol label="ADR moy" value={agg.avgAdr} color="#fff" />
                                <StatCol label="HS% moy" value={`${agg.avgHs}%`} color={agg.avgHs >= 30 ? '#f87171' : '#fff'} sub={`±${agg.hsStdev}`} />
                                <StatCol label="First bloods" value={agg.totalFirstBloods} color="#facc15" />
                            </div>
                        )}
                    </Card>

                    {/* ANALYSE PROFONDE (gros échantillon) */}
                    {deep && (
                        <Card className="p-5">
                            <h3 className="text-xs font-black uppercase tracking-widest text-gray-400 mb-4 flex items-center gap-2">
                                <Crosshair size={15} className="text-cyan-400" /> Analyse profonde — {deep.games} parties
                            </h3>
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                <HsHistogram buckets={deep.hsBuckets} games={deep.games} />
                                <div className="grid grid-cols-3 gap-3 content-center">
                                    <StatCol label="Winrate" value={`${Math.round((deep.wins / deep.games) * 100)}%`} color={deep.wins / deep.games >= 0.5 ? '#34d399' : '#f87171'} />
                                    <StatCol label="K/D moy" value={deep.avgKd} color={deep.avgKd >= 1 ? '#fff' : '#9ca3af'} />
                                    <StatCol label="ACS moy" value={deep.avgAcs} color="#22d3ee" />
                                    <StatCol label="HS% moy" value={`${deep.avgHs}%`} color={deep.avgHs >= 30 ? '#f87171' : '#fff'} sub={`±${deep.hsStdev}`} />
                                    <StatCol label="HS% max" value={`${deep.maxHs}%`} color={deep.maxHs >= 50 ? '#f87171' : '#facc15'} />
                                    <StatCol label="ADR moy" value={deep.avgAdr} color="#fff" />
                                </div>
                            </div>
                        </Card>
                    )}

                    {/* DÉTAIL DES 10 GAMES */}
                    <div>
                        <h3 className="text-xs font-black uppercase tracking-widest text-gray-400 mb-3 flex items-center gap-2">
                            <Swords size={14} /> 10 dernières compétitives — détail complet
                        </h3>
                        <div className="space-y-2">
                            {matches.map((m, i) => <ScoutMatchRow key={m.matchId || i} m={m} />)}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

const ScoutMatchRow = ({ m }) => {
    const border = m.won === true ? 'border-l-emerald-500' : m.won === false ? 'border-l-red-500' : 'border-l-gray-500';
    const hsColor = m.hsPct >= 40 ? '#f87171' : m.hsPct >= 28 ? '#facc15' : '#22d3ee';
    return (
        <div className={`bg-[#1c252e] border border-white/5 border-l-4 ${border} rounded-xl p-3`}>
            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                {/* Agent + map */}
                <div className="flex items-center gap-3 lg:w-56 shrink-0">
                    {m.agentId ? <img src={agentImg(m.agentId)} alt={m.agent} className="w-11 h-11 rounded-lg bg-black object-cover border border-white/10" /> : <div className="w-11 h-11 rounded-lg bg-white/5" />}
                    <div className="min-w-0">
                        <div className="font-black text-white text-sm truncate">{m.agent}</div>
                        <div className="text-[10px] text-gray-500 font-bold">{m.map} · {m.score || '—'}</div>
                        <div className="text-[9px] text-gray-600">{fmtDate(m.date)}</div>
                    </div>
                </div>

                {/* Stats principales */}
                <div className="grid grid-cols-4 sm:grid-cols-7 gap-2 flex-grow items-center">
                    <StatCol label="KDA" value={m.kda} color="#fff" />
                    <StatCol label="K/D" value={m.kd} color={m.kd >= 1 ? '#34d399' : '#f87171'} />
                    <StatCol label="ACS" value={m.acs} color="#22d3ee" />
                    <StatCol label="ADR" value={m.adr} color="#fff" sub={`${m.adrReceived} subi`} />
                    <div className="text-center">
                        <div className="text-[9px] font-black uppercase tracking-widest text-gray-500">HS%</div>
                        <div className="text-lg font-black" style={{ color: hsColor }}>{m.hsPct}%</div>
                        <div className="mt-1"><Bar pct={m.hsPct} color={hsColor} /></div>
                    </div>
                    <StatCol label="First B." value={`${m.firstBloods}/${m.firstDeaths}`} color="#facc15" sub="FB/FD" />
                    <div className="text-center">
                        <div className="text-[9px] font-black uppercase tracking-widest text-gray-500">Arme +</div>
                        <div className="text-xs font-black text-gray-200 truncate">{m.topWeapon || '—'}</div>
                        {m.fastestKillMs != null && <div className="text-[8px] text-gray-600">kill le + rapide {(m.fastestKillMs / 1000).toFixed(1)}s</div>}
                    </div>
                </div>
            </div>
            {/* Répartition tirs */}
            <div className="flex items-center gap-4 mt-2 pt-2 border-t border-white/5 text-[10px] font-bold text-gray-500">
                <span className="text-red-400">Tête {m.hs}</span>
                <span className="text-gray-400">Corps {m.body}</span>
                <span className="text-gray-600">Jambes {m.leg}</span>
                <span className="ml-auto">{m.rounds} rounds</span>
            </div>
        </div>
    );
};
