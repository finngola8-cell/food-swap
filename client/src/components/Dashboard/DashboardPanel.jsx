import React, { useState } from 'react';
import { useEmpireStore } from '../../stores/empireStore';
import { TrendingUp, TrendingDown, Users, Package, Zap, Store } from 'lucide-react';

function fmt(n) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

const ROLE_COLORS = {
  designer: 'bg-purple-500',
  lister: 'bg-blue-500',
  support: 'bg-green-500',
  marketer: 'bg-orange-500',
};

const STATUS_DOT = {
  active: 'bg-empire-green blink',
  idle: 'bg-slate-500',
  error: 'bg-empire-red blink',
};

export default function DashboardPanel() {
  const { stats, agents, triggerAgent } = useEmpireStore();
  const profit = stats.netProfit ?? 0;
  const [triggering, setTriggering] = useState(null);

  const handleTrigger = async (agentId) => {
    setTriggering(agentId);
    await triggerAgent(agentId);
    setTimeout(() => setTriggering(null), 2000);
  };

  return (
    <div className="bg-empire-panel border-b border-empire-border p-4 overflow-y-auto flex-shrink-0">
      <div className="text-xs font-pixel text-empire-accent mb-4">HQ DASHBOARD</div>

      {/* Key metrics */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        <Metric icon={<TrendingUp size={14} />} label="Revenue" value={fmt(stats.totalRevenue)} color="text-empire-green" />
        <Metric icon={<TrendingDown size={14} />} label="Spend" value={fmt(stats.totalExpenses)} color="text-empire-red" />
        <Metric
          icon={profit >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
          label="Net Profit"
          value={(profit >= 0 ? '+' : '') + fmt(profit)}
          color={profit >= 0 ? 'text-empire-green' : 'text-empire-red'}
          wide
        />
        <Metric icon={<Users size={14} />} label="Agents" value={`${stats.activeAgents ?? 0}/${stats.totalAgents ?? 4}`} color="text-empire-accent" />
        <Metric icon={<Store size={14} />} label="Divisions" value={stats.divisions ?? 1} color="text-empire-gold" />
        <Metric icon={<Package size={14} />} label="Listings" value={stats.listings?.published ?? 0} color="text-empire-accent" />
      </div>

      {/* Listing breakdown */}
      {stats.listings?.total > 0 && (
        <div className="mb-4 bg-empire-surface rounded p-2 text-xs text-slate-400">
          <div className="flex justify-between mb-1">
            <span>Published</span><span className="text-empire-green">{stats.listings.published}</span>
          </div>
          <div className="flex justify-between mb-1">
            <span>Draft</span><span className="text-slate-300">{stats.listings.draft}</span>
          </div>
          <div className="flex justify-between">
            <span>Pending Approval</span><span className="text-empire-gold">{stats.listings.pending}</span>
          </div>
        </div>
      )}

      {/* Agent cards */}
      <div className="text-xs font-pixel text-slate-400 mb-2 mt-4">AGENTS</div>
      <div className="space-y-2">
        {agents.map((agent) => (
          <div key={agent.id} className="bg-empire-surface rounded p-2 border border-empire-border">
            <div className="flex items-center gap-2 mb-1">
              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[agent.status] ?? 'bg-slate-500'}`} />
              <span className={`text-xs font-bold rounded px-1 text-white ${ROLE_COLORS[agent.role] ?? 'bg-slate-600'}`}>
                {agent.role?.toUpperCase()}
              </span>
              <span className="text-xs text-slate-300 truncate">{agent.name}</span>
            </div>
            {agent.current_task && (
              <div className="text-xs text-slate-500 truncate ml-4 mb-1">{agent.current_task}</div>
            )}
            {agent.id !== 'customer-service-agent' && (
              <button
                onClick={() => handleTrigger(agent.id)}
                disabled={triggering === agent.id}
                className="mt-1 w-full flex items-center justify-center gap-1 text-xs bg-empire-accent/10 hover:bg-empire-accent/20 border border-empire-accent/30 rounded py-0.5 transition-colors disabled:opacity-50"
              >
                <Zap size={10} />
                {triggering === agent.id ? 'Running...' : 'Trigger'}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Metric({ icon, label, value, color, wide }) {
  return (
    <div className={`bg-empire-surface rounded p-2 border border-empire-border ${wide ? 'col-span-2' : ''}`}>
      <div className="flex items-center gap-1 text-slate-500 text-xs mb-1">
        {icon} {label}
      </div>
      <div className={`text-sm font-bold ${color}`}>{value}</div>
    </div>
  );
}
