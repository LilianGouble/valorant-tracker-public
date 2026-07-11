import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
    Radio, Swords, Trophy, Flame, Snowflake, Moon, Wifi, WifiOff,
    Gamepad2, TrendingUp, TrendingDown, Clock, RefreshCw, AlertTriangle, ServerCrash,
    Tv, Crown, ShoppingBag
} from 'lucide-react';
import { Card, SectionHeader } from '../components/UI';
import { getRankIcon } from '../config/constants';
import { LOCAL_SERVER_URL } from '../config/constants';

const POLL_MS = 30000;

const agoLabel = (min) => {
    if (min === null || min === undefined) return '—';
    if (min < 1) return "à l'instant";
    if (min < 60) return `il y a ${min} min`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `il y a ${h}h${m > 0 ? String(m).padStart(2, '0') : ''}`;
};

// Pastille de statut : en game / actif / hors-ligne
const StatusDot = ({ session }) => {
    if (session.likelyInGame) {
        return (
            <span className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-red-400">
                <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
                </span>
                En game
            </span>
        );
    }
    if (session.active) {
        return (
            <span className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-emerald-400">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
                Actif
            </span>
        );
    }
    return (
        <span className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-gray-600">
            <span className="w-2.5 h-2.5 rounded-full bg-gray-700"></span>
            Hors-ligne
        </span>
    );
};

const PlayerLiveCard = ({ s }) => {
    const positive = s.sessionRR >= 0;
    const dimmed = !s.playedTonight;
    return (
        <Card
            className={`p-4 relative overflow-hidden transition-all ${dimmed ? 'opacity-50' : ''} ${s.likelyInGame ? 'border-red-500/40' : 'border-white/5'}`}
            style={s.likelyInGame ? { boxShadow: '0 0 24px rgba(239,68,68,0.18)' } : {}}
        >
            {/* liseré couleur joueur */}
            <div className="absolute left-0 top-0 bottom-0 w-1" style={{ backgroundColor: s.color || '#555' }} />

            <div className="flex items-center justify-between mb-3 pl-1">
                <div className="flex items-center gap-2.5 min-w-0">
                    {s.rank ? (
                        <img src={getRankIcon(s.rank)} alt={s.rank} className="w-9 h-9 object-contain shrink-0" />
                    ) : (
                        <div className="w-9 h-9 rounded-lg bg-white/5 shrink-0" />
                    )}
                    <div className="min-w-0">
                        <div className="font-black text-white truncate leading-none">{s.name}</div>
                        <div className="text-[10px] text-gray-500 font-bold mt-0.5">{s.rank || 'Non classé'} · {s.rr ?? '—'}RR</div>
                        {s.peak?.tier && (
                            <div className="text-[9px] text-gray-600 font-bold mt-0.5 flex items-center gap-1" title={`Peak : ${s.peak.tier} (${s.peak.season || '?'})`}>
                                <Trophy size={9} className="text-yellow-500/70" /> Peak {s.peak.tier}
                            </div>
                        )}
                    </div>
                </div>
                <StatusDot session={s} />
            </div>

            {s.playedTonight ? (
                <>
                    <div className="flex items-end justify-between pl-1">
                        <div>
                            <div className="text-[9px] font-black uppercase tracking-widest text-gray-500">RR ce soir</div>
                            <div className={`text-2xl font-black italic leading-none ${positive ? 'text-emerald-400' : 'text-red-400'}`}>
                                {positive ? '+' : ''}{s.sessionRR}
                            </div>
                        </div>
                        <div className="text-right">
                            <div className="flex items-center gap-2 justify-end text-xs font-bold">
                                <span className="text-emerald-400">{s.wins}V</span>
                                <span className="text-red-400">{s.losses}D</span>
                            </div>
                            {s.streak >= 2 && (
                                <div className={`text-[10px] font-black mt-1 flex items-center gap-1 justify-end ${s.streakType === 'W' ? 'text-orange-400' : 'text-blue-400'}`}>
                                    {s.streakType === 'W' ? <><Flame size={11} /> {s.streak} d'affilée</> : <><Snowflake size={11} /> {s.streak} d'affilée</>}
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="flex items-center gap-1.5 mt-3 pt-2 border-t border-white/5 pl-1 text-[10px] font-bold text-gray-500">
                        <Clock size={11} /> Dernière game {agoLabel(s.minSinceLast)}
                        {s.likelyInGame && <span className="text-red-400 ml-auto">· peut-être en partie</span>}
                    </div>
                </>
            ) : (
                <div className="text-center py-3 text-gray-600 text-xs italic pl-1 flex items-center justify-center gap-2">
                    <Moon size={14} /> Pas encore joué ce soir
                </div>
            )}
        </Card>
    );
};

export const LiveNight = () => {
    const [data, setData] = useState(null);
    const [status, setStatus] = useState('loading'); // loading | ok | error
    const [lastUpdate, setLastUpdate] = useState(null);
    const [context, setContext] = useState(null); // esports + ladder (cache serveur)
    const timerRef = useRef(null);

    const fetchSession = useCallback(async () => {
        try {
            const res = await fetch(`${LOCAL_SERVER_URL}/api/live/session`);
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const json = await res.json();
            setData(json);
            setStatus('ok');
            setLastUpdate(Date.now());
        } catch {
            setStatus('error');
        }
    }, []);

    useEffect(() => {
        fetchSession();
        timerRef.current = setInterval(fetchSession, POLL_MS);
        return () => clearInterval(timerRef.current);
    }, [fetchSession]);

    // Contexte esport/ladder : une seule fois (le serveur le cache 15 min).
    useEffect(() => {
        fetch(`${LOCAL_SERVER_URL}/api/live/context`)
            .then(r => r.ok ? r.json() : null)
            .then(j => j && setContext(j))
            .catch(() => {});
    }, []);

    if (status === 'loading' && !data) {
        return (
            <div className="flex items-center gap-3 text-gray-400 p-8">
                <RefreshCw className="animate-spin" size={18} /> Connexion à la session en direct...
            </div>
        );
    }

    if (status === 'error' && !data) {
        return (
            <div className="flex flex-col items-center justify-center py-24 text-center">
                <WifiOff size={48} className="text-gray-600 mb-4" />
                <h2 className="text-xl font-black text-white uppercase">Hors-ligne</h2>
                <p className="text-gray-500 text-sm mt-2">Impossible de joindre le serveur de session.</p>
            </div>
        );
    }

    const { collective, activeCount, sessions, recentGames = [], riotStatus } = data;
    const riotIssues = riotStatus ? [...(riotStatus.incidents || []), ...(riotStatus.maintenances || [])] : [];
    const positive = collective.rr >= 0;
    const inGameCount = sessions.filter(s => s.likelyInGame).length;
    const anyoneOnline = activeCount > 0;

    return (
        <div className="space-y-6">
            <SectionHeader
                icon={Radio}
                title="Soirée en direct"
                subtitle={anyoneOnline ? `${activeCount} joueur(s) en ligne · ${inGameCount} potentiellement en partie` : "Personne en ligne pour le moment"}
                accent="#ef4444"
                action={
                    <div className="flex items-center gap-2 text-[10px] font-bold text-gray-500">
                        {status === 'ok' ? <Wifi size={13} className="text-emerald-400" /> : <WifiOff size={13} className="text-red-400" />}
                        {lastUpdate && <span>maj {new Date(lastUpdate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>}
                    </div>
                }
            />

            {/* ALERTE SERVEURS RIOT */}
            {riotIssues.length > 0 && (
                <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5">
                    <ServerCrash size={20} className="text-amber-400 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                        <div className="text-xs font-black uppercase tracking-wider text-amber-300 flex items-center gap-1.5">
                            <AlertTriangle size={12} /> Serveurs Riot perturbés
                        </div>
                        <ul className="mt-1 space-y-0.5">
                            {riotIssues.slice(0, 3).map((iss, i) => (
                                <li key={i} className="text-[11px] text-amber-200/80 font-medium truncate">• {iss.title}</li>
                            ))}
                        </ul>
                    </div>
                </div>
            )}

            {/* BANNIÈRE COLLECTIVE */}
            <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-[#1c252e] to-[#0f1923] p-5 sm:p-6">
                <div className={`absolute -top-20 -right-12 w-72 h-72 rounded-full blur-[110px] opacity-25 ${anyoneOnline ? (positive ? 'bg-emerald-500' : 'bg-red-500') : 'bg-gray-600'}`} />
                <div className="relative flex flex-col sm:flex-row sm:items-center gap-5">
                    <div className="shrink-0">
                        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 mb-1 flex items-center gap-1.5">
                            <Gamepad2 size={12} /> Bilan collectif de la soirée
                        </div>
                        <div className="flex items-end gap-3">
                            <div className={`text-5xl font-black italic tracking-tighter leading-none ${positive ? 'text-emerald-400' : 'text-red-400'}`}>
                                {positive ? '+' : ''}{collective.rr}
                            </div>
                            <div className="text-sm font-black text-gray-500 uppercase mb-1.5">RR</div>
                        </div>
                        <div className="flex items-center gap-3 mt-2 text-xs font-bold">
                            <span className="text-gray-300 flex items-center gap-1"><Swords size={12} /> {collective.games} games</span>
                            <span className="text-gray-600">·</span>
                            <span className="text-emerald-400">{collective.wins}V</span>
                            <span className="text-red-400">{collective.losses}D</span>
                        </div>
                    </div>
                    <div className="hidden sm:block w-px self-stretch bg-white/10" />
                    <div className="flex-grow flex items-center gap-2">
                        {positive ? <TrendingUp size={18} className="text-emerald-400" /> : <TrendingDown size={18} className="text-red-400" />}
                        <p className="text-sm text-gray-300 font-medium">
                            {!anyoneOnline
                                ? "La nuit est calme. Reviens quand l'escouade lance des parties !"
                                : inGameCount > 0
                                    ? `${inGameCount} membre(s) sont probablement en pleine game. Ça se joue maintenant.`
                                    : positive
                                        ? "L'escouade carbure ce soir, le RR grimpe."
                                        : "Soirée compliquée... il est temps de remonter la pente."}
                        </p>
                    </div>
                </div>
            </div>

            {/* GRILLE DES JOUEURS */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {sessions.map(s => <PlayerLiveCard key={s.id} s={s} />)}
            </div>

            {/* FEED D'ACTIVITÉ (dernières 24h) */}
            {recentGames.length > 0 && (
                <Card className="p-4 sm:p-5">
                    <h3 className="text-xs font-black uppercase tracking-widest text-gray-400 mb-4 flex items-center gap-2">
                        <Radio size={14} className="text-red-400" /> Fil d'activité
                        <span className="text-gray-600 normal-case tracking-normal font-bold">— dernières 24h</span>
                    </h3>
                    <div className="relative pl-4 space-y-3">
                        {/* ligne verticale de timeline */}
                        <div className="absolute left-[5px] top-1 bottom-1 w-px bg-white/10" />
                        {recentGames.map(g => {
                            const win = g.result === 'WIN';
                            const timeStr = new Date(g.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                            return (
                                <div key={g.matchId} className="relative">
                                    <span className={`absolute -left-[15px] top-1.5 w-2.5 h-2.5 rounded-full border-2 border-[#1c252e] ${win ? 'bg-emerald-400' : 'bg-red-400'}`} />
                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                                        <span className="text-[10px] font-mono font-bold text-gray-500 w-10 shrink-0">{timeStr}</span>
                                        <span className={`text-xs font-black uppercase ${win ? 'text-emerald-400' : 'text-red-400'}`}>
                                            {win ? 'Victoire' : 'Défaite'}
                                        </span>
                                        <span className="text-xs font-bold text-white uppercase">{g.map}</span>
                                        {g.score && <span className="text-[10px] font-mono text-gray-400">{g.score}</span>}
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                            {g.players.map((p, i) => (
                                                <span key={i} className="flex items-center gap-1 bg-white/5 border border-white/5 rounded-full pl-1 pr-2 py-0.5"
                                                    title={`${p.name} (${p.agent}) ${p.kills}/${p.deaths}`}>
                                                    {p.agentImg
                                                        ? <img src={p.agentImg} alt={p.agent} className="w-4 h-4 rounded-full bg-black object-cover" />
                                                        : <span className="w-4 h-4 rounded-full bg-white/10" />}
                                                    <span className="text-[10px] font-bold" style={{ color: p.color }}>{p.name}</span>
                                                    <span className={`text-[9px] font-black ${p.rr >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                                        {p.rr > 0 ? '+' : ''}{p.rr}
                                                    </span>
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </Card>
            )}

            {/* CONTEXTE ESPORT + LADDER */}
            {context && (context.esports?.length > 0 || context.ladder?.top?.length > 0) && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {context.esports?.length > 0 && (
                        <Card className="p-4 sm:p-5">
                            <h3 className="text-xs font-black uppercase tracking-widest text-gray-400 mb-3 flex items-center gap-2">
                                <Tv size={14} className="text-red-400" /> Matchs pro à venir
                            </h3>
                            <div className="space-y-2">
                                {context.esports.map((m, i) => (
                                    <div key={i} className="flex items-center justify-between gap-2 bg-black/20 border border-white/5 rounded-lg p-2">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <div className="flex items-center gap-1.5 font-black text-white text-sm">
                                                {m.teams[0].icon && <img src={m.teams[0].icon} alt="" className="w-5 h-5 object-contain" />}
                                                {m.teams[0].code || m.teams[0].name}
                                            </div>
                                            <span className="text-gray-600 text-[10px] font-bold">vs</span>
                                            <div className="flex items-center gap-1.5 font-black text-white text-sm">
                                                {m.teams[1].icon && <img src={m.teams[1].icon} alt="" className="w-5 h-5 object-contain" />}
                                                {m.teams[1].code || m.teams[1].name}
                                            </div>
                                        </div>
                                        <span className="text-[9px] text-gray-500 font-bold uppercase shrink-0 truncate max-w-[120px]">{m.league}</span>
                                    </div>
                                ))}
                            </div>
                        </Card>
                    )}
                    {context.ladder?.top?.length > 0 && (
                        <Card className="p-4 sm:p-5">
                            <h3 className="text-xs font-black uppercase tracking-widest text-gray-400 mb-3 flex items-center gap-2">
                                <Crown size={14} className="text-yellow-400" /> Sommet du ladder {context.ladder.region}
                            </h3>
                            <div className="space-y-2">
                                {context.ladder.top.map((p, i) => (
                                    <div key={i} className="flex items-center justify-between bg-black/20 border border-white/5 rounded-lg p-2">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <span className={`text-sm font-black w-5 ${i === 0 ? 'text-yellow-400' : 'text-gray-500'}`}>#{p.rank ?? i + 1}</span>
                                            <span className="font-bold text-white truncate">{p.name}<span className="text-gray-600 text-xs">#{p.tag}</span></span>
                                        </div>
                                        <span className="text-xs font-black text-cyan-400 shrink-0">{p.rr} RR</span>
                                    </div>
                                ))}
                            </div>
                        </Card>
                    )}
                </div>
            )}

            {/* BOUTIQUE DU JOUR */}
            {context?.store?.length > 0 && (
                <Card className="p-4 sm:p-5">
                    <h3 className="text-xs font-black uppercase tracking-widest text-gray-400 mb-3 flex items-center gap-2">
                        <ShoppingBag size={14} className="text-pink-400" /> Boutique du jour
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {context.store.map((bundle, bi) => (
                            <div key={bi} className="bg-black/20 border border-white/5 rounded-xl p-3">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Bundle {bi + 1}</span>
                                    {bundle.price != null && (
                                        <span className="text-xs font-black text-pink-300 flex items-center gap-1">
                                            {bundle.price} <span className="text-[9px] text-gray-500">VP</span>
                                        </span>
                                    )}
                                </div>
                                <div className="grid grid-cols-4 gap-2">
                                    {bundle.items.map((it, ii) => (
                                        <div key={ii} className="aspect-square bg-white/5 rounded-lg flex items-center justify-center p-1" title={`${it.name} (${it.type})`}>
                                            {it.image
                                                ? <img src={it.image} alt={it.name} className="max-w-full max-h-full object-contain" />
                                                : <span className="text-[8px] text-gray-600 text-center">{it.name}</span>}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </Card>
            )}

            <p className="text-center text-[10px] text-gray-600 font-bold">
                Mise à jour automatique toutes les 30s · Le statut "en game" est une estimation basée sur l'heure de la dernière partie.
            </p>
        </div>
    );
};
