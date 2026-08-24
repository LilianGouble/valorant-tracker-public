import React, { useState } from 'react';
import { Swords, Target } from 'lucide-react';
import { DeathmatchAnalysis } from './DeathmatchAnalysis';
import { TDMChallenge } from './TDMChallenge';

// Page "Entraînement" : regroupe les modes hors-ranked (Deathmatch & TDM) sous
// un seul onglet, avec un sous-onglet pour chaque. Évite de saturer la sidebar
// tout en gardant les deux analyses intactes.
export const Training = ({ matches, selectedPlayerId, playersConfig }) => {
    const [tab, setTab] = useState('deathmatch');

    const tabs = [
        { id: 'deathmatch', label: 'Deathmatch', icon: Swords },
        { id: 'tdm', label: 'Défi 100 TDM', icon: Target },
    ];

    return (
        <div className="space-y-6">
            {/* Sous-navigation */}
            <div className="flex gap-2 border-b border-white/10 pb-3">
                {tabs.map(t => {
                    const Icon = t.icon;
                    const active = tab === t.id;
                    return (
                        <button key={t.id} onClick={() => setTab(t.id)}
                            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-black uppercase tracking-wide transition-all ${active ? 'bg-gradient-to-r from-[#ff4655] to-[#d93442] text-white shadow-lg shadow-[#ff4655]/20' : 'text-gray-400 hover:bg-white/5 hover:text-white'}`}>
                            <Icon size={16} /> {t.label}
                        </button>
                    );
                })}
            </div>

            {tab === 'deathmatch'
                ? <DeathmatchAnalysis matches={matches} selectedPlayerId={selectedPlayerId} playersConfig={playersConfig} />
                : <TDMChallenge matches={matches} playersConfig={playersConfig} />}
        </div>
    );
};
