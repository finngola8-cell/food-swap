import React from 'react';
import { useEmpireStore } from '../../stores/empireStore';
import { Wifi, WifiOff } from 'lucide-react';

function fmt(n) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

export default function ProfitTicker() {
  const { stats, connected, pendingDecisions } = useEmpireStore();
  const profit = stats.netProfit ?? 0;
  const isPositive = profit >= 0;

  return (
    <div className="h-10 bg-empire-surface border-b border-empire-border flex items-center px-4 gap-6 flex-shrink-0 z-20">
      {/* Logo */}
      <div className="font-pixel text-xs text-empire-accent whitespace-nowrap">
        AI EMPIRE
      </div>

      {/* Divider */}
      <div className="w-px h-5 bg-empire-border" />

      {/* Profit stats */}
      <div className="flex gap-6 text-xs font-mono">
        <span className="text-slate-400">
          Revenue: <span className="text-empire-green font-bold">{fmt(stats.totalRevenue)}</span>
        </span>
        <span className="text-slate-400">
          Spend: <span className="text-empire-red font-bold">{fmt(stats.totalExpenses)}</span>
        </span>
        <span className="text-slate-400">
          Net Profit:{' '}
          <span className={`font-bold ${isPositive ? 'text-empire-green' : 'text-empire-red'}`}>
            {isPositive ? '+' : ''}{fmt(profit)}
          </span>
        </span>
      </div>

      {/* Scrolling ticker */}
      <div className="flex-1 overflow-hidden relative">
        <div className="animate-ticker whitespace-nowrap text-xs text-slate-500">
          &nbsp;&nbsp;&bull;&nbsp; {stats.listings?.published ?? 0} listings live &nbsp;&bull;&nbsp; {stats.activeAgents ?? 0} agents active &nbsp;&bull;&nbsp; {stats.divisions ?? 1} business division{stats.divisions !== 1 ? 's' : ''} &nbsp;&bull;&nbsp; AI Business Empire v1.0 — Building wealth, one listing at a time &nbsp;&bull;
        </div>
      </div>

      {/* Right side: pending approvals + connection */}
      <div className="flex items-center gap-3 ml-auto">
        {pendingDecisions.length > 0 && (
          <div className="flex items-center gap-1.5 bg-empire-gold/10 border border-empire-gold/40 rounded px-2 py-0.5">
            <div className="w-2 h-2 rounded-full bg-empire-gold blink" />
            <span className="text-xs text-empire-gold font-bold">{pendingDecisions.length} pending</span>
          </div>
        )}
        <div className="flex items-center gap-1.5 text-xs">
          {connected ? (
            <><Wifi size={12} className="text-empire-green" /><span className="text-empire-green">LIVE</span></>
          ) : (
            <><WifiOff size={12} className="text-empire-red" /><span className="text-empire-red">OFFLINE</span></>
          )}
        </div>
      </div>
    </div>
  );
}
