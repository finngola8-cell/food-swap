import React from 'react';

export default function SpeechBubble({ text, x, y }) {
  const maxLen = 120;
  const display = text.length > maxLen ? text.slice(0, maxLen) + '...' : text;

  return (
    <div
      className="absolute z-20 animate-slide-up pointer-events-none"
      style={{
        left: x + 30,
        top: y - 70,
        maxWidth: 200,
      }}
    >
      {/* Bubble */}
      <div className="bg-empire-surface border border-empire-border rounded-lg px-3 py-2 shadow-xl relative">
        <p className="text-xs text-slate-300 leading-relaxed">{display}</p>

        {/* Tail pointing down-left */}
        <div
          className="absolute -bottom-2 left-4 w-0 h-0"
          style={{
            borderLeft: '6px solid transparent',
            borderRight: '6px solid transparent',
            borderTop: '8px solid #1e3a5f',
          }}
        />
        <div
          className="absolute -bottom-1.5 left-4 w-0 h-0"
          style={{
            borderLeft: '5px solid transparent',
            borderRight: '5px solid transparent',
            borderTop: '7px solid #111827',
          }}
        />
      </div>
    </div>
  );
}
