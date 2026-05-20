import React from 'react';

const STATUS_RING = {
  active: '#10b981',
  idle: '#475569',
  error: '#ef4444',
};

export default function AgentCharacter({ agent, avatar, x, y }) {
  const isActive = agent.status === 'active';
  const ringColor = STATUS_RING[agent.status] ?? '#475569';

  return (
    <div
      className="absolute flex flex-col items-center"
      style={{
        left: x,
        top: y,
        transform: 'translate(-50%, -50%)',
        zIndex: 10,
      }}
    >
      {/* Character body */}
      <div
        className={`relative flex items-center justify-center rounded-full text-2xl cursor-default select-none
          ${isActive ? 'animate-float agent-shadow' : ''}`}
        style={{
          width: 52,
          height: 52,
          background: `${avatar.color}22`,
          border: `2px solid ${ringColor}`,
          boxShadow: isActive ? `0 0 16px ${ringColor}66` : 'none',
          transition: 'all 0.3s ease',
        }}
        title={agent.name}
      >
        {avatar.emoji}

        {/* Status pulse for active agents */}
        {isActive && (
          <div
            className="absolute inset-0 rounded-full animate-ping opacity-30"
            style={{ background: avatar.color }}
          />
        )}
      </div>

      {/* Name label */}
      <div
        className="mt-1 px-2 py-0.5 rounded text-xs font-bold text-center whitespace-nowrap"
        style={{
          background: `${avatar.color}33`,
          border: `1px solid ${avatar.color}66`,
          color: avatar.color,
          fontSize: '9px',
          fontFamily: 'monospace',
        }}
      >
        {avatar.label}
      </div>

      {/* Task label (tiny, below name) */}
      {agent.current_task && (
        <div
          className="mt-0.5 px-1 rounded text-slate-500 text-center max-w-24 truncate"
          style={{ fontSize: '8px', fontFamily: 'monospace' }}
          title={agent.current_task}
        >
          {agent.current_task.slice(0, 20)}...
        </div>
      )}
    </div>
  );
}
