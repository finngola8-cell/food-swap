import React, { useRef, useEffect, useState } from 'react';
import { useEmpireStore } from '../../stores/empireStore';
import AgentCharacter from './AgentCharacter';
import SpeechBubble from './SpeechBubble';
import MeetingRoom from './MeetingRoom';
import BuildingMap from './BuildingMap';

const AGENT_POSITIONS = {
  'design-agent':           { x: 180, y: 200 },
  'listing-agent':          { x: 380, y: 200 },
  'customer-service-agent': { x: 180, y: 370 },
  'marketing-agent':        { x: 380, y: 370 },
};

const AGENT_AVATARS = {
  designer:  { emoji: '🎨', color: '#8b5cf6', label: 'DESIGN' },
  lister:    { emoji: '📝', color: '#3b82f6', label: 'LISTING' },
  support:   { emoji: '💬', color: '#10b981', label: 'SUPPORT' },
  marketer:  { emoji: '📢', color: '#f59e0b', label: 'MARKETING' },
};

export default function GameWorld() {
  const { agents, messages } = useEmpireStore();
  const [bubbles, setBubbles] = useState({});
  const prevMessages = useRef([]);

  // Show speech bubbles when new messages arrive
  useEffect(() => {
    if (!messages.length) return;
    const newest = messages[0];
    if (prevMessages.current[0]?.id === newest?.id) return;
    prevMessages.current = messages;

    const agentId = agents.find((a) => a.name === newest.from_agent)?.id;
    if (!agentId) return;

    setBubbles((b) => ({ ...b, [agentId]: newest.content }));
    setTimeout(() => {
      setBubbles((b) => {
        const next = { ...b };
        delete next[agentId];
        return next;
      });
    }, 5000);
  }, [messages]);

  const displayAgents = agents.length > 0
    ? agents
    : [
        { id: 'design-agent', name: 'Design Agent', role: 'designer', status: 'idle' },
        { id: 'listing-agent', name: 'Listing Agent', role: 'lister', status: 'idle' },
        { id: 'customer-service-agent', name: 'Customer Service Agent', role: 'support', status: 'idle' },
        { id: 'marketing-agent', name: 'Marketing Agent', role: 'marketer', status: 'idle' },
      ];

  return (
    <div className="w-full h-full relative overflow-hidden bg-empire-bg">
      {/* Isometric grid background */}
      <svg className="absolute inset-0 w-full h-full opacity-5" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#3b82f6" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
      </svg>

      {/* Building map (floor plan) */}
      <BuildingMap />

      {/* Meeting room (top center) */}
      <MeetingRoom agents={displayAgents} />

      {/* Agent characters */}
      {displayAgents.map((agent) => {
        const pos = AGENT_POSITIONS[agent.id] ?? { x: 100, y: 100 };
        const avatar = AGENT_AVATARS[agent.role] ?? { emoji: '🤖', color: '#64748b', label: agent.role };

        return (
          <div key={agent.id}>
            <AgentCharacter
              agent={agent}
              avatar={avatar}
              x={pos.x}
              y={pos.y}
            />
            {bubbles[agent.id] && (
              <SpeechBubble
                text={bubbles[agent.id]}
                x={pos.x}
                y={pos.y}
              />
            )}
          </div>
        );
      })}

      {/* Floor label */}
      <div className="absolute bottom-4 left-4 text-xs text-slate-600 font-pixel">
        HQ — FLOOR 1 — ETSY DIVISION
      </div>
    </div>
  );
}
