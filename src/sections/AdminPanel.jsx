import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Shield, Key, Users, Settings, LogOut, Check, Trash2, Plus, Info, Trophy, X, ChevronLeft, Edit3, MessageSquare } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { LOCAL_SERVER_URL } from '../config/constants';

export const AdminPanel = () => {
    const [token, setToken] = useState(localStorage.getItem('adminToken'));
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
        } catch (err) {
            console.error("Erreur Fetch Admin:", err);
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

    const deletePlayer = async (id) => {
        if (!window.confirm("Supprimer ce joueur ?")) return;
        try {
            await fetch(`${LOCAL_SERVER_URL}/api/admin/players/${id}`, { method: 'DELETE', headers: authHeaders });
            fetchData();
        } catch (err) {
            console.error(err);
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
                            <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} minLength={6} className="w-full bg-[#0f1923] text-white p-3 rounded border border-white/10 outline-none focus:border-red-500" required />
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
                                                <button onClick={() => deletePlayer(p.id)} className="p-2 text-gray-500 hover:text-red-400 hover:bg-red-400/10 rounded transition-colors">
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