import React, { useMemo } from 'react';
import {
    Trophy, Skull, Target, TrendingUp, TrendingDown, Award, Flame,
    Crosshair, Swords, Lock, MapPin, User, IdCard
} from 'lucide-react';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer
} from 'recharts';
import { Card, StatPill } from '../components/UI';
import { computeBadges, TIERS } from '../utils/achievements';
import { getRankIcon, LOCAL_SERVER_URL } from '../config/constants';

const BadgeChip = ({ badge }) => {
    const tier = TIERS[badge.tier] || TIERS.bronze;
    const locked = !badge.unlocked;
    return (
        <div
            className={`relative rounded-xl p-3 border transition-all group ${locked ? 'bg-black/20 border-white/5 opacity-60' : 'bg-gradient-to-br from-white/5 to-black/30'}`}
            style={!locked ? { borderColor: tier.ring, boxShadow: `0 0 18px ${tier.glow}` } : {}}
            title={badge.desc}
        >
            <div className="flex items-center gap-2.5">
                <div className="text-2xl leading-none relative">
                    <span className={locked ? 'grayscale opacity-50' : ''}>{badge.icon}</span>
                    {locked && <Lock size={11} className="absolute -bottom-1 -right-1 text-gray-400" />}
                </div>
                <div className="min-w-0 flex-grow">
                    <div className={`text-sm font-black leading-none truncate ${locked ? 'text-gray-400' : 'text-white'}`}>
                        {badge.title}
                    </div>
                    <div className="text-[10px] text-gray-500 font-bold mt-0.5">{badge.valueLabel}</div>
                </div>
            </div>
            {/* Barre de progression pour les badges non débloqués */}
            {locked && badge.progress > 0 && (
                <div className="mt-2 h-1 bg-white/5 rounded-full overflow-hidden">
                    <div className="h-full bg-gray-500" style={{ width: `${Math.round(badge.progress * 100)}%` }} />
                </div>
            )}
        </div>
    );
};

export const PlayerProfile = ({ matches, selectedPlayerId, playersConfig, onSelectPlayer }) => {
    const cfg = playersConfig.find(p => p.id === selectedPlayerId);

    // Vue globale : on propose une grille de sélection de joueur plutôt qu'un cul-de-sac.
    const pickerData = useMemo(() => {
        if (cfg) return null;
        return playersConfig.map(p => {
            const mine = matches.filter(m => m.playerId === p.id && m.type === 'ranked');
            const wins = mine.filter(m => m.result === 'WIN').length;
            return {
                ...p,
                games: mine.length,
                winrate: mine.length > 0 ? Math.round((wins / mine.length) * 100) : 0,
            };
        }).sort((a, b) => b.games - a.games);
    }, [cfg, matches, playersConfig]);

    const profile = useMemo(() => {
        if (!cfg) return null;

        // matches est déjà filtré sur le joueur quand selectedPlayerId !== 'all',
        // mais on re-sécurise au cas où on serait en vue globale.
        const mine = matches.filter(m => m.playerId === cfg.id);
        const { badges, stats } = computeBadges(mine);

        const ranked = mine.filter(m => m.type === 'ranked').sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

        // Courbe de RR cumulé
        let cumRR = 0;
        const rrCurve = ranked
            .filter(m => m.rrChange !== undefined && m.rrChange !== null)
            .map((m, i) => {
                cumRR += (m.rrChange || 0);
                return { game: i + 1, rr: cumRR };
            });

        // Rang actuel : v3/mmr (fiable, temps réel) en priorité, sinon dernier match.
        const lastRanked = [...ranked].reverse().find(m => m.currentRank);
        const rank = cfg.mmr?.current?.tier
            ? { name: cfg.mmr.current.tier, rr: cfg.mmr.current.rr }
            : (lastRanked ? { name: lastRanked.currentRank, rr: lastRanked.currentRR } : null);
        const peak = cfg.mmr?.peak?.tier ? cfg.mmr.peak : null;
        const seasonal = (cfg.mmr?.seasonal || []).filter(s => s.tier);

        // Agents fétiches
        const agentMap = {};
        ranked.forEach(m => {
            const key = m.agent || '?';
            if (!agentMap[key]) agentMap[key] = { name: key, img: m.agentImg, games: 0, wins: 0 };
            agentMap[key].games++;
            if (m.result === 'WIN') agentMap[key].wins++;
        });
        const topAgents = Object.values(agentMap).sort((a, b) => b.games - a.games).slice(0, 3);

        // Map forte / faible (min 3 games)
        const mapMap = {};
        ranked.forEach(m => {
            const key = m.map || '?';
            if (!mapMap[key]) mapMap[key] = { name: key, games: 0, wins: 0 };
            mapMap[key].games++;
            if (m.result === 'WIN') mapMap[key].wins++;
        });
        const mapsRanked = Object.values(mapMap)
            .filter(x => x.games >= 3)
            .map(x => ({ ...x, wr: Math.round((x.wins / x.games) * 100) }))
            .sort((a, b) => b.wr - a.wr);
        const bestMap = mapsRanked[0] || null;
        const worstMap = mapsRanked.length > 1 ? mapsRanked[mapsRanked.length - 1] : null;

        const unlockedCount = badges.filter(b => b.unlocked).length;

        return { badges, stats, rrCurve, rank, peak, seasonal, topAgents, bestMap, worstMap, unlockedCount, gamesCount: ranked.length };
    }, [cfg, matches]);

    if (!cfg) {
        return (
            <div className="space-y-6">
                <div>
                    <h1 className="text-2xl font-black text-white uppercase tracking-tight flex items-center gap-2">
                        <IdCard size={24} className="text-[#ff4655]" /> Profils Joueurs
                    </h1>
                    <p className="text-gray-400 text-sm mt-1">Sélectionne un joueur pour explorer sa carrière et ses badges.</p>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                    {pickerData.map(p => (
                        <button
                            key={p.id}
                            onClick={() => onSelectPlayer && onSelectPlayer(p.id)}
                            className="group text-left p-5 rounded-2xl border border-white/5 bg-[#1c252e] hover:bg-white/5 transition-all hover:scale-[1.02]"
                            style={{ boxShadow: `inset 3px 0 0 ${p.color || '#ff4655'}` }}
                        >
                            <div className="flex items-center gap-3 mb-3">
                                <div className="w-12 h-12 rounded-xl flex items-center justify-center text-xl font-black text-white shrink-0"
                                    style={{ backgroundColor: (p.color || '#ff4655') + '33', border: `2px solid ${p.color || '#ff4655'}` }}>
                                    {p.name.charAt(0).toUpperCase()}
                                </div>
                                <div className="min-w-0">
                                    <div className="font-black text-white truncate">{p.name}</div>
                                    <div className="text-[10px] text-gray-500 font-bold">#{p.tag}</div>
                                </div>
                            </div>
                            <div className="flex items-center justify-between text-xs">
                                <span className="text-gray-500 font-bold">{p.games} games</span>
                                <span className={`font-black ${p.winrate >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>{p.winrate}% WR</span>
                            </div>
                        </button>
                    ))}
                </div>
            </div>
        );
    }

    if (!profile || profile.gamesCount === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-24 text-center">
                <Crosshair size={48} className="text-gray-600 mb-4" />
                <h2 className="text-xl font-black text-white uppercase">{cfg.name}</h2>
                <p className="text-gray-500 text-sm mt-2">Aucune partie classée sur cette période.</p>
            </div>
        );
    }

    const { stats, rank, peak, seasonal, rrCurve, topAgents, bestMap, worstMap, badges, unlockedCount } = profile;
    const accent = cfg.color || '#ff4655';
    const unlockedBadges = badges.filter(b => b.unlocked);
    const lockedBadges = badges.filter(b => !b.unlocked);
    // Bannière Valorant du joueur (v2/account) en fond de la carte d'identité.
    const bannerUrl = cfg.account_card ? `https://media.valorant-api.com/playercards/${cfg.account_card}/wideart.png` : null;
    const crosshairUrl = cfg.crosshair_code ? `${LOCAL_SERVER_URL}/api/crosshair?code=${encodeURIComponent(cfg.crosshair_code)}` : null;

    return (
        <div className="space-y-6">
            {/* CARTE D'IDENTITÉ */}
            <Card className="p-0 overflow-hidden border-white/10">
                <div className="relative p-6 md:p-8">
                    {/* Fond : bannière Valorant si dispo, sinon dégradé couleur joueur */}
                    {bannerUrl ? (
                        <>
                            <img src={bannerUrl} alt="" className="absolute inset-0 w-full h-full object-cover opacity-40" />
                            <div className="absolute inset-0 bg-gradient-to-r from-[#1c252e] via-[#1c252e]/85 to-[#1c252e]/40" />
                        </>
                    ) : (
                        <div className="absolute inset-0" style={{ background: `linear-gradient(135deg, ${accent}22, transparent 60%)` }} />
                    )}
                    <div className="absolute top-0 right-0 w-64 h-64 rounded-full blur-[100px] opacity-20 pointer-events-none" style={{ backgroundColor: accent }} />
                    <div className="relative flex flex-col md:flex-row md:items-center gap-6">
                        {/* Avatar initiale + rang */}
                        <div className="flex items-center gap-4">
                            <div className="w-20 h-20 rounded-2xl flex items-center justify-center text-4xl font-black text-white shadow-lg shrink-0"
                                style={{ backgroundColor: accent + '33', border: `2px solid ${accent}`, boxShadow: `0 0 25px ${accent}55` }}>
                                {cfg.name.charAt(0).toUpperCase()}
                            </div>
                            {rank && (
                                <div className="flex flex-col items-center">
                                    <img src={getRankIcon(rank.name)} alt={rank.name} className="w-14 h-14 object-contain drop-shadow-lg" />
                                    <span className="text-[10px] font-black text-gray-300 uppercase mt-0.5">{rank.rr} RR</span>
                                </div>
                            )}
                            {peak && (
                                <div className="flex flex-col items-center opacity-80" title={`Peak : ${peak.tier}${peak.season ? ` (${peak.season})` : ''}`}>
                                    <img src={getRankIcon(peak.tier)} alt={peak.tier} className="w-11 h-11 object-contain drop-shadow grayscale-[30%]" />
                                    <span className="text-[9px] font-black text-yellow-500/80 uppercase mt-0.5 flex items-center gap-0.5"><Trophy size={9} /> Peak</span>
                                </div>
                            )}
                            {crosshairUrl && (
                                <div className="flex flex-col items-center" title={`Viseur : ${cfg.crosshair_code}`}>
                                    <div className="w-11 h-11 rounded-lg bg-black/40 border border-white/10 flex items-center justify-center">
                                        <img src={crosshairUrl} alt="viseur" className="w-8 h-8 object-contain" />
                                    </div>
                                    <span className="text-[9px] font-black text-gray-500 uppercase mt-0.5">Viseur</span>
                                </div>
                            )}
                        </div>
                        <div className="flex-grow">
                            <h1 className="text-3xl md:text-4xl font-black text-white italic uppercase tracking-tighter leading-none">
                                {cfg.name} <span className="text-gray-500 text-xl not-italic">#{cfg.tag}</span>
                            </h1>
                            <div className="flex items-center gap-3 mt-2 flex-wrap">
                                {rank && <span className="text-sm font-bold uppercase tracking-wide" style={{ color: accent }}>{rank.name}</span>}
                                {cfg.account_level != null && <span className="text-xs text-gray-400 font-bold">Niveau {cfg.account_level}</span>}
                                <span className="text-xs text-gray-500 font-bold flex items-center gap-1">
                                    <Award size={13} /> {unlockedCount}/{badges.length} badges
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Stats clés */}
                    <div className="relative grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mt-6">
                        <StatPill label="Games" value={stats.games} icon={Swords} />
                        <StatPill label="Winrate" value={`${stats.winrate.toFixed(0)}%`} accent={stats.winrate >= 50 ? 'text-emerald-400' : 'text-red-400'} icon={Trophy} />
                        <StatPill label="K/D" value={stats.kd.toFixed(2)} accent={stats.kd >= 1 ? 'text-white' : 'text-gray-400'} icon={Skull} />
                        <StatPill label="HS%" value={`${stats.hsPct.toFixed(1)}%`} icon={Target} />
                        <StatPill label="RR net" value={`${stats.netRR >= 0 ? '+' : ''}${stats.netRR}`} accent={stats.netRR >= 0 ? 'text-emerald-400' : 'text-red-400'} icon={stats.netRR >= 0 ? TrendingUp : TrendingDown} />
                        <StatPill label="Série" value={stats.curStreak > 0 ? `${stats.curStreak} 🔥` : '—'} accent={stats.curStreak > 0 ? 'text-orange-400' : 'text-gray-500'} icon={Flame} />
                    </div>
                </div>
            </Card>

            {/* FRISE CARRIÈRE PAR SAISON (v3/mmr seasonal) */}
            {seasonal && seasonal.length > 0 && (
                <Card className="p-5">
                    <h3 className="text-xs font-black uppercase tracking-widest text-gray-400 mb-4 flex items-center gap-2">
                        <Trophy size={14} className="text-yellow-500/70" /> Carrière par saison
                    </h3>
                    <div className="flex items-end gap-2 overflow-x-auto custom-scrollbar pb-2">
                        {seasonal.map((s, i) => (
                            <div key={i} className="flex flex-col items-center shrink-0 group" title={`${s.season} — ${s.tier}`}>
                                <img src={getRankIcon(s.tier)} alt={s.tier} className="w-10 h-10 object-contain group-hover:scale-110 transition-transform" />
                                <span className="text-[9px] font-black text-gray-500 uppercase mt-1">{s.season}</span>
                            </div>
                        ))}
                    </div>
                </Card>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* COURBE DE RR */}
                <Card className="lg:col-span-2 p-5">
                    <h3 className="text-xs font-black uppercase tracking-widest text-gray-400 mb-4 flex items-center gap-2">
                        <TrendingUp size={14} /> Progression du RR ({rrCurve.length} games)
                    </h3>
                    {rrCurve.length > 1 ? (
                        <div className="h-64">
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={rrCurve} margin={{ left: -15, right: 10, top: 5, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                                    <XAxis dataKey="game" tick={{ fill: '#6b7280', fontSize: 10 }} stroke="#ffffff10" />
                                    <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} stroke="#ffffff10" />
                                    <RechartsTooltip
                                        contentStyle={{ backgroundColor: '#1c252e', border: '1px solid #ffffff15', borderRadius: 8, fontSize: 12 }}
                                        labelStyle={{ color: '#9ca3af' }}
                                        formatter={(v) => [`${v >= 0 ? '+' : ''}${v} RR`, 'Cumulé']}
                                    />
                                    <Line type="monotone" dataKey="rr" stroke={accent} strokeWidth={2.5} dot={false} />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    ) : (
                        <div className="h-64 flex items-center justify-center text-gray-600 text-sm italic">Pas assez de données RR.</div>
                    )}
                </Card>

                {/* AGENTS FÉTICHES + MAPS */}
                <Card className="p-5 space-y-5">
                    <div>
                        <h3 className="text-xs font-black uppercase tracking-widest text-gray-400 mb-3 flex items-center gap-2">
                            <User size={14} /> Agents fétiches
                        </h3>
                        <div className="space-y-2">
                            {topAgents.map(a => {
                                const wr = a.games > 0 ? Math.round((a.wins / a.games) * 100) : 0;
                                return (
                                    <div key={a.name} className="flex items-center gap-3">
                                        {a.img ? <img src={a.img} alt={a.name} className="w-9 h-9 rounded-lg bg-black object-cover border border-white/10" />
                                            : <div className="w-9 h-9 rounded-lg bg-white/5" />}
                                        <div className="flex-grow min-w-0">
                                            <div className="text-sm font-bold text-white truncate">{a.name}</div>
                                            <div className="text-[10px] text-gray-500">{a.games} games</div>
                                        </div>
                                        <span className={`text-xs font-black ${wr >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>{wr}%</span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                    <div className="pt-4 border-t border-white/5 space-y-2">
                        <h3 className="text-xs font-black uppercase tracking-widest text-gray-400 mb-2 flex items-center gap-2">
                            <MapPin size={14} /> Terrains
                        </h3>
                        {bestMap && (
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-gray-300 font-bold">{bestMap.name}</span>
                                <span className="text-emerald-400 font-black text-xs">{bestMap.wr}% · forteresse</span>
                            </div>
                        )}
                        {worstMap && worstMap.name !== bestMap?.name && (
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-gray-300 font-bold">{worstMap.name}</span>
                                <span className="text-red-400 font-black text-xs">{worstMap.wr}% · cauchemar</span>
                            </div>
                        )}
                        {!bestMap && <div className="text-xs text-gray-600 italic">Pas assez de games par map.</div>}
                    </div>
                </Card>
            </div>

            {/* BADGES */}
            <Card className="p-5">
                <h3 className="text-xs font-black uppercase tracking-widest text-gray-400 mb-4 flex items-center gap-2">
                    <Award size={14} /> Collection de badges
                    <span className="text-gray-600">— {unlockedCount} débloqué{unlockedCount > 1 ? 's' : ''}</span>
                </h3>
                {unlockedBadges.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-5">
                        {unlockedBadges.map(b => <BadgeChip key={b.id} badge={b} />)}
                    </div>
                )}
                {lockedBadges.length > 0 && (
                    <>
                        <div className="text-[10px] font-black uppercase tracking-widest text-gray-600 mb-2">À débloquer</div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                            {lockedBadges.map(b => <BadgeChip key={b.id} badge={b} />)}
                        </div>
                    </>
                )}
            </Card>
        </div>
    );
};
