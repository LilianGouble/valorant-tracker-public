import React, { useState } from 'react';
import {
    Shield, Users, Trash2, Database, AlertTriangle, Map as MapIcon,
    Filter, RefreshCw, BarChart3
} from 'lucide-react';

const StatCard = ({ label, value, accent = 'text-white', sub }) => (
    <div className="bg-[#1c252e] border border-white/5 rounded-xl p-4">
        <div className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-1">{label}</div>
        <div className={`text-2xl font-black ${accent}`}>{value}</div>
        {sub && <div className="text-[10px] text-gray-500 mt-0.5">{sub}</div>}
    </div>
);

const fmtDate = (ms) => {
    if (!ms) return '—';
    return new Date(Number(ms)).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
};

export const DataManagement = ({ overview, loading, onReload, onDeleteFilter, onPurgeOrphans, onPurgeAll }) => {
    const [agentSearch, setAgentSearch] = useState('');
    const [filterType, setFilterType] = useState('');
    const [filterResult, setFilterResult] = useState('');
    const [filterPlayer, setFilterPlayer] = useState('');
    const [filterBefore, setFilterBefore] = useState('');

    if (loading && !overview) {
        return <div className="flex items-center gap-3 text-gray-400 p-8"><RefreshCw className="animate-spin" size={18} /> Chargement des données...</div>;
    }
    if (!overview) {
        return (
            <div className="p-8 text-center">
                <button onClick={onReload} className="px-6 py-3 bg-white/5 hover:bg-white/10 rounded-xl font-bold text-gray-300">Charger les données</button>
            </div>
        );
    }

    const filteredAgents = overview.byAgent.filter(a =>
        a.agent.toLowerCase().includes(agentSearch.toLowerCase())
    );

    const buildCustomFilter = () => {
        const f = {};
        const labels = [];
        if (filterType)   { f.type = filterType;     labels.push(`type=${filterType}`); }
        if (filterResult) { f.result = filterResult; labels.push(`résultat=${filterResult}`); }
        if (filterPlayer) {
            f.playerId = filterPlayer;
            const pc = overview.players.find(p => p.id === filterPlayer);
            labels.push(`joueur=${pc ? pc.name : filterPlayer}`);
        }
        if (filterBefore) {
            f.before = new Date(filterBefore).getTime();
            labels.push(`avant ${new Date(filterBefore).toLocaleDateString('fr-FR')}`);
        }
        return { filter: f, label: labels.join(' · ') || 'tous les matchs' };
    };

    const hasCustomFilter = filterType || filterResult || filterPlayer || filterBefore;

    return (
        <div className="space-y-8">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-black text-white uppercase tracking-tight flex items-center gap-2">
                        <Database size={24} className="text-[#ff4655]" /> Gestion des Données
                    </h2>
                    <p className="text-gray-400 text-sm mt-1">Visualisez et faites le tri dans l'ensemble des matchs stockés.</p>
                </div>
                <button onClick={onReload} className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-sm font-bold text-gray-300 transition-colors">
                    <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Rafraîchir
                </button>
            </div>

            {/* CARTES DE STATISTIQUES */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard label="Enregistrements" value={overview.total.toLocaleString('fr-FR')} accent="text-white" />
                <StatCard label="Joueurs trackés" value={overview.players.length} accent="text-blue-400" />
                <StatCard label="Données orphelines" value={overview.orphanCount} accent={overview.orphanCount > 0 ? 'text-amber-400' : 'text-gray-500'} sub={overview.orphanCount > 0 ? 'À nettoyer' : 'Aucune'} />
                <StatCard label="Période" value={fmtDate(overview.dateRange.min)} accent="text-gray-300" sub={`→ ${fmtDate(overview.dateRange.max)}`} />
            </div>

            {/* RÉPARTITION PAR TYPE */}
            <div>
                <h3 className="text-xs font-black uppercase tracking-widest text-gray-500 mb-3 flex items-center gap-2"><BarChart3 size={14} /> Répartition par mode</h3>
                <div className="flex flex-wrap gap-2">
                    {overview.byType.map(t => (
                        <div key={t.type} className="group relative flex items-center gap-2 bg-[#1c252e] border border-white/5 rounded-lg pl-3 pr-1.5 py-1.5">
                            <span className="text-sm font-bold text-white uppercase">{t.type}</span>
                            <span className="text-xs font-mono text-gray-400">{t.count}</span>
                            <button
                                onClick={() => onDeleteFilter({ type: t.type }, `tous les matchs « ${t.type} »`)}
                                className="p-1 text-gray-600 hover:text-red-400 hover:bg-red-400/10 rounded transition-colors" title={`Supprimer tous les ${t.type}`}>
                                <Trash2 size={14} />
                            </button>
                        </div>
                    ))}
                </div>
            </div>

            {/* SUPPRESSION FILTRÉE PERSONNALISÉE */}
            <div className="bg-[#1c252e] border border-white/5 rounded-xl p-5">
                <h3 className="font-bold text-white mb-1 flex items-center gap-2"><Filter size={16} /> Suppression ciblée</h3>
                <p className="text-xs text-gray-500 mb-4">Combinez plusieurs critères. Un récapitulatif du nombre de matchs impactés s'affiche avant validation.</p>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
                    <div>
                        <label className="text-[10px] text-gray-500 uppercase font-bold block mb-1">Mode</label>
                        <select value={filterType} onChange={e => setFilterType(e.target.value)} className="w-full bg-[#0f1923] text-white p-2 rounded border border-white/10 outline-none text-sm">
                            <option value="">Tous</option>
                            {overview.byType.map(t => <option key={t.type} value={t.type}>{t.type}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="text-[10px] text-gray-500 uppercase font-bold block mb-1">Résultat</label>
                        <select value={filterResult} onChange={e => setFilterResult(e.target.value)} className="w-full bg-[#0f1923] text-white p-2 rounded border border-white/10 outline-none text-sm">
                            <option value="">Tous</option>
                            <option value="WIN">Victoire</option>
                            <option value="LOSS">Défaite</option>
                            <option value="DRAW">Égalité</option>
                        </select>
                    </div>
                    <div>
                        <label className="text-[10px] text-gray-500 uppercase font-bold block mb-1">Joueur</label>
                        <select value={filterPlayer} onChange={e => setFilterPlayer(e.target.value)} className="w-full bg-[#0f1923] text-white p-2 rounded border border-white/10 outline-none text-sm">
                            <option value="">Tous</option>
                            {overview.players.map(p => <option key={p.id} value={p.id}>{p.name} #{p.tag}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="text-[10px] text-gray-500 uppercase font-bold block mb-1">Antérieur au</label>
                        <input type="date" value={filterBefore} onChange={e => setFilterBefore(e.target.value)} className="w-full bg-[#0f1923] text-white p-2 rounded border border-white/10 outline-none text-sm" />
                    </div>
                </div>
                <button
                    disabled={!hasCustomFilter}
                    onClick={() => { const { filter, label } = buildCustomFilter(); onDeleteFilter(filter, label); }}
                    className="flex items-center gap-2 px-4 py-2 bg-red-500/15 hover:bg-red-500/25 disabled:opacity-30 disabled:cursor-not-allowed text-red-300 font-bold rounded-lg text-sm transition-colors">
                    <Trash2 size={15} /> Supprimer selon ces critères
                </button>
            </div>

            {/* DONNÉES PAR JOUEUR */}
            <div>
                <h3 className="text-xs font-black uppercase tracking-widest text-gray-500 mb-3 flex items-center gap-2"><Users size={14} /> Données par joueur</h3>
                <div className="bg-[#1c252e] border border-white/5 rounded-xl overflow-hidden">
                    {overview.byPlayer.map(p => (
                        <div key={p.playerId} className="flex items-center justify-between p-3 border-b border-white/5 last:border-0 hover:bg-white/5 transition-colors">
                            <div className="flex items-center gap-3 min-w-0">
                                <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: p.color || '#555' }}></div>
                                <div className="min-w-0">
                                    <div className="font-bold text-white text-sm truncate">
                                        {p.name ? <>{p.name} <span className="text-gray-500 text-xs">#{p.tag}</span></> : <span className="text-amber-400">⚠ {p.playerId} (orphelin)</span>}
                                    </div>
                                    <div className="text-[10px] text-gray-500">Dernière activité : {fmtDate(p.lastDate)}</div>
                                </div>
                            </div>
                            <div className="flex items-center gap-3 shrink-0">
                                <span className="text-sm font-mono font-bold text-gray-300">{p.count}</span>
                                <button
                                    onClick={() => onDeleteFilter({ playerId: p.playerId }, `tous les matchs de ${p.name || p.playerId}`)}
                                    className="p-2 text-gray-600 hover:text-red-400 hover:bg-red-400/10 rounded transition-colors" title="Supprimer les matchs de ce joueur">
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* DONNÉES PAR AGENT */}
            <div>
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xs font-black uppercase tracking-widest text-gray-500 flex items-center gap-2"><Shield size={14} /> Données par agent ({filteredAgents.length})</h3>
                    <input type="text" placeholder="Filtrer un agent..." value={agentSearch} onChange={e => setAgentSearch(e.target.value)} className="bg-[#0f1923] text-white px-3 py-1.5 rounded-lg border border-white/10 outline-none text-xs w-44" />
                </div>
                <div className="bg-[#1c252e] border border-white/5 rounded-xl overflow-hidden max-h-[400px] overflow-y-auto custom-scrollbar">
                    {filteredAgents.map(a => {
                        const wr = a.count > 0 ? Math.round((a.wins / a.count) * 100) : 0;
                        return (
                            <div key={a.agent} className="flex items-center justify-between p-3 border-b border-white/5 last:border-0 hover:bg-white/5 transition-colors">
                                <div className="flex items-center gap-3 min-w-0 flex-grow">
                                    <span className="font-bold text-white text-sm w-28 truncate">{a.agent}</span>
                                    <div className="flex-grow max-w-[200px] hidden md:block">
                                        <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                                            <div className={`h-full ${wr >= 50 ? 'bg-emerald-500' : 'bg-red-500'}`} style={{ width: `${wr}%` }}></div>
                                        </div>
                                    </div>
                                    <span className={`text-[10px] font-bold ${wr >= 50 ? 'text-emerald-400' : 'text-red-400'} w-10`}>{wr}% WR</span>
                                </div>
                                <div className="flex items-center gap-4 shrink-0">
                                    <span className="text-[10px] text-gray-500 font-mono hidden sm:inline">{a.avgAcs} ACS</span>
                                    <span className="text-sm font-mono font-bold text-gray-300 w-10 text-right">{a.count}</span>
                                    <button
                                        onClick={() => onDeleteFilter({ agent: a.agent }, `tous les matchs avec l'agent « ${a.agent} »`)}
                                        className="p-2 text-gray-600 hover:text-red-400 hover:bg-red-400/10 rounded transition-colors" title={`Supprimer les données de ${a.agent}`}>
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* DONNÉES PAR MAP */}
            <div>
                <h3 className="text-xs font-black uppercase tracking-widest text-gray-500 mb-3 flex items-center gap-2"><MapIcon size={14} /> Données par map</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {overview.byMap.map(m => {
                        const wr = m.count > 0 ? Math.round((m.wins / m.count) * 100) : 0;
                        return (
                            <div key={m.map} className="flex items-center justify-between bg-[#1c252e] border border-white/5 rounded-lg p-3 hover:bg-white/5 transition-colors">
                                <div>
                                    <div className="font-bold text-white text-sm">{m.map}</div>
                                    <div className={`text-[10px] font-bold ${wr >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>{wr}% WR · {m.count} matchs</div>
                                </div>
                                <button
                                    onClick={() => onDeleteFilter({ map: m.map }, `tous les matchs sur « ${m.map} »`)}
                                    className="p-2 text-gray-600 hover:text-red-400 hover:bg-red-400/10 rounded transition-colors" title={`Supprimer les données de ${m.map}`}>
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* ZONE DANGEREUSE */}
            <div className="border border-red-500/20 rounded-xl p-5 bg-red-500/5">
                <h3 className="font-black text-red-400 uppercase mb-4 flex items-center gap-2"><AlertTriangle size={18} /> Zone dangereuse</h3>
                <div className="space-y-3">
                    {overview.orphanCount > 0 && (
                        <div className="flex items-center justify-between flex-wrap gap-3">
                            <div>
                                <div className="font-bold text-white text-sm">Nettoyer les données orphelines</div>
                                <div className="text-xs text-gray-500">{overview.orphanCount} match(s) appartenant à des joueurs supprimés.</div>
                            </div>
                            <button onClick={onPurgeOrphans} className="px-4 py-2 bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 font-bold rounded-lg text-sm transition-colors whitespace-nowrap">
                                Purger les orphelins
                            </button>
                        </div>
                    )}
                    <div className="flex items-center justify-between flex-wrap gap-3 pt-3 border-t border-red-500/10">
                        <div>
                            <div className="font-bold text-white text-sm">Réinitialiser tout l'historique</div>
                            <div className="text-xs text-gray-500">Supprime les {overview.total.toLocaleString('fr-FR')} matchs. Joueurs, clés et config conservés.</div>
                        </div>
                        <button onClick={onPurgeAll} className="px-4 py-2 bg-red-500/15 hover:bg-red-500/30 text-red-300 font-black uppercase tracking-wider rounded-lg text-sm transition-colors whitespace-nowrap">
                            Tout supprimer
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};