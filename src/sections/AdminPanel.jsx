import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Shield, Key, Users, Settings, LogOut, Check, Trash2, Plus, Info, Trophy, X, ChevronLeft, Edit3, MessageSquare, Database, AlertTriangle, Map as MapIcon, Filter, RefreshCw, BarChart3 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { LOCAL_SERVER_URL } from '../config/constants';

export const AdminPanel = () => {
    const [token, setToken] = useState(localStorage.getItem('adminToken'));
    const [isVerifying, setIsVerifying] = useState(!!localStorage.getItem('adminToken'));
    const [needsPasswordChange, setNeedsPasswordChange] = useState(false);
    const [activeTab, setActiveTab] = useState('players');

    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');

    const [players, setPlayers] = useState([]);
    const [keys, setKeys] = useState([]);
    const [tournaments, setTournaments] = useState([]);

    // Etats Édition Joueur
    const [editingPlayerId, setEditingPlayerId] = useState(null);
    const [editPlayerForm, setEditPlayerForm] = useState({ name: '', tag: '', color: '' });

    // NOUVELLE CONFIGURATION AVEC LE BOT DISCORD
    const [config, setConfig] = useState({ discord_bot_token: '', discord_channel_id: '', app_url: '', challenge_start_date: '' });

    const [newPlayer, setNewPlayer] = useState({ name: '', tag: '', region: 'eu', color: '#ff4655', discord_id: '' });
    const [newKey, setNewKey] = useState('');

    // Etats Tournois
    const [newTourney, setNewTourney] = useState({ name: '', date: '', players: ['', '', '', ''] });
    const [editingTourney, setEditingTourney] = useState(null);
    const [editingMatch, setEditingMatch] = useState(null); // { roundIndex, matchIndex, player1, player2, winner, score }

    const [msg, setMsg] = useState({ text: '', type: '' });

    // --- GESTION DES DONNÉES ---
    const [dataOverview, setDataOverview] = useState(null);
    const [dataLoading, setDataLoading] = useState(false);
    const [deleteModal, setDeleteModal] = useState(null); // { kind, label, payload, count }
    const [confirmText, setConfirmText] = useState('');
    const [playerToDelete, setPlayerToDelete] = useState(null); // { id, name, tag, matchCount }

    const showMsg = (text, type = 'success') => {
        setMsg({ text, type });
        setTimeout(() => setMsg({ text: '', type: '' }), 3000);
    };

    const authHeaders = useMemo(() => ({
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
    }), [token]);

    const handleLogin = async (e) => {
        e.preventDefault();
        try {
            const res = await fetch(`${LOCAL_SERVER_URL}/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);

            setToken(data.token);
            localStorage.setItem('adminToken', data.token);
            setNeedsPasswordChange(data.needsPasswordChange);
            showMsg("Connexion réussie");
        } catch (err) {
            showMsg(err.message, 'error');
        }
    };

    const handlePasswordChange = async (e) => {
        e.preventDefault();
        try {
            const res = await fetch(`${LOCAL_SERVER_URL}/api/auth/change-password`, {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({ newPassword })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            setNeedsPasswordChange(false);
            showMsg("Mot de passe mis à jour !");
        } catch (err) {
            showMsg(err.message, 'error');
        }
    };

    const handleLogout = useCallback(() => {
        localStorage.removeItem('adminToken');
        setToken(null);
        setIsVerifying(false);
    }, []);

    const fetchData = useCallback(async () => {
        if (!token) return;
        try {
            const [pRes, kRes, cRes, tRes] = await Promise.all([
                fetch(`${LOCAL_SERVER_URL}/api/admin/players`, { headers: authHeaders }),
                fetch(`${LOCAL_SERVER_URL}/api/admin/keys`, { headers: authHeaders }),
                fetch(`${LOCAL_SERVER_URL}/api/admin/config`, { headers: authHeaders }),
                fetch(`${LOCAL_SERVER_URL}/api/admin/tournaments`, { headers: authHeaders })
            ]);

            if (pRes.status === 401 || pRes.status === 403) return handleLogout();

            setPlayers(await pRes.json());
            setKeys(await kRes.json());
            setConfig(await cRes.json());
            if (tRes.ok) {
                setTournaments(await tRes.json());
            }
            setIsVerifying(false);
        } catch (err) {
            console.error("Erreur Fetch Admin:", err);
            setIsVerifying(false);
        }
    }, [token, authHeaders, handleLogout]);

    useEffect(() => {
        fetchData();
    }, [fetchData, activeTab]);

    const addPlayer = async (e) => {
        e.preventDefault();
        try {
            const res = await fetch(`${LOCAL_SERVER_URL}/api/admin/players`, {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify(newPlayer)
            });
            if (res.ok) {
                showMsg("Joueur ajouté");
                setNewPlayer({ name: '', tag: '', region: 'eu', color: '#ff4655', discord_id: '' });
                fetchData();
            }
        } catch (err) {
            console.error(err);
        }
    };

    // Ouvre la modale de suppression de joueur (avec choix purge/conservation des données)
    const deletePlayer = async (p) => {
        let matchCount = 0;
        try {
            const res = await fetch(`${LOCAL_SERVER_URL}/api/admin/data/overview`, { headers: authHeaders });
            if (res.ok) {
                const ov = await res.json();
                matchCount = ov.byPlayer.find(bp => bp.playerId === p.id)?.count || 0;
            }
        } catch { /* le compteur est juste indicatif */ }
        setPlayerToDelete({ id: p.id, name: p.name, tag: p.tag, matchCount });
    };

    const confirmDeletePlayer = async (purge) => {
        if (!playerToDelete) return;
        try {
            const url = `${LOCAL_SERVER_URL}/api/admin/players/${playerToDelete.id}${purge ? '?purge=true' : ''}`;
            const res = await fetch(url, { method: 'DELETE', headers: authHeaders });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Erreur');
            showMsg(data.message || 'Joueur supprimé');
            setPlayerToDelete(null);
            fetchData();
            if (activeTab === 'data') loadDataOverview();
        } catch (err) {
            showMsg(err.message, 'error');
        }
    };

    // --- GESTION DES DONNÉES ---
    const loadDataOverview = useCallback(async () => {
        if (!token) return;
        setDataLoading(true);
        try {
            const res = await fetch(`${LOCAL_SERVER_URL}/api/admin/data/overview`, { headers: authHeaders });
            if (res.status === 401 || res.status === 403) return handleLogout();
            if (res.ok) setDataOverview(await res.json());
        } catch (err) {
            console.error('Erreur overview:', err);
        } finally {
            setDataLoading(false);
        }
    }, [token, authHeaders, handleLogout]);

    useEffect(() => {
        if (activeTab === 'data') loadDataOverview();
    }, [activeTab, loadDataOverview]);

    // Prépare une suppression filtrée : fait d'abord un dry-run pour connaître le nombre impacté.
    const prepareDeleteMatches = async (filter, label) => {
        try {
            const res = await fetch(`${LOCAL_SERVER_URL}/api/admin/data/delete-matches`, {
                method: 'POST', headers: authHeaders,
                body: JSON.stringify({ ...filter, dryRun: true })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Erreur');
            if (data.affected === 0) { showMsg('Aucune donnée ne correspond à ce filtre', 'error'); return; }
            setDeleteModal({ kind: 'filter', label, payload: filter, count: data.affected });
        } catch (err) {
            showMsg(err.message, 'error');
        }
    };

    const executeDeleteModal = async () => {
        if (!deleteModal) return;
        try {
            let res, data;
            if (deleteModal.kind === 'filter') {
                res = await fetch(`${LOCAL_SERVER_URL}/api/admin/data/delete-matches`, {
                    method: 'POST', headers: authHeaders,
                    body: JSON.stringify({ ...deleteModal.payload, dryRun: false })
                });
            } else if (deleteModal.kind === 'orphans') {
                res = await fetch(`${LOCAL_SERVER_URL}/api/admin/data/purge-orphans`, {
                    method: 'POST', headers: authHeaders
                });
            } else if (deleteModal.kind === 'all') {
                if (confirmText !== 'SUPPRIMER TOUT') { showMsg('Texte de confirmation incorrect', 'error'); return; }
                res = await fetch(`${LOCAL_SERVER_URL}/api/admin/data/purge-all`, {
                    method: 'POST', headers: authHeaders,
                    body: JSON.stringify({ confirm: 'SUPPRIMER TOUT' })
                });
            }
            data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Erreur');
            showMsg(`${data.deleted} enregistrement(s) supprimé(s)`);
            setDeleteModal(null);
            setConfirmText('');
            loadDataOverview();
        } catch (err) {
            showMsg(err.message, 'error');
        }
    };

    // --- FONCTIONS ÉDITION JOUEUR ---
    const startEditPlayer = (p) => {
        setEditingPlayerId(p.id);
        setEditPlayerForm({ name: p.name, tag: p.tag, color: p.color, discord_id: p.discord_id || '' });
    };

    const saveEditPlayer = async (id) => {
        try {
            const res = await fetch(`${LOCAL_SERVER_URL}/api/admin/players/${id}`, {
                method: 'PUT',
                headers: authHeaders,
                body: JSON.stringify(editPlayerForm)
            });
            if (res.ok) {
                showMsg("Joueur mis à jour !");
                setEditingPlayerId(null);
                fetchData();
            } else {
                showMsg("Erreur lors de la mise à jour", "error");
            }
        } catch (err) {
            console.error(err);
            showMsg("Erreur réseau", "error");
        }
    };

    const addKey = async (e) => {
        e.preventDefault();
        try {
            const res = await fetch(`${LOCAL_SERVER_URL}/api/admin/keys`, {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({ key: newKey })
            });
            const data = await res.json();
            if (res.ok) {
                showMsg("Clé ajoutée");
                setNewKey('');
                fetchData();
            } else {
                showMsg(data.error, 'error');
            }
        } catch (err) {
            console.error(err);
        }
    };

    const deleteKey = async (id) => {
        try {
            await fetch(`${LOCAL_SERVER_URL}/api/admin/keys/${id}`, { method: 'DELETE', headers: authHeaders });
            fetchData();
        } catch (err) {
            console.error(err);
        }
    };

    const saveConfig = async (e) => {
        e.preventDefault();
        try {
            const res = await fetch(`${LOCAL_SERVER_URL}/api/admin/config`, {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify(config)
            });
            if (res.ok) showMsg("Configuration sauvegardée !");
        } catch (err) {
            console.error(err);
        }
    };

    // --- ACTIONS TOURNOIS ---
    const updateTourneyPlayer = (index, value) => {
        const newPlayers = [...newTourney.players];
        newPlayers[index] = value;
        setNewTourney({ ...newTourney, players: newPlayers });
    };

    const addTourneyPlayerField = () => {
        setNewTourney({ ...newTourney, players: [...newTourney.players, ''] });
    };

    const removeTourneyPlayerField = (index) => {
        const newPlayers = newTourney.players.filter((_, i) => i !== index);
        setNewTourney({ ...newTourney, players: newPlayers });
    };

    const createTournament = async (e) => {
        e.preventDefault();
        const validPlayers = newTourney.players.filter(p => p.trim() !== '');
        if (validPlayers.length < 2) return showMsg("Il faut au moins 2 joueurs", "error");

        try {
            const res = await fetch(`${LOCAL_SERVER_URL}/api/admin/tournaments`, {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({ name: newTourney.name, date: newTourney.date, players: validPlayers })
            });
            if (res.ok) {
                showMsg("Tournoi généré !");
                setNewTourney({ name: '', date: '', players: ['', '', '', ''] });
                fetchData();
            }
        } catch (err) {
            showMsg("Erreur", "error");
        }
    };

    const deleteTournament = async (id) => {
        if (!window.confirm("Supprimer ce tournoi ?")) return;
        await fetch(`${LOCAL_SERVER_URL}/api/admin/tournaments/${id}`, { method: 'DELETE', headers: authHeaders });
        fetchData();
        if (editingTourney?.id === id) setEditingTourney(null);
    };

    const submitMatchUpdate = async (e) => {
        e.preventDefault();
        try {
            const res = await fetch(`${LOCAL_SERVER_URL}/api/admin/tournaments/${editingTourney.id}/match`, {
                method: 'PUT',
                headers: authHeaders,
                body: JSON.stringify({
                    roundIndex: editingMatch.roundIndex,
                    matchIndex: editingMatch.matchIndex,
                    winner: editingMatch.winner,
                    score: editingMatch.score
                })
            });
            if (res.ok) {
                const data = await res.json();
                setEditingTourney({ ...editingTourney, bracket: data.bracket });
                setEditingMatch(null);
                fetchData();
                showMsg("Arbre mis à jour !");
            }
        } catch (err) {
            showMsg("Erreur de mise à jour", "error");
        }
    };

    if (token && isVerifying) {
        return (
            <div className="min-h-screen bg-[#0f1923] flex items-center justify-center p-4">
                <div className="flex flex-col items-center gap-4 text-gray-400">
                    <Shield size={48} className="text-[#ff4655] animate-pulse" />
                    <p className="text-sm uppercase tracking-wider font-bold">Vérification de la session…</p>
                </div>
            </div>
        );
    }

    if (!token) {
        return (
            <div className="min-h-screen bg-[#0f1923] flex items-center justify-center p-4">
                <div className="bg-[#1c252e] p-8 rounded-2xl border border-white/10 shadow-2xl w-full max-w-md">
                    <div className="flex justify-center mb-6 text-[#ff4655]">
                        <Shield size={48} />
                    </div>
                    <h2 className="text-2xl font-black text-center text-white uppercase italic tracking-tighter mb-8">Administration</h2>

                    {msg.text && <div className={`p-3 rounded mb-4 text-center text-sm font-bold ${msg.type === 'error' ? 'bg-red-500/20 text-red-400' : 'bg-emerald-500/20 text-emerald-400'}`}>{msg.text}</div>}

                    <form onSubmit={handleLogin} className="space-y-4">
                        <div>
                            <label className="text-xs text-gray-400 font-bold uppercase block mb-1">Nom d'utilisateur</label>
                            <input type="text" value={username} onChange={e => setUsername(e.target.value)} className="w-full bg-[#0f1923] text-white p-3 rounded border border-white/10 outline-none focus:border-[#ff4655]" required />
                        </div>
                        <div>
                            <label className="text-xs text-gray-400 font-bold uppercase block mb-1">Mot de passe</label>
                            <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full bg-[#0f1923] text-white p-3 rounded border border-white/10 outline-none focus:border-[#ff4655]" required />
                        </div>
                        <button type="submit" className="w-full bg-[#ff4655] hover:bg-[#d93442] text-white font-black py-3 rounded uppercase tracking-wider transition-colors mt-4">
                            Se connecter
                        </button>
                    </form>
                    <p className="text-xs text-gray-600 text-center mt-6">Par défaut: admin / admin</p>
                </div>
            </div>
        );
    }

    if (needsPasswordChange) {
        return (
            <div className="min-h-screen bg-[#0f1923] flex items-center justify-center p-4">
                <div className="bg-[#1c252e] p-8 rounded-2xl border border-red-500/30 shadow-2xl w-full max-w-md">
                    <h2 className="text-xl font-black text-center text-white uppercase italic mb-4">Sécurité Requise</h2>
                    <p className="text-sm text-gray-400 text-center mb-6">Vous utilisez le mot de passe par défaut. Vous devez impérativement le changer avant d'accéder au panel.</p>

                    {msg.text && <div className={`p-3 rounded mb-4 text-center text-sm font-bold ${msg.type === 'error' ? 'bg-red-500/20 text-red-400' : 'bg-emerald-500/20 text-emerald-400'}`}>{msg.text}</div>}

                    <form onSubmit={handlePasswordChange} className="space-y-4">
                        <div>
                            <label className="text-xs text-gray-400 font-bold uppercase block mb-1">Nouveau mot de passe</label>
                            <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} minLength={10} placeholder="10 caractères minimum" className="w-full bg-[#0f1923] text-white p-3 rounded border border-white/10 outline-none focus:border-red-500" required />
                        </div>
                        <button type="submit" className="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-black py-3 rounded uppercase tracking-wider transition-colors">
                            Valider et continuer
                        </button>
                    </form>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#0f1923] text-gray-100 font-sans flex flex-col md:flex-row relative">

            {/* MODALE DE SUPPRESSION DE JOUEUR (avec choix purge/conservation) */}
            {playerToDelete && (
                <div className="fixed inset-0 bg-black/80 z-[110] flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-[#1c252e] p-6 rounded-2xl border border-red-500/30 shadow-2xl w-full max-w-md">
                        <div className="flex items-center gap-3 mb-4 text-red-400">
                            <AlertTriangle size={24} />
                            <h3 className="text-xl font-black text-white uppercase italic tracking-tighter">Supprimer {playerToDelete.name}</h3>
                        </div>
                        <p className="text-sm text-gray-400 mb-4">
                            Ce joueur possède <strong className="text-white">{playerToDelete.matchCount}</strong> match(s) enregistré(s).
                            Que faire de ces données ?
                        </p>
                        <div className="space-y-3">
                            <button
                                onClick={() => confirmDeletePlayer(false)}
                                className="w-full text-left p-4 bg-[#0f1923] hover:bg-white/5 border border-white/10 hover:border-blue-500/40 rounded-xl transition-colors"
                            >
                                <div className="font-bold text-blue-300">Conserver les données</div>
                                <div className="text-xs text-gray-500 mt-0.5">Le joueur est retiré, mais ses matchs restent en base (deviennent orphelins).</div>
                            </button>
                            <button
                                onClick={() => confirmDeletePlayer(true)}
                                className="w-full text-left p-4 bg-red-500/5 hover:bg-red-500/15 border border-red-500/20 hover:border-red-500/50 rounded-xl transition-colors"
                            >
                                <div className="font-bold text-red-300">Purger tout ({playerToDelete.matchCount} matchs)</div>
                                <div className="text-xs text-gray-500 mt-0.5">Supprime le joueur ET tous ses matchs. Irréversible.</div>
                            </button>
                        </div>
                        <button onClick={() => setPlayerToDelete(null)} className="w-full mt-4 py-2 text-gray-500 hover:text-white text-sm font-bold transition-colors">
                            Annuler
                        </button>
                    </div>
                </div>
            )}

            {/* MODALE DE CONFIRMATION DE SUPPRESSION DE DONNÉES */}
            {deleteModal && (
                <div className="fixed inset-0 bg-black/80 z-[110] flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-[#1c252e] p-6 rounded-2xl border border-red-500/30 shadow-2xl w-full max-w-md">
                        <div className="flex items-center gap-3 mb-4 text-red-400">
                            <AlertTriangle size={24} />
                            <h3 className="text-xl font-black text-white uppercase italic tracking-tighter">Confirmer la suppression</h3>
                        </div>
                        <p className="text-sm text-gray-400 mb-4">
                            Vous êtes sur le point de supprimer <strong className="text-red-300">{deleteModal.count}</strong> enregistrement(s)
                            {' '}correspondant à : <strong className="text-white">{deleteModal.label}</strong>. Cette action est <strong className="text-red-300">irréversible</strong>.
                        </p>
                        {deleteModal.kind === 'all' && (
                            <div className="mb-4">
                                <label className="text-xs text-gray-400 font-bold uppercase block mb-1">Tapez « SUPPRIMER TOUT » pour confirmer</label>
                                <input
                                    type="text" value={confirmText} onChange={e => setConfirmText(e.target.value)}
                                    className="w-full bg-[#0f1923] text-white p-3 rounded border border-red-500/30 outline-none focus:border-red-500 font-mono text-sm"
                                    placeholder="SUPPRIMER TOUT"
                                />
                            </div>
                        )}
                        <div className="flex gap-3 mt-2">
                            <button onClick={() => { setDeleteModal(null); setConfirmText(''); }} className="flex-1 py-3 bg-white/5 hover:bg-white/10 text-gray-300 font-bold rounded-xl transition-colors">
                                Annuler
                            </button>
                            <button
                                onClick={executeDeleteModal}
                                disabled={deleteModal.kind === 'all' && confirmText !== 'SUPPRIMER TOUT'}
                                className="flex-1 py-3 bg-red-500 hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-black uppercase tracking-wider rounded-xl transition-colors"
                            >
                                Supprimer
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* MODALE D'ÉDITION DE MATCH */}
            {editingMatch && (
                <div className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-[#1c252e] p-6 rounded-2xl border border-white/10 shadow-2xl w-full max-w-sm">
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-xl font-black text-white uppercase italic tracking-tighter">Éditer le Match</h3>
                            <button onClick={() => setEditingMatch(null)} className="text-gray-500 hover:text-white">
                                <X size={24} />
                            </button>
                        </div>
                        <form onSubmit={submitMatchUpdate} className="space-y-5">
                            <div className="flex justify-between items-center bg-[#0f1923] p-4 rounded-xl border border-white/5 font-bold text-lg">
                                <span className={editingMatch.winner === editingMatch.player1 ? 'text-emerald-400' : 'text-white'}>
                                    {editingMatch.player1 || '?'}
                                </span>
                                <span className="text-gray-600 text-sm">VS</span>
                                <span className={editingMatch.winner === editingMatch.player2 ? 'text-emerald-400' : 'text-white'}>
                                    {editingMatch.player2 || '?'}
                                </span>
                            </div>

                            <div>
                                <label className="text-xs text-gray-400 font-bold uppercase mb-1 block">Score Final (Optionnel)</label>
                                <input type="text" placeholder="Ex: 13-11" value={editingMatch.score} onChange={e => setEditingMatch({ ...editingMatch, score: e.target.value })} className="w-full bg-[#0f1923] text-white p-3 rounded-xl border border-white/10 outline-none focus:border-[#ff4655] font-mono text-center text-lg" />
                            </div>

                            <div>
                                <label className="text-xs text-gray-400 font-bold uppercase mb-1 block">Déclarer un Gagnant</label>
                                <select value={editingMatch.winner || ''} onChange={e => setEditingMatch({ ...editingMatch, winner: e.target.value })} className="w-full bg-[#0f1923] text-white p-3 rounded-xl border border-white/10 outline-none focus:border-emerald-500 font-bold cursor-pointer">
                                    <option value="">-- Aucun gagnant --</option>
                                    {editingMatch.player1 && <option value={editingMatch.player1}>{editingMatch.player1}</option>}
                                    {editingMatch.player2 && <option value={editingMatch.player2}>{editingMatch.player2}</option>}
                                </select>
                            </div>

                            <button type="submit" className="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-black py-3 rounded-xl uppercase tracking-wider transition-colors mt-2">
                                Valider et Avancer
                            </button>
                        </form>
                    </div>
                </div>
            )}

            <aside className="w-full md:w-64 bg-[#1c252e] border-r border-white/5 p-6 flex flex-col shrink-0">
                <div className="flex items-center gap-3 mb-10 text-white">
                    <Shield className="text-[#ff4655]" size={28} />
                    <h1 className="text-xl font-black uppercase italic tracking-tighter leading-none">Admin<br /><span className="text-[#ff4655] text-sm">Tracker</span></h1>
                </div>

                <nav className="space-y-2 flex-grow">
                    <button onClick={() => { setActiveTab('players'); setEditingTourney(null); }} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-bold transition-colors ${activeTab === 'players' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white'}`}>
                        <Users size={18} /> Gérer les Joueurs
                    </button>
                    <button onClick={() => { setActiveTab('tournaments'); setEditingTourney(null); }} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-bold transition-colors ${activeTab === 'tournaments' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white'}`}>
                        <Trophy size={18} /> Gérer les Tournois
                    </button>
                    <button onClick={() => { setActiveTab('data'); setEditingTourney(null); }} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-bold transition-colors ${activeTab === 'data' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white'}`}>
                        <Database size={18} /> Gestion des Données
                    </button>
                    <button onClick={() => { setActiveTab('keys'); setEditingTourney(null); }} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-bold transition-colors ${activeTab === 'keys' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white'}`}>
                        <Key size={18} /> Clés API Riot
                    </button>
                    <button onClick={() => { setActiveTab('settings'); setEditingTourney(null); }} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-bold transition-colors ${activeTab === 'settings' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white'}`}>
                        <Settings size={18} /> Configuration
                    </button>
                </nav>

                <div className="mt-auto pt-6 border-t border-white/5">
                    <button onClick={() => { window.location.href = "/" }} className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 rounded text-sm text-gray-300 font-bold mb-2 transition-colors">
                        <LogOut size={16} className="rotate-180" /> Retour au site
                    </button>
                    <button onClick={handleLogout} className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 rounded text-sm text-red-400 font-bold transition-colors">
                        <LogOut size={16} /> Déconnexion
                    </button>
                </div>
            </aside>

            <main className="flex-grow p-6 md:p-10 max-w-5xl overflow-y-auto">
                <AnimatePresence>
                    {msg.text && (
                        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className={`fixed top-4 right-4 z-50 px-6 py-3 rounded shadow-xl font-bold flex items-center gap-2 ${msg.type === 'error' ? 'bg-red-500 text-white' : 'bg-emerald-500 text-white'}`}>
                            <Check size={18} /> {msg.text}
                        </motion.div>
                    )}
                </AnimatePresence>

                {activeTab === 'players' && (
                    <div className="space-y-6">
                        <div>
                            <h2 className="text-2xl font-black text-white uppercase tracking-tight">Liste des Joueurs ({players.length})</h2>
                            <p className="text-gray-400 text-sm mt-1">Ajoutez les joueurs dont vous souhaitez récupérer les statistiques.</p>
                        </div>
                        <div className="bg-[#1c252e] p-6 rounded-xl border border-white/5">
                            <h3 className="font-bold text-white mb-4 flex items-center gap-2"><Plus size={18} /> Ajouter un joueur</h3>
                            <form onSubmit={addPlayer} className="grid grid-cols-1 md:grid-cols-6 gap-4 items-end">
                                <div className="col-span-2">
                                    <label className="text-[10px] text-gray-500 uppercase font-bold block mb-1">Pseudo Valorant</label>
                                    <input type="text" placeholder="Ex: Tenz" value={newPlayer.name} onChange={e => setNewPlayer({ ...newPlayer, name: e.target.value })} className="w-full bg-[#0f1923] text-white p-2 rounded border border-white/10 outline-none" required />
                                </div>
                                <div>
                                    <label className="text-[10px] text-gray-500 uppercase font-bold block mb-1">Tag (sans #)</label>
                                    <input type="text" placeholder="Ex: SEN" value={newPlayer.tag} onChange={e => setNewPlayer({ ...newPlayer, tag: e.target.value })} className="w-full bg-[#0f1923] text-white p-2 rounded border border-white/10 outline-none" required />
                                </div>
                                <div>
                                    <label className="text-[10px] text-gray-500 uppercase font-bold block mb-1">Couleur HEX</label>
                                    <div className="flex gap-2">
                                        <input type="color" value={newPlayer.color} onChange={e => setNewPlayer({ ...newPlayer, color: e.target.value })} className="h-10 w-10 p-1 bg-[#0f1923] rounded border border-white/10 cursor-pointer shrink-0" />
                                        <input type="text" value={newPlayer.color} onChange={e => setNewPlayer({ ...newPlayer, color: e.target.value })} className="w-full bg-[#0f1923] text-white p-2 rounded border border-white/10 outline-none text-xs font-mono uppercase" />
                                    </div>
                                </div>
                                <div>
                                    <label className="text-[10px] text-gray-500 uppercase font-bold block mb-1">Discord ID (Opt.)</label>
                                    <input type="text" placeholder="12345..." value={newPlayer.discord_id} onChange={e => setNewPlayer({ ...newPlayer, discord_id: e.target.value })} className="w-full bg-[#0f1923] text-white p-2 rounded border border-white/10 outline-none text-xs" />
                                </div>
                                <button type="submit" className="bg-[#ff4655] hover:bg-[#d93442] text-white font-bold h-10 rounded transition-colors">Ajouter</button>
                            </form>
                        </div>
                        <div className="bg-[#1c252e] rounded-xl border border-white/5 overflow-hidden">
                            {players.map(p => (
                                <div key={p.id} className="flex items-center justify-between p-4 border-b border-white/5 hover:bg-white/5 transition-colors">

                                    {editingPlayerId === p.id ? (
                                        <div className="flex-grow flex items-center gap-2 mr-4">
                                            <input type="color" value={editPlayerForm.color} onChange={e => setEditPlayerForm({ ...editPlayerForm, color: e.target.value })} className="h-8 w-8 p-0 bg-transparent border border-white/10 rounded cursor-pointer shrink-0" />
                                            <input type="text" value={editPlayerForm.name} onChange={e => setEditPlayerForm({ ...editPlayerForm, name: e.target.value })} className="bg-[#0f1923] text-white px-2 py-1.5 rounded border border-white/10 text-sm font-bold w-full max-w-[120px] outline-none focus:border-blue-500" />
                                            <span className="text-gray-500 font-bold">#</span>
                                            <input type="text" value={editPlayerForm.tag} onChange={e => setEditPlayerForm({ ...editPlayerForm, tag: e.target.value })} className="bg-[#0f1923] text-white px-2 py-1.5 rounded border border-white/10 text-sm font-bold w-24 outline-none focus:border-blue-500" />
                                            <input type="text" placeholder="Discord ID" value={editPlayerForm.discord_id} onChange={e => setEditPlayerForm({ ...editPlayerForm, discord_id: e.target.value })} className="bg-[#0f1923] text-white px-2 py-1.5 rounded border border-white/10 text-sm font-bold w-28 outline-none focus:border-blue-500" title="ID Utilisateur Discord" />
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-3">
                                            <div className="w-4 h-4 rounded-full" style={{ backgroundColor: p.color }}></div>
                                            <div>
                                                <div className="font-bold text-white leading-none">{p.name} <span className="text-gray-500 text-xs">#{p.tag}</span></div>
                                                <div className="text-[10px] text-gray-500 font-mono mt-1">ID: {p.id} {p.discord_id ? `| 🔗 Discord: ${p.discord_id}` : ''}</div>
                                            </div>
                                        </div>
                                    )}

                                    <div className="flex items-center gap-2 shrink-0">
                                        {editingPlayerId === p.id ? (
                                            <>
                                                <button onClick={() => saveEditPlayer(p.id)} className="p-2 text-emerald-400 hover:bg-emerald-400/10 rounded transition-colors" title="Sauvegarder">
                                                    <Check size={18} />
                                                </button>
                                                <button onClick={() => setEditingPlayerId(null)} className="p-2 text-gray-500 hover:bg-white/10 rounded transition-colors" title="Annuler">
                                                    <X size={18} />
                                                </button>
                                            </>
                                        ) : (
                                            <>
                                                <button onClick={() => startEditPlayer(p)} className="p-2 text-blue-400 hover:bg-blue-400/10 rounded transition-colors" title="Modifier pseudo/couleur">
                                                    <Edit3 size={18} />
                                                </button>
                                                <button onClick={() => deletePlayer(p)} className="p-2 text-gray-500 hover:text-red-400 hover:bg-red-400/10 rounded transition-colors">
                                                    <Trash2 size={18} />
                                                </button>
                                            </>
                                        )}
                                    </div>

                                </div>
                            ))}
                            {players.length === 0 && <div className="p-6 text-center text-gray-500 text-sm">Aucun joueur enregistré.</div>}
                        </div>
                    </div>
                )}

                {activeTab === 'tournaments' && !editingTourney && (
                    <div className="space-y-6">
                        <div>
                            <h2 className="text-2xl font-black text-white uppercase tracking-tight">Générateur de Tournois</h2>
                            <p className="text-gray-400 text-sm mt-1">Créez des arbres de tournois personnalisés avec n'importe quels joueurs.</p>
                        </div>

                        <div className="bg-[#1c252e] p-6 rounded-xl border border-white/5">
                            <h3 className="font-bold text-white mb-4 flex items-center gap-2"><Plus size={18} /> Créer un nouveau tournoi</h3>
                            <form onSubmit={createTournament} className="space-y-4">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="text-xs text-gray-400 font-bold uppercase mb-1 block">Nom du Tournoi</label>
                                        <input type="text" placeholder="Ex: KSL Summer Cup" value={newTourney.name} onChange={e => setNewTourney({ ...newTourney, name: e.target.value })} className="w-full bg-[#0f1923] text-white p-3 rounded border border-white/10 outline-none focus:border-[#ff4655]" required />
                                    </div>
                                    <div>
                                        <label className="text-xs text-gray-400 font-bold uppercase mb-1 block">Date</label>
                                        <input type="date" value={newTourney.date} onChange={e => setNewTourney({ ...newTourney, date: e.target.value })} className="w-full bg-[#0f1923] text-white p-3 rounded border border-white/10 outline-none focus:border-[#ff4655]" required />
                                    </div>
                                </div>
                                <div className="bg-[#0f1923] p-4 rounded-xl border border-white/5">
                                    <div className="flex justify-between items-center mb-4">
                                        <label className="text-xs text-gray-400 font-bold uppercase">Liste des Participants ({newTourney.players.length})</label>
                                        <button type="button" onClick={addTourneyPlayerField} className="text-xs font-bold text-blue-400 hover:text-blue-300 flex items-center gap-1 bg-blue-500/10 px-3 py-1.5 rounded-lg transition-colors">
                                            <Plus size={14} /> Ajouter un joueur
                                        </button>
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                                        {newTourney.players.map((p, idx) => (
                                            <div key={idx} className="flex relative">
                                                <input type="text" placeholder={`Joueur ${idx + 1}`} value={p} onChange={e => updateTourneyPlayer(idx, e.target.value)} className="w-full bg-[#1c252e] text-white p-2.5 pr-8 rounded border border-white/10 outline-none focus:border-[#ff4655] text-sm font-bold" />
                                                {newTourney.players.length > 2 && (
                                                    <button type="button" onClick={() => removeTourneyPlayerField(idx)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-red-400 p-1 bg-[#0f1923] rounded transition-colors">
                                                        <X size={14} />
                                                    </button>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                    <p className="text-[10px] text-gray-500 mt-3 italic">Astuce: S'il n'y a pas un nombre pair parfait de joueurs, le système génèrera automatiquement des passes gratuites ("BYE") pour équilibrer l'arbre.</p>
                                </div>
                                <button type="submit" className="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-black py-3 rounded uppercase tracking-wider transition-colors mt-4">
                                    <Trophy size={18} className="inline mr-2 -mt-1" />
                                    Générer l'arbre du tournoi
                                </button>
                            </form>
                        </div>

                        <div className="space-y-3 mt-8">
                            <h3 className="font-bold text-gray-400 uppercase text-sm">Tournois Créés ({tournaments.length})</h3>
                            {tournaments.length === 0 && <div className="text-sm text-gray-500 italic p-4 text-center bg-[#1c252e] rounded-xl border border-white/5">Aucun tournoi enregistré.</div>}

                            {tournaments.map(t => (
                                <div key={t.id} className="flex justify-between items-center bg-[#1c252e] p-4 rounded-xl border border-white/5">
                                    <div>
                                        <div className="font-black text-white uppercase text-lg">{t.name}</div>
                                        <div className="text-xs text-gray-400 flex items-center gap-2 mt-1">
                                            <span className="bg-black/30 px-2 py-0.5 rounded text-gray-300 font-bold">{new Date(t.date).toLocaleDateString('fr-FR')}</span>
                                            <span>•</span>
                                            <Users size={12} className="text-[#ff4655]" /> {t.players.length} Participants
                                        </div>
                                    </div>
                                    <div className="flex gap-2">
                                        <button onClick={() => setEditingTourney(t)} className="bg-blue-500/20 text-blue-400 hover:bg-blue-500 hover:text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-colors">
                                            <Edit3 size={16} /> Éditer les matchs
                                        </button>
                                        <button onClick={() => deleteTournament(t.id)} className="text-gray-500 hover:text-red-400 p-2.5 bg-white/5 rounded-lg hover:bg-red-500/10 transition-colors">
                                            <Trash2 size={18} />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* VUE D'ÉDITION DE L'ARBRE */}
                {activeTab === 'tournaments' && editingTourney && (
                    <div className="space-y-6 animate-in fade-in">
                        <button onClick={() => setEditingTourney(null)} className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors bg-white/5 px-4 py-2 rounded-lg w-fit">
                            <ChevronLeft size={20} /> Retour à la liste
                        </button>

                        <div className="bg-[#1c252e] p-6 rounded-2xl border border-white/5">
                            <div className="mb-6 border-b border-white/5 pb-4">
                                <h2 className="text-2xl font-black text-white uppercase italic">{editingTourney.name}</h2>
                                <p className="text-sm text-gray-400 mt-1">Cliquez sur un match dans l'arbre pour définir le score et le gagnant.</p>
                            </div>

                            <div className="flex gap-4 sm:gap-8 overflow-x-auto pb-10 pt-4 custom-scrollbar items-stretch min-h-[400px]">
                                {editingTourney.bracket.map((round, rIndex) => (
                                    <div key={rIndex} className="flex flex-col flex-1 min-w-[220px] relative justify-around gap-4">
                                        <div className="absolute -top-6 left-0 w-full text-center text-xs font-black text-gray-500 uppercase tracking-widest">
                                            {rIndex === editingTourney.bracket.length - 1 ? 'Finale' : `Round ${rIndex + 1}`}
                                        </div>

                                        {round.map((match, mIndex) => {
                                            const isClickable = match.player1 && match.player2 && match.player1 !== 'BYE' && match.player2 !== 'BYE';
                                            return (
                                                <div key={mIndex} className="flex-1 flex flex-col justify-center py-2 relative">
                                                    <div
                                                        onClick={() => isClickable && setEditingMatch({ roundIndex: rIndex, matchIndex: mIndex, ...match })}
                                                        className={`bg-[#0f1923] border rounded-lg p-3 relative z-10 transition-all ${isClickable ? 'border-[#ff4655]/50 hover:bg-white/5 cursor-pointer hover:scale-105 shadow-lg' : 'border-white/5 opacity-70'}`}
                                                    >
                                                        <div className={`py-1 px-2 rounded text-sm font-bold truncate ${match.winner === match.player1 ? 'text-emerald-400' : 'text-gray-300'}`}>
                                                            {match.player1 === 'BYE' ? <span className="text-gray-600 italic">Passage Auto</span> : (match.player1 || 'À déterminer')}
                                                        </div>
                                                        <div className="flex items-center my-1">
                                                            <div className="h-px flex-grow bg-white/10"></div>
                                                            {match.score && <div className="px-2 text-[10px] font-mono text-blue-400 font-bold bg-black/50 rounded-full">{match.score}</div>}
                                                            <div className="h-px flex-grow bg-white/10"></div>
                                                        </div>
                                                        <div className={`py-1 px-2 rounded text-sm font-bold truncate ${match.winner === match.player2 ? 'text-emerald-400' : 'text-gray-300'}`}>
                                                            {match.player2 === 'BYE' ? <span className="text-gray-600 italic">Passage Auto</span> : (match.player2 || 'À déterminer')}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {/* ONGLET GESTION DES DONNÉES */}
                {activeTab === 'data' && (
                    <DataManagement
                        overview={dataOverview}
                        loading={dataLoading}
                        onReload={loadDataOverview}
                        onDeleteFilter={prepareDeleteMatches}
                        onPurgeOrphans={() => setDeleteModal({ kind: 'orphans', label: 'données orphelines', count: dataOverview?.orphanCount || 0 })}
                        onPurgeAll={() => { setConfirmText(''); setDeleteModal({ kind: 'all', label: 'TOUT l\'historique', count: dataOverview?.total || 0 }); }}
                    />
                )}

                {/* ONGLET CLÉS API */}
                {activeTab === 'keys' && (
                    <div className="space-y-6">
                        <div>
                            <h2 className="text-2xl font-black text-white uppercase tracking-tight">Clés API HenrikDev ({keys.length})</h2>
                            <p className="text-gray-400 text-sm mt-1">L'application utilise l'API non-officielle HenrikDev pour récupérer les matchs.</p>
                        </div>
                        <div className="bg-blue-500/10 border border-blue-500/20 p-4 rounded-xl flex gap-3 text-blue-200 text-sm">
                            <Info className="shrink-0 mt-0.5 text-blue-400" size={20} />
                            <div>
                                <strong className="block text-blue-400 mb-1">Comment obtenir des clés API ?</strong>
                                1. Rendez-vous sur <a href="api.henrikdev.xyz/dashboard/" target="_blank" rel="noreferrer" className="underline font-bold text-white hover:text-blue-300">le site de HenrikDev</a>.<br />
                                2. Connectez-vous avec <strong>Discord</strong>.<br />
                                3. Allez dans l'onglet <code>API Keys</code> et "+ Generate New Key".<br />
                                <em>Astuce : Ajoutez plusieurs clés issues de comptes Discord différents pour éviter la limite de requêtes (Rate Limit 429) lors du scan !</em>
                            </div>
                        </div>
                        <form onSubmit={addKey} className="flex gap-2">
                            <input type="text" placeholder="HDEV-xxxxxxxx-xxxx-xxxx..." value={newKey} onChange={e => setNewKey(e.target.value)} className="flex-grow bg-[#0f1923] text-white p-3 rounded-lg border border-white/10 outline-none focus:border-[#ff4655] font-mono text-sm" required />
                            <button type="submit" className="bg-[#ff4655] hover:bg-[#d93442] px-6 text-white font-bold rounded-lg transition-colors whitespace-nowrap">Ajouter Clé</button>
                        </form>
                        <div className="space-y-2">
                            {keys.map(k => (
                                <div key={k.id} className="flex justify-between items-center bg-[#1c252e] p-3 rounded-lg border border-white/5">
                                    <span className="font-mono text-sm text-gray-300">{k.key}</span>
                                    <button onClick={() => deleteKey(k.id)} className="text-gray-500 hover:text-red-400 transition-colors p-1"><Trash2 size={16} /></button>
                                </div>
                            ))}
                            {keys.length === 0 && <div className="text-center text-red-400 text-sm p-4 bg-red-500/10 rounded-lg border border-red-500/20">Alerte : Le Tracker ne peut pas fonctionner sans au moins une clé API.</div>}
                        </div>
                    </div>
                )}

                {/* ONGLET CONFIGURATION (BOT DISCORD INCLUS) */}
                {activeTab === 'settings' && (
                    <div className="space-y-6">
                        <div>
                            <h2 className="text-2xl font-black text-white uppercase tracking-tight">Configuration Globale</h2>
                        </div>
                        <form onSubmit={saveConfig} className="bg-[#1c252e] p-6 rounded-xl border border-white/5 space-y-6">
                            <div>
                                <label className="text-xs text-gray-400 font-bold uppercase block mb-2">URL de l'application</label>
                                <p className="text-[10px] text-gray-500 mb-2">Le lien vers lequel les alertes Discord redirigeront.</p>
                                <input type="url" value={config.app_url || ''} onChange={e => setConfig({ ...config, app_url: e.target.value })} className="w-full bg-[#0f1923] text-white p-3 rounded border border-white/10 outline-none focus:border-[#ff4655] font-mono text-sm" required />
                            </div>
                            <hr className="border-white/5" />
                            <div>
                                <label className="text-xs text-gray-400 font-bold uppercase block mb-2">Date de début du suivi (Challenge)</label>
                                <p className="text-[10px] text-gray-500 mb-2">Les graphiques et statistiques du dashboard ignoreront les matchs joués avant cette date.</p>
                                <input type="datetime-local" value={config.challenge_start_date || ''} onChange={e => setConfig({ ...config, challenge_start_date: e.target.value })} className="w-full bg-[#0f1923] text-white p-3 rounded border border-white/10 outline-none focus:border-[#ff4655] font-mono text-sm" required />
                            </div>
                            <hr className="border-white/5" />

                            <div className="bg-[#0f1923] p-4 rounded-xl border border-[#5865F2]/30">
                                <h3 className="font-black text-[#5865F2] uppercase mb-4 flex items-center gap-2">
                                    <MessageSquare size={18} /> Configuration du Bot Discord
                                </h3>

                                <div className="space-y-4">
                                    <div>
                                        <label className="text-xs text-gray-400 font-bold uppercase block mb-1">Token du Bot (Optionnel car déjà inclus par défaut)</label>
                                        <input type="password" value={config.discord_bot_token || ''} onChange={e => setConfig({ ...config, discord_bot_token: e.target.value })} className="w-full bg-[#1c252e] text-white p-3 rounded border border-white/10 outline-none focus:border-[#5865F2]" />
                                    </div>

                                    <div>
                                        <label className="text-xs text-gray-400 font-bold uppercase block mb-1">ID du Salon Discord (Pour les alertes auto)</label>
                                        <p className="text-[10px] text-gray-500 mb-2">Faites Clic-Droit sur un salon textuel sur Discord {'>'} "Copier l'identifiant du salon". (Nécessite le Mode Développeur Discord activé).</p>
                                        <input type="text" placeholder="Ex: 1070058980836540467" value={config.discord_channel_id || ''} onChange={e => setConfig({ ...config, discord_channel_id: e.target.value })} className="w-full bg-[#1c252e] text-white p-3 rounded border border-white/10 outline-none focus:border-[#5865F2] font-mono" />
                                    </div>
                                </div>

                                <div className="mt-4 flex flex-wrap gap-2">
                                    <button type="button" onClick={async () => {
                                        try { await fetch(`${LOCAL_SERVER_URL}/test-send`); showMsg("Ping envoyé au bot ! Vérifiez Discord."); } catch (e) { showMsg("Erreur ping", "error"); }
                                    }} className="flex-1 bg-[#5865F2]/20 hover:bg-[#5865F2]/40 text-[#5865F2] font-bold py-2 rounded text-xs transition-colors text-center">Test Connexion Bot</button>
                                    <button type="button" onClick={async () => {
                                        try { await fetch(`${LOCAL_SERVER_URL}/test-match`); showMsg("Faux match envoyé !"); } catch (e) { showMsg("Erreur", "error"); }
                                    }} className="flex-1 bg-emerald-500/20 hover:bg-emerald-500/40 text-emerald-400 font-bold py-2 rounded text-xs transition-colors text-center">Test Faux Match</button>
                                    <button type="button" onClick={async () => {
                                        try { await fetch(`${LOCAL_SERVER_URL}/test-report`); showMsg("Faux rapport envoyé !"); } catch (e) { showMsg("Erreur", "error"); }
                                    }} className="flex-1 bg-purple-500/20 hover:bg-purple-500/40 text-purple-400 font-bold py-2 rounded text-xs transition-colors text-center">Test Rapport Quotidien</button>
                                </div>
                            </div>

                            <button type="submit" className="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-black py-3 rounded uppercase tracking-wider transition-colors mt-4">
                                Sauvegarder la configuration
                            </button>
                        </form>

                        <div className="bg-[#1c252e] p-6 rounded-xl border border-white/5 space-y-4">
                            <div>
                                <h3 className="font-black text-amber-400 uppercase mb-1">Maintenance : Backfill des noms</h3>
                                <p className="text-[11px] text-gray-500">
                                    Rejoue tous les matchs stockés et reconstruit les pseudonymes manquants depuis les kill events Riot. À utiliser une fois après l'ajout du fix puuid pour rattraper l'historique.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={async () => {
                                    if (!confirm("Lancer le backfill des noms sur tout l'historique ? Cela peut prendre plusieurs minutes.")) return;
                                    showMsg("Backfill en cours, patientez...", "success");
                                    try {
                                        const res = await fetch(`${LOCAL_SERVER_URL}/api/admin/backfill-names`, {
                                            method: 'POST', headers: authHeaders
                                        });
                                        const json = await res.json();
                                        if (!res.ok) throw new Error(json.error || 'Erreur');
                                        showMsg(`OK : ${json.fetched} matchs re-fetchés, ${json.updated} enregistrements mis à jour, ${json.skipped} déjà OK.`);
                                    } catch (e) {
                                        showMsg(`Erreur backfill : ${e.message}`, "error");
                                    }
                                }}
                                className="w-full bg-amber-500/20 hover:bg-amber-500/40 text-amber-400 font-black py-3 rounded uppercase tracking-wider transition-colors"
                            >
                                Lancer le backfill rétroactif des noms
                            </button>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
};

// ==========================================
// COMPOSANT : GESTION DES DONNÉES
// ==========================================
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

const DataManagement = ({ overview, loading, onReload, onDeleteFilter, onPurgeOrphans, onPurgeAll }) => {
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