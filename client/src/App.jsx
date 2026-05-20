import React, { useEffect } from 'react';
import { useEmpireStore } from './stores/empireStore';
import GameWorld from './components/GameWorld/GameWorld';
import ProfitTicker from './components/Dashboard/ProfitTicker';
import DashboardPanel from './components/Dashboard/DashboardPanel';
import ActivityFeed from './components/Dashboard/ActivityFeed';
import ApprovalModal from './components/Approval/ApprovalModal';

export default function App() {
  const { connectWs, fetchStats, fetchPendingDecisions, pendingDecisions } = useEmpireStore();

  useEffect(() => {
    connectWs();
    fetchStats();
    fetchPendingDecisions();
    const interval = setInterval(() => {
      fetchStats();
      fetchPendingDecisions();
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="h-screen w-screen overflow-hidden bg-empire-bg flex flex-col">
      {/* Top ticker bar */}
      <ProfitTicker />

      {/* Main layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Game world — takes up most of the screen */}
        <div className="flex-1 relative overflow-hidden">
          <GameWorld />
        </div>

        {/* Right sidebar */}
        <div className="w-80 flex flex-col border-l border-empire-border overflow-hidden">
          <DashboardPanel />
          <ActivityFeed />
        </div>
      </div>

      {/* Approval modal — floats over everything */}
      {pendingDecisions.length > 0 && <ApprovalModal />}
    </div>
  );
}
