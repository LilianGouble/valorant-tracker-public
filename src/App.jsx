import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Crosshair, Swords, Trophy, Award, Cloud, BrainCircuit, Server,
  RefreshCw, AlertTriangle, Users, BarChart2, Handshake, Menu, User,
  X as CloseIcon, Target, Map as MapIcon, Skull, Send, Banknote, Zap, Settings
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Routes, Route, Navigate, useNavigate, useParams } from 'react-router-dom';

import { LOCAL_SERVER_URL } from './config/constants';
import { MatchDetailModal } from './components/UI';

// Import Sections
import { HallOfFameAndShame } from './sections/HallOfFame.jsx';
import { VersusMode } from './sections/VersusMode.jsx';
import { ServerWeather } from './sections/ServerWeather.jsx';
import { RoleAnalysis } from './sections/RoleAnalysis.jsx';
import { RushDashboard } from './sections/RushDashboard.jsx';
import { Leaderboard } from './sections/Leaderboard.jsx';
import { DeathmatchAnalysis } from './sections/DeathmatchAnalysis.jsx';
import { SynergyAnalysis } from './sections/SynergyAnalysis.jsx';
import { Arsenal } from './sections/Arsenal.jsx';
import { AgentAnalysis } from './sections/AgentAnalysis.jsx';
import { MapAnalysis } from './sections/MapAnalysis.jsx';
import { Nemesis } from './sections/Nemesis.jsx';
import { PlaystyleMatrix } from './sections/PlaystyleMatrix.jsx';
import { EcoRating } from './sections/EcoRating.jsx';
import { TDMChallenge } from './sections/TDMChallenge.jsx';
import { Spellcaster } from './sections/Spellcaster.jsx';
import { AdminPanel } from './sections/AdminPanel.jsx';
import { SkirmishAnalysis } from './sections/SkirmishAnalysis.jsx'; // <-- NOUVEL IMPORT ICI
import { Tournaments } from './sections/Tournaments.jsx'; // <--- AJOUTEZ CETTE LIGNE

const SidebarItem = ({ id, label, icon: Icon, activeTab, onNavigate, isMobile, setIsSidebarOpen }) => {
  const isActive = activeTab === id;
  return (
    <button
      onClick={() => {
        onNavigate(id);
        if (isMobile) setIsSidebarOpen(false);
      }}
      className={`w-full flex items-center justify-start px-4 py-3 rounded-xl transition-all duration-200 group relative overflow-hidden ${isActive
        ? 'bg-gradient-to-r from-[#ff4655] to-[#d93442] text-white shadow-lg shadow-[#ff4655]/20'
        : 'text-gray-400 hover:bg-white/5 hover:text-white'
        }`}
    >
      <Icon size={20} className={`flex-shrink-0 ${isActive ? 'text-white' : 'text-gray-400 group-hover:text-white'}`} />
      <span className={`font-bold text-sm tracking-wide whitespace-nowrap ml-3 ${isActive ? 'text-white' : ''}`}>
        {label}
      </span>
      {isActive && <motion.div layoutId="activeTabIndicator" className="absolute left-0 top-0 bottom-0 w-1 bg-white rounded-r" />}
    </button>
  );
};

const SkeletonLoader = () => (
  <div className="w-full space-y-6 animate-pulse px-4 md:px-0 mt-10">
    <div className="h-24 bg-white/5 rounded-2xl border border-white/5 w-full"></div>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div className="h-24 bg-white/5 rounded-xl border border-white/5"></div>
      <div className="h-24 bg-white/5 rounded-xl border border-white/5"></div>
      <div className="h-24 bg-white/5 rounded-xl border border-white/5"></div>
      <div className="h-24 bg-white/5 rounded-xl border border-white/5"></div>
    </div>
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mt-8">
      <div className="h-96 bg-white/5 rounded-2xl border border-white/5"></div>
      <div className="h-96 bg-white/5 rounded-2xl border border-white/5"></div>
    </div>
  </div>
);

function MainApp() {
  const { scope, tab } = useParams();
  const navigate = useNavigate();

  const activeTab = tab || 'rush';
  const selectedPlayerId = scope === 'global' ? 'all' : scope;

  const [selectedMatch, setSelectedMatch] = useState(null);
  const [matches, setMatches] = useState([]);

  const [playersConfig, setPlayersConfig] = useState([]);
  const [appUrl, setAppUrl] = useState('');
  const [challengeStartDate, setChallengeStartDate] = useState(null);

  const [loading, setLoading] = useState(true);
  const [refreshStatus, setRefreshStatus] = useState('');
  const [serverStatus, setServerStatus] = useState('unknown');

  const [isMobile, setIsMobile] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const isFetchingRef = useRef(false);

  useEffect(() => {
    const handleResize = () => {
      const width = window.innerWidth;
      if (width < 1280) {
        setIsMobile(true);
        setIsSidebarOpen(false);
      } else {
        setIsMobile(false);
        setIsSidebarOpen(true);
      }
    };
    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const loadData = useCallback(async () => {
    try {
      const configRes = await fetch(`${LOCAL_SERVER_URL}/api/public/config`);
      let validPlayerIds = new Set();

      if (configRes.ok) {
        const configData = await configRes.json();
        setPlayersConfig(configData.players || []);
        setAppUrl(configData.appUrl || '');
        setChallengeStartDate(configData.challengeStartDate);
        validPlayerIds = new Set((configData.players || []).map(p => p.id));
      }

      const res = await fetch(`${LOCAL_SERVER_URL}/history`);
      if (res.ok) {
        const data = await res.json();
        const cleanMatches = (data.matches || []).filter(m => validPlayerIds.has(m.playerId));
        setMatches(cleanMatches);
        setServerStatus('connected');
      } else {
        setServerStatus('disconnected');
      }
    } catch {
      setServerStatus('disconnected');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const forceRefreshFromRiot = useCallback(async () => {
    if (isFetchingRef.current) return;

    isFetchingRef.current = true;
    setLoading(true);
    setRefreshStatus('Recherche...');

    try {
      const response = await fetch(`${LOCAL_SERVER_URL}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId: selectedPlayerId })
      });

      if (response.status === 429) {
        setRefreshStatus('Scan en cours...');
        await new Promise(resolve => setTimeout(resolve, 3000));
      } else if (response.ok) {
        setRefreshStatus('Rechargement...');
      }

      await loadData();
      setRefreshStatus('À jour !');
    } catch (err) {
      console.error(err);
      setRefreshStatus('Erreur serveur !');
    } finally {
      setTimeout(() => {
        setLoading(false);
        setRefreshStatus('');
        isFetchingRef.current = false;
      }, 2000);
    }
  }, [selectedPlayerId, loadData]);

  const filteredData = useMemo(() => {
    let data = matches;
    if (selectedPlayerId !== 'all') {
      data = data.filter(m => m.playerId === selectedPlayerId);
    }
    if (challengeStartDate) {
      const startDate = new Date(challengeStartDate).getTime();
      data = data.filter(m => {
        const matchTime = m.timestamp ? m.timestamp * 1000 : new Date(m.date).getTime();
        return matchTime >= startDate;
      });
    }
    return data.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  }, [selectedPlayerId, matches, challengeStartDate]);

  const handlePlayerChange = (e) => {
    const newScope = e.target.value === 'all' ? 'global' : e.target.value;
    navigate(`/${newScope}/${activeTab}`);
  };

  const handleTabChange = (newTab) => {
    navigate(`/${scope}/${newTab}`);
  };

  const isInitialLoading = loading && matches.length === 0;

  if (!loading && playersConfig.length === 0) {
    return (
      <div className="min-h-screen bg-[#0f1923] flex items-center justify-center p-4">
        <div className="text-center space-y-6 bg-[#1c252e] p-10 rounded-2xl border border-white/10 shadow-2xl max-w-lg">
          <div className="mx-auto w-16 h-16 bg-[#ff4655] rounded-xl flex items-center justify-center rotate-3 shadow-[0_0_30px_rgba(255,70,85,0.4)]">
            <Crosshair size={32} className="text-white" />
          </div>
          <h1 className="text-3xl font-black text-white italic uppercase tracking-tighter">Installation Réussie !</h1>
          <p className="text-gray-400 text-sm">Le Tracker est en ligne. Il ne vous reste plus qu'à configurer vos clés API Riot et ajouter vos amis pour commencer le suivi.</p>
          <button onClick={() => navigate('/admin')} className="bg-white/10 hover:bg-white/20 text-white font-bold py-3 px-8 rounded-lg flex items-center gap-2 mx-auto transition-colors">
            <Settings size={18} /> Accéder au Panel Admin
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[100dvh] w-full bg-[#0f1923] text-gray-100 font-sans selection:bg-[#ff4655] selection:text-white flex flex-col xl:flex-row overflow-hidden relative">
      <div className="fixed inset-0 z-0 pointer-events-none opacity-20">
        <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-[#ff4655]/10 via-[#0f1923] to-[#0f1923]"></div>
        <div className="absolute -top-20 -left-20 w-96 h-96 bg-[#ff4655] rounded-full blur-[128px]"></div>
      </div>

      {isMobile && isSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      <motion.aside
        initial={false}
        animate={{ x: isMobile ? (isSidebarOpen ? 0 : '-100%') : 0 }}
        transition={{ duration: 0.3, ease: "easeInOut" }}
        className={`bg-[#1c252e]/95 backdrop-blur-xl border-r border-white/5 shrink-0 z-50 flex flex-col h-[100dvh] w-[288px] ${isMobile ? 'fixed top-0 left-0 shadow-2xl' : 'relative'}`}
      >
        <div className="p-6 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-[#ff4655] p-2 rounded-lg shadow-[0_0_15px_rgba(255,70,85,0.4)] shrink-0">
              <Crosshair size={24} className="text-white" />
            </div>
            <h1 className="text-xl font-black tracking-tighter uppercase italic text-white drop-shadow-md whitespace-nowrap">
              KSL<span className="text-[#ff4655]">TRACKER</span>
            </h1>
          </div>
          {isMobile && (
            <button onClick={() => setIsSidebarOpen(false)} className="text-gray-400 hover:text-white shrink-0 ml-2 p-1 bg-white/5 rounded-lg">
              <CloseIcon size={20} />
            </button>
          )}
        </div>

        <div className="flex-grow py-6 px-3 space-y-1.5 overflow-y-auto custom-scrollbar">
          <SidebarItem id="rush" label="RUSH IMMORTAL" icon={Trophy} activeTab={activeTab} onNavigate={handleTabChange} isMobile={isMobile} setIsSidebarOpen={setIsSidebarOpen} />
          {/* NOUVEAU MENU SKIRMISH ICI */}
          <SidebarItem id="skirmish" label="SKIRMISH 2V2" icon={Users} activeTab={activeTab} onNavigate={handleTabChange} isMobile={isMobile} setIsSidebarOpen={setIsSidebarOpen} />

          <SidebarItem id="deathmatch" label="DEATHMATCH 100" icon={Swords} activeTab={activeTab} onNavigate={handleTabChange} isMobile={isMobile} setIsSidebarOpen={setIsSidebarOpen} />
          <SidebarItem id="tdm" label="DÉFI 100 TDM" icon={Target} activeTab={activeTab} onNavigate={handleTabChange} isMobile={isMobile} setIsSidebarOpen={setIsSidebarOpen} />
          <div className="my-4 border-t border-white/5 mx-2"></div>
          <SidebarItem id="tournaments" label="TOURNOIS KSL" icon={Trophy} activeTab={activeTab} onNavigate={handleTabChange} isMobile={isMobile} setIsSidebarOpen={setIsSidebarOpen} />
          <SidebarItem id="leaderboard" label="CLASSEMENTS" icon={BarChart2} activeTab={activeTab} onNavigate={handleTabChange} isMobile={isMobile} setIsSidebarOpen={setIsSidebarOpen} />
          <SidebarItem id="agents" label="AGENTS" icon={User} activeTab={activeTab} onNavigate={handleTabChange} isMobile={isMobile} setIsSidebarOpen={setIsSidebarOpen} />
          <SidebarItem id="arsenal" label="ARSENAL" icon={Target} activeTab={activeTab} onNavigate={handleTabChange} isMobile={isMobile} setIsSidebarOpen={setIsSidebarOpen} />
          <SidebarItem id="maps" label="CARTOGRAPHIE" icon={MapIcon} activeTab={activeTab} onNavigate={handleTabChange} isMobile={isMobile} setIsSidebarOpen={setIsSidebarOpen} />
          <SidebarItem id="nemesis" label="NÉMÉSIS" icon={Skull} activeTab={activeTab} onNavigate={handleTabChange} isMobile={isMobile} setIsSidebarOpen={setIsSidebarOpen} />
          <SidebarItem id="synergy" label="SYNERGIES" icon={Handshake} activeTab={activeTab} onNavigate={handleTabChange} isMobile={isMobile} setIsSidebarOpen={setIsSidebarOpen} />
          <div className="my-4 border-t border-white/5 mx-2"></div>
          <SidebarItem id="shame" label="HALL OF FAME" icon={Award} activeTab={activeTab} onNavigate={handleTabChange} isMobile={isMobile} setIsSidebarOpen={setIsSidebarOpen} />
          <SidebarItem id="versus" label="VERSUS" icon={Swords} activeTab={activeTab} onNavigate={handleTabChange} isMobile={isMobile} setIsSidebarOpen={setIsSidebarOpen} />
          <div className="my-4 border-t border-white/5 mx-2"></div>
          <SidebarItem id="weather" label="MÉTÉO" icon={Cloud} activeTab={activeTab} onNavigate={handleTabChange} isMobile={isMobile} setIsSidebarOpen={setIsSidebarOpen} />
          <SidebarItem id="roles" label="TACTIQUE" icon={BrainCircuit} activeTab={activeTab} onNavigate={handleTabChange} isMobile={isMobile} setIsSidebarOpen={setIsSidebarOpen} />
          <SidebarItem id="matrix" label="MATRICE DU STYLE" icon={Crosshair} activeTab={activeTab} onNavigate={handleTabChange} isMobile={isMobile} setIsSidebarOpen={setIsSidebarOpen} />
          <SidebarItem id="eco" label="L'ÉCONOMIE" icon={Banknote} activeTab={activeTab} onNavigate={handleTabChange} isMobile={isMobile} setIsSidebarOpen={setIsSidebarOpen} />
          <SidebarItem id="spells" label="SPELLCASTER" icon={Zap} activeTab={activeTab} onNavigate={handleTabChange} isMobile={isMobile} setIsSidebarOpen={setIsSidebarOpen} />
        </div>

        <div className="p-4 border-t border-white/5 bg-black/20 space-y-4">
          <div className="relative">
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"><Users size={14} /></div>
            <select
              value={selectedPlayerId}
              onChange={handlePlayerChange}
              className="w-full bg-[#0f1923] text-white text-xs font-bold py-3 pl-9 pr-4 rounded-xl border border-white/10 outline-none focus:border-[#ff4655]/50 appearance-none hover:bg-[#1a2733] transition-colors cursor-pointer uppercase"
            >
              <option value="all">TOUS LES JOUEURS</option>
              {playersConfig.map(p => <option key={p.id} value={p.id}>{p.name.toUpperCase()}</option>)}
            </select>
          </div>

          <button
            onClick={() => forceRefreshFromRiot()}
            disabled={loading}
            className="w-full bg-gradient-to-r from-[#ff4655] to-[#d93442] hover:from-[#e03543] hover:to-[#bf2d3a] text-white rounded-xl flex flex-col items-center justify-center gap-1 py-3 text-xs font-black transition-all shadow-lg shadow-[#ff4655]/20 disabled:opacity-80 disabled:cursor-wait"
          >
            {loading ? (
              <>
                <div className="flex items-center gap-2 justify-center">
                  <RefreshCw size={14} className="animate-spin" />
                  TRAITEMENT...
                </div>
                {refreshStatus && (
                  <div className="text-[9px] text-white/80 font-bold uppercase tracking-wider text-center px-1">{refreshStatus}</div>
                )}
              </>
            ) : (
              <div className="flex items-center gap-2 justify-center">
                <RefreshCw size={14} />
                RAFRAÎCHIR LES STATS
              </div>
            )}
          </button>

          <div className="flex justify-between items-center px-2">
            <div title={serverStatus === 'connected' ? "Serveur Connecté" : "Serveur Déconnecté"} className={`flex items-center gap-2 text-[10px] font-bold ${serverStatus === 'connected' ? 'text-emerald-400' : 'text-red-400'}`}>
              <div className={`w-2 h-2 rounded-full ${serverStatus === 'connected' ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`}></div>
              {serverStatus === 'connected' ? 'EN LIGNE' : 'HORS LIGNE'}
            </div>
            <button onClick={() => navigate('/admin')} title="Administration" className="text-gray-500 hover:text-white transition-colors">
              <Settings size={14} />
            </button>
          </div>
        </div>
      </motion.aside>

      {isMobile && (
        <div className="fixed top-4 left-4 z-40">
          <button onClick={() => setIsSidebarOpen(true)} className="bg-[#1c252e]/90 p-2.5 rounded-xl border border-white/10 text-white shadow-[0_0_15px_rgba(0,0,0,0.5)] backdrop-blur-md hover:bg-white/10 transition-colors">
            <Menu size={24} />
          </button>
        </div>
      )}

      <div className="flex-grow min-w-0 h-[100dvh] overflow-y-auto overflow-x-hidden relative z-0 custom-scrollbar">
        <div className={`p-4 sm:p-6 md:p-8 xl:p-10 w-full max-w-[1600px] mx-auto pb-24 transition-all duration-300 ${isMobile ? 'pt-20' : 'pt-6 xl:pt-10'}`}>
          {selectedMatch && <MatchDetailModal match={selectedMatch} playersConfig={playersConfig} onClose={() => setSelectedMatch(null)} />}

          {isInitialLoading ? (
            <SkeletonLoader />
          ) : (
            <AnimatePresence mode="wait">
              {activeTab === 'rush' && (
                <motion.div key="rush" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
                  <RushDashboard matches={matches} filteredData={filteredData} selectedPlayerId={selectedPlayerId} playersConfig={playersConfig} challengeStartDate={challengeStartDate} onSelectMatch={setSelectedMatch} />
                </motion.div>
              )}
              {/* NOUVELLE VUE SKIRMISH ICI */}
              {activeTab === 'skirmish' && (
                <motion.div key="skirmish" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
                  <SkirmishAnalysis matches={matches} selectedPlayerId={selectedPlayerId} playersConfig={playersConfig} challengeStartDate={challengeStartDate} />
                </motion.div>
              )}

              {activeTab === 'deathmatch' && (
                <motion.div key="dm" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
                  <DeathmatchAnalysis matches={matches} selectedPlayerId={selectedPlayerId} playersConfig={playersConfig} />
                </motion.div>
              )}
              {activeTab === 'tdm' && (
                <motion.div key="tdm" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
                  <TDMChallenge matches={matches} playersConfig={playersConfig} />
                </motion.div>
              )}
              {activeTab === 'tournaments' && (
                <motion.div key="tournaments" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
                  <Tournaments />
                </motion.div>
              )}
              {activeTab === 'leaderboard' && (
                <motion.div key="lead" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
                  <Leaderboard matches={matches} playersConfig={playersConfig} challengeStartDate={challengeStartDate} />
                </motion.div>
              )}
              {activeTab === 'agents' && (
                <motion.div key="agents" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
                  <AgentAnalysis matches={matches} selectedPlayerId={selectedPlayerId} playersConfig={playersConfig} />
                </motion.div>
              )}
              {activeTab === 'arsenal' && (
                <motion.div key="arsenal" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
                  <Arsenal matches={matches} selectedPlayerId={selectedPlayerId} playersConfig={playersConfig} challengeStartDate={challengeStartDate} />
                </motion.div>
              )}
              {activeTab === 'maps' && (
                <motion.div key="maps" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
                  <MapAnalysis matches={matches} playersConfig={playersConfig} challengeStartDate={challengeStartDate} />
                </motion.div>
              )}
              {activeTab === 'nemesis' && (
                <motion.div key="nemesis" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
                  <Nemesis matches={matches} selectedPlayerId={selectedPlayerId} playersConfig={playersConfig} />
                </motion.div>
              )}
              {activeTab === 'synergy' && (
                <motion.div key="synergy" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
                  <SynergyAnalysis matches={matches} playersConfig={playersConfig} challengeStartDate={challengeStartDate} />
                </motion.div>
              )}
              {activeTab === 'shame' && (
                <motion.div key="shame" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
                  <HallOfFameAndShame matches={matches} playersConfig={playersConfig} challengeStartDate={challengeStartDate} />
                </motion.div>
              )}
              {activeTab === 'versus' && (
                <motion.div key="vs" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
                  <VersusMode matches={matches} players={playersConfig} challengeStartDate={challengeStartDate} />
                </motion.div>
              )}
              {activeTab === 'weather' && (
                <motion.div key="weather" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
                  <ServerWeather matches={matches} playersConfig={playersConfig} />
                </motion.div>
              )}
              {activeTab === 'roles' && (
                <motion.div key="roles" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
                  <RoleAnalysis matches={matches} selectedPlayerId={selectedPlayerId} playersConfig={playersConfig} challengeStartDate={challengeStartDate} />
                </motion.div>
              )}
              {activeTab === 'matrix' && (
                <motion.div key="matrix" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
                  <PlaystyleMatrix matches={matches} playersConfig={playersConfig} challengeStartDate={challengeStartDate} />
                </motion.div>
              )}
              {activeTab === 'eco' && (
                <motion.div key="eco" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
                  <EcoRating matches={matches} playersConfig={playersConfig} challengeStartDate={challengeStartDate} />
                </motion.div>
              )}
              {activeTab === 'spells' && (
                <motion.div key="spells" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
                  <Spellcaster matches={matches} playersConfig={playersConfig} challengeStartDate={challengeStartDate} />
                </motion.div>
              )}
            </AnimatePresence>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AppWrapper() {
  return (
    <Routes>
      <Route path="/admin" element={<AdminPanel />} />
      <Route path="/" element={<Navigate to="/global/rush" replace />} />
      <Route path="/:scope/:tab" element={<MainApp />} />
      <Route path="/:scope" element={<Navigate to={`/:scope/rush`} replace />} />
    </Routes>
  );
}