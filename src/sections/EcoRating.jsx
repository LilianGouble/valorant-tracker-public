import React, { useMemo, useState } from 'react';
import { Card, StatPodium } from '../components/UI';
import { Coins, HandCoins, Landmark, Percent, PieChart, ShieldAlert, ShieldCheck, Wallet } from 'lucide-react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell, LabelList
} from 'recharts';

const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
        const data = payload[0].payload;
        return (
            <div className="bg-[#1c252e] border border-white/10 p-3 rounded-lg shadow-xl text-xs">
                <div className="font-black text-white uppercase mb-1">{data.name}</div>
                <div className="text-gray-300">
                    Dégâts / Crédit : <span className="font-bold text-emerald-400">{data.value.toFixed(2)}</span>
                </div>
                <div className="text-[10px] text-gray-500 mt-1">
                    {data.damage.toLocaleString()} DMG pour {data.spent.toLocaleString()} ¤
                </div>
            </div>
        );
    }
    return null;
};

export const EcoRating = ({ matches, playersConfig }) => {
    const [viewMode, setViewMode] = useState('global');

    const ecoStats = useMemo(() => {
        const playerStats = {};

        // Initialisation avec les joueurs dynamiques
        playersConfig.forEach(p => {
            playerStats[p.id] = { ...p, damage: 0, spent: 0 };
        });

        matches.forEach(m => {
            // On ne prend que les matchs classés
            if (m.type !== 'ranked') return;

            if (playerStats[m.playerId]) {
                const p = playerStats[m.playerId];

                // 1. Dégâts (ADR * Rounds)
                const damage = (m.adr || 0) * (m.roundsPlayed || 1);
                p.damage += damage;

                // 2. Argent dépensé (Economy)
                const avgSpent = (m.economy && m.economy.avgSpent) ? m.economy.avgSpent : 0;
                const totalSpent = avgSpent * (m.roundsPlayed || 1);

                p.spent += totalSpent;
            }
        });

        return Object.values(playerStats)
            .map(p => {
                // On ignore ceux qui n'ont pas assez dépensé (pas joué ou données manquantes)
                if (p.spent < 5000) return null;

                const ratio = p.damage / p.spent;
                return {
                    name: p.name,
                    value: ratio * 1000, // Score x1000 pour lisibilité (ex: 1.5 -> 1500)
                    damage: p.damage,
                    spent: p.spent,
                    fill: p.color
                };
            })
            .filter(Boolean)
            .sort((a, b) => b.value - a.value);
    }, [matches, viewMode, playersConfig]);

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="flex items-center gap-4 mb-4">
                <div className="p-3 bg-gradient-to-br from-emerald-600 to-teal-700 rounded-xl shadow-lg">
                    <Wallet size={32} className="text-white" />
                </div>
                <div>
                    <h2 className="text-4xl font-black text-white italic tracking-tighter uppercase">WALL STREET</h2>
                    <p className="text-gray-400 font-medium uppercase tracking-widest text-xs">Rentabilité : Dégâts par Crédit dépensé</p>
                </div>
            </div>

            {ecoStats.length > 0 ? (
                <Card className="p-6 bg-[#1c252e] border-t-4 border-t-emerald-500">
                    <div className="h-[500px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={ecoStats} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                                <XAxis type="number" hide />
                                <YAxis type="category" dataKey="name" width={120} tick={{ fill: '#fff', fontSize: 11, fontWeight: 'bold' }} axisLine={false} tickLine={false} />
                                <Tooltip content={<CustomTooltip />} cursor={{ fill: '#ffffff10' }} />
                                <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={30}>
                                    {ecoStats.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.fill} />
                                    ))}
                                    <LabelList dataKey="value" position="right" formatter={(v) => v.toFixed(0)} style={{ fill: '#fff', fontWeight: 'bold' }} />
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </Card>
            ) : (
                <div className="text-center text-gray-500 py-12 italic">
                    Pas assez de données économiques pour le moment. Rafraîchissez après quelques parties !
                </div>
            )}
        </div>
    );
};