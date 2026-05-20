import React, { useRef, useEffect } from 'react';
import { useEmpireStore } from '../../stores/empireStore';

const AGENT_COLORS = {
  'design-agent': 'text-purple-400',
  'listing-agent': 'text-blue-400',
  'customer-service-agent': 'text-green-400',
  'marketing-agent': 'text-orange-400',
};

function timeAgo(ts) {
  const diff = (Date.now() - new Date(ts)) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

export default function ActivityFeed() {
  const { activityFeed } = useEmpireStore();
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activityFeed.length]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-empire-bg">
      <div className="px-4 py-2 border-b border-empire-border bg-empire-panel flex-shrink-0">
        <span className="text-xs font-pixel text-slate-400">ACTIVITY FEED</span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {activityFeed.length === 0 && (
          <div className="text-xs text-slate-600 text-center mt-8">
            Agents standing by...<br />
            <span className="text-slate-700">Trigger an agent to see activity</span>
          </div>
        )}

        {[...activityFeed].reverse().map((entry, i) => (
          <div key={entry.id ?? i} className="animate-slide-up flex gap-2 text-xs">
            <div className="flex-shrink-0 w-1 rounded-full bg-empire-accent/40 mt-1" />
            <div className="flex-1 min-w-0">
              {entry.agent && (
                <div className={`font-bold truncate ${AGENT_COLORS[entry.agent] ?? 'text-slate-400'}`}>
                  {entry.agent.replace('-agent', '').replace('-', ' ').toUpperCase()}
                </div>
              )}
              <div className="text-slate-400 break-words">{entry.text}</div>
              <div className="text-slate-600 text-xs">{timeAgo(entry.timestamp)}</div>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
