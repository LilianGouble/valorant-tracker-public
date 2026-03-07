import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Shield, Key, Users, Settings, LogOut, Check, Trash2, Plus, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { LOCAL_SERVER_URL } from '../config/constants';

export const AdminPanel = () => {
    const [token, setToken] = useState(localStorage.getItem('adminToken'));
    const [needsPasswordChange, setNeedsPasswordChange] = useState(false);
    const [activeTab, setActiveTab] = useState('players');

    // --- ÉTATS FORMULAIRES ---
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');

    // --- DONNÉES API ---
    const [players, setPlayers] = useState([]);
    const [keys, setKeys] = useState([]);
    const [config, setConfig] = useState({ webhook_url: '', app_url: '', challenge_start_date: '' });

    // --- FORMULAIRES AJOUT ---
    const [newPlayer, setNewPlayer] = useState({ name: '', tag: '', region: 'eu', color: '#ff4655' });
    const [newKey, setNewKey] = useState('');

    // --- MESSAGES ---
    const [msg, setMsg] = useState({ text: '', type: '' });

    const showMsg = (text, type = 'success') => {
        setMsg({ text, type });
        setTimeout(() => setMsg({ text: '', type: '' }), 3000);
    };

    const authHeaders = useMemo(() => ({
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
    }), [token]);

    // --- LOGIN & AUTH ---
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

    // --- FETCH DATA ---
    const fetchData = useCallback(async () => {
        if (!token) return;
        try {
            const [pRes, kRes, cRes] = await Promise.all([
                fetch(`${LOCAL_SERVER_URL}/api/admin/players`, { headers: authHeaders }),
                fetch(`${LOCAL_SERVER_URL}/api/admin/keys`, { headers: authHeaders }),
                fetch(`${LOCAL_SERVER_URL}/api/admin/config`, { headers: authHeaders })
            ]);

            if (pRes.status === 401 || pRes.status === 403) return handleLogout();

            setPlayers(await pRes.json());
            setKeys(await kRes.json());
            setConfig(await cRes.json());
        } catch (err) {
            console.error("Erreur Fetch Admin:", err);
        }
    }, [token, authHeaders, handleLogout]);

    useEffect(() => {
        fetchData();
    }, [fetchData, activeTab]);

    // --- ACTIONS JOUEURS ---
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
                setNewPlayer({ name: '', tag: '', region: 'eu', color: '#ff4655' });
                fetchData();
            }
        } catch (err) {
            console.error("Erreur lors de l'ajout du joueur :", err);
        }
    };

    const deletePlayer = async (id) => {
        if (!window.confirm("Supprimer ce joueur ?")) return;
        try {
            await fetch(`${LOCAL_SERVER_URL}/api/admin/players/${id}`, { method: 'DELETE', headers: authHeaders });
            fetchData();
        } catch (err) {
            console.error("Erreur lors de la suppression du joueur :", err);
        }
    };

    // --- ACTIONS CLÉS ---
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
            console.error("Erreur lors de l'ajout de la clé :", err);
        }
    };

    const deleteKey = async (id) => {
        try {
            await fetch(`${LOCAL_SERVER_URL}/api/admin/keys/${id}`, { method: 'DELETE', headers: authHeaders });
            fetchData();
        } catch (err) {
            console.error("Erreur lors de la suppression de la clé :", err);
        }
    };

    // --- ACTIONS CONFIG ---
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
            console.error("Erreur lors de la sauvegarde de la config :", err);
        }
    };

    // ==========================================
    // VUE NON CONNECTÉE (LOGIN)
    // ==========================================
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

    // ==========================================
    // VUE CHANGEMENT MOT DE PASSE FORCÉ
    // ==========================================
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

    // ==========================================
    // VUE PANEL ADMIN
    // ==========================================
    return (
        <div className="min-h-screen bg-[#0f1923] text-gray-100 font-sans flex flex-col md:flex-row">
            {/* SIDEBAR ADMIN */}
            <aside className="w-full md:w-64 bg-[#1c252e] border-r border-white/5 p-6 flex flex-col shrink-0">
                <div className="flex items-center gap-3 mb-10 text-white">
                    <Shield className="text-[#ff4655]" size={28} />
                    <h1 className="text-xl font-black uppercase italic tracking-tighter leading-none">Admin<br /><span className="text-[#ff4655] text-sm">Tracker</span></h1>
                </div>

                <nav className="space-y-2 flex-grow">
                    <button onClick={() => setActiveTab('players')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-bold transition-colors ${activeTab === 'players' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white'}`}>
                        <Users size={18} /> Gérer les Joueurs
                    </button>
                    <button onClick={() => setActiveTab('keys')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-bold transition-colors ${activeTab === 'keys' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white'}`}>
                        <Key size={18} /> Clés API Riot
                    </button>
                    <button onClick={() => setActiveTab('settings')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-bold transition-colors ${activeTab === 'settings' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white'}`}>
                        <Settings size={18} /> Configuration
                    </button>
                </nav>

                <div className="mt-auto pt-6 border-t border-white/5">
                    <button onClick={() => { window.location.href = "/" }} className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 rounded text-sm text-gray-300 font-bold mb-2 transition-colors">
                        Retour au site
                    </button>
                    <button onClick={handleLogout} className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 rounded text-sm text-red-400 font-bold transition-colors">
                        <LogOut size={16} /> Déconnexion
                    </button>
                </div>
            </aside>

            {/* CONTENU PRINCIPAL */}
            <main className="flex-grow p-6 md:p-10 max-w-5xl overflow-y-auto">

                {/* ALERTS */}
                <AnimatePresence>
                    {msg.text && (
                        <motion.div
                            initial={{ opacity: 0, y: -20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -20 }}
                            className={`fixed top-4 right-4 z-50 px-6 py-3 rounded shadow-xl font-bold flex items-center gap-2 ${msg.type === 'error' ? 'bg-red-500 text-white' : 'bg-emerald-500 text-white'}`}
                        >
                            <Check size={18} /> {msg.text}
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* ONGLET JOUEURS */}
                {activeTab === 'players' && (
                    <div className="space-y-6">
                        <div>
                            <h2 className="text-2xl font-black text-white uppercase tracking-tight">Liste des Joueurs ({players.length})</h2>
                            <p className="text-gray-400 text-sm mt-1">Ajoutez les joueurs dont vous souhaitez récupérer les statistiques.</p>
                        </div>

                        <div className="bg-[#1c252e] p-6 rounded-xl border border-white/5">
                            <h3 className="font-bold text-white mb-4 flex items-center gap-2"><Plus size={18} /> Ajouter un joueur</h3>
                            <form onSubmit={addPlayer} className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
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
                                <button type="submit" className="bg-[#ff4655] hover:bg-[#d93442] text-white font-bold h-10 rounded transition-colors">Ajouter</button>
                            </form>
                        </div>

                        <div className="bg-[#1c252e] rounded-xl border border-white/5 overflow-hidden">
                            {players.map(p => (
                                <div key={p.id} className="flex items-center justify-between p-4 border-b border-white/5 hover:bg-white/5 transition-colors">
                                    <div className="flex items-center gap-3">
                                        <div className="w-4 h-4 rounded-full" style={{ backgroundColor: p.color }}></div>
                                        <div>
                                            <div className="font-bold text-white leading-none">{p.name} <span className="text-gray-500 text-xs">#{p.tag}</span></div>
                                            <div className="text-[10px] text-gray-500 font-mono mt-1">ID: {p.id}</div>
                                        </div>
                                    </div>
                                    <button onClick={() => deletePlayer(p.id)} className="p-2 text-gray-500 hover:text-red-400 hover:bg-red-400/10 rounded transition-colors">
                                        <Trash2 size={18} />
                                    </button>
                                </div>
                            ))}
                            {players.length === 0 && <div className="p-6 text-center text-gray-500 text-sm">Aucun joueur enregistré.</div>}
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

                {/* ONGLET CONFIGURATION */}
                {activeTab === 'settings' && (
                    <div className="space-y-6">
                        <div>
                            <h2 className="text-2xl font-black text-white uppercase tracking-tight">Configuration Globale</h2>
                        </div>

                        <form onSubmit={saveConfig} className="bg-[#1c252e] p-6 rounded-xl border border-white/5 space-y-6">

                            {/* URL APP */}
                            <div>
                                <label className="text-xs text-gray-400 font-bold uppercase block mb-2">
                                    URL de l'application
                                </label>
                                <p className="text-[10px] text-gray-500 mb-2">Le lien vers lequel les alertes Discord redirigeront. (Ex: https://mon-tracker.com)</p>
                                <input type="url" value={config.app_url || ''} onChange={e => setConfig({ ...config, app_url: e.target.value })} className="w-full bg-[#0f1923] text-white p-3 rounded border border-white/10 outline-none focus:border-[#ff4655] font-mono text-sm" required />
                            </div>

                            <hr className="border-white/5" />

                            {/* DATE CHALLENGE */}
                            <div>
                                <label className="text-xs text-gray-400 font-bold uppercase block mb-2">
                                    Date de début du suivi (Challenge)
                                </label>
                                <p className="text-[10px] text-gray-500 mb-2">Les graphiques et statistiques du dashboard ignoreront les matchs joués avant cette date.</p>
                                <input type="datetime-local" value={config.challenge_start_date || ''} onChange={e => setConfig({ ...config, challenge_start_date: e.target.value })} className="w-full bg-[#0f1923] text-white p-3 rounded border border-white/10 outline-none focus:border-[#ff4655] font-mono text-sm" required />
                            </div>

                            <hr className="border-white/5" />

                            {/* WEBHOOK DISCORD */}
                            <div>
                                <label className="text-xs text-gray-400 font-bold uppercase block mb-2">
                                    Webhook Discord
                                </label>
                                <div className="bg-white/5 border border-white/10 p-3 rounded mb-3 text-xs text-gray-400">
                                    <strong className="text-white block mb-1">Comment créer un Webhook ?</strong>
                                    1. Sur Discord, clic droit sur votre salon textuel {'>'} Modifier le salon.<br />
                                    2. Allez dans Intégrations {'>'} Voir les webhooks {'>'} Nouveau webhook.<br />
                                    3. Copiez l'URL du webhook et collez-la ci-dessous.
                                </div>
                                <input type="url" placeholder="https://discord.com/api/webhooks/..." value={config.webhook_url || ''} onChange={e => setConfig({ ...config, webhook_url: e.target.value })} className="w-full bg-[#0f1923] text-white p-3 rounded border border-white/10 outline-none focus:border-indigo-500 font-mono text-sm" />

                                <div className="mt-3 flex flex-wrap gap-2">
                                    <button type="button" onClick={async () => {
                                        try { await fetch(`${LOCAL_SERVER_URL}/test-match`); showMsg("Faux match envoyé sur Discord !"); } catch (e) { console.error("Erreur test match:", e); }
                                    }} className="px-4 py-2 bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500/40 rounded text-xs font-bold transition-colors">Test Fin de Match</button>
                                    <button type="button" onClick={async () => {
                                        try { await fetch(`${LOCAL_SERVER_URL}/test-report`); showMsg("Faux rapport envoyé sur Discord !"); } catch (e) { console.error("Erreur test rapport:", e); }
                                    }} className="px-4 py-2 bg-purple-500/20 text-purple-400 hover:bg-purple-500/40 rounded text-xs font-bold transition-colors">Test Rapport Quotidien</button>
                                </div>
                            </div>

                            <button type="submit" className="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-black py-3 rounded uppercase tracking-wider transition-colors mt-4">
                                Sauvegarder la configuration
                            </button>
                        </form>
                    </div>
                )}
            </main>
        </div>
    );
};