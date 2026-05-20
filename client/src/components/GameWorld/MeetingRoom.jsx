import React, { useState, useEffect } from 'react';

const MEETING_LINES = [
  'Q: How are our listings performing this week?',
  'A: Design Agent here — I\'ve queued 3 new trending products.',
  'A: Listing Agent — 2 listings pending human approval.',
  'A: Marketing — Pinterest posts are driving traffic.',
  'A: Support — 0 open tickets. All clear!',
  'Q: What\'s our top niche opportunity right now?',
  'A: Design Agent — Personalized gifts are trending 40% up.',
];

export default function MeetingRoom({ agents }) {
  const [meeting, setMeeting] = useState(false);
  const [lineIndex, setLineIndex] = useState(0);
  const [currentLine, setCurrentLine] = useState('');

  // Simulate daily meeting
  useEffect(() => {
    const triggerMeeting = () => {
      setMeeting(true);
      setLineIndex(0);
    };
    const t = setTimeout(triggerMeeting, 5000); // demo: first meeting after 5s
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!meeting) return;
    if (lineIndex >= MEETING_LINES.length) {
      setTimeout(() => setMeeting(false), 3000);
      return;
    }
    setCurrentLine(MEETING_LINES[lineIndex]);
    const t = setTimeout(() => setLineIndex((i) => i + 1), 3500);
    return () => clearTimeout(t);
  }, [meeting, lineIndex]);

  return (
    <div className="absolute" style={{ left: 220, top: 80 }}>
      {/* Meeting room label */}
      <div className="absolute top-1 left-0 right-0 text-center">
        <span
          className="text-xs font-pixel"
          style={{ color: '#1e3a5f', fontSize: '7px' }}
        >
          BOARD ROOM
        </span>
      </div>

      {/* Table with agents seated during meeting */}
      {meeting && (
        <div className="absolute" style={{ top: 30, left: 0, width: 240 }}>
          {/* Agent emojis around table */}
          <div className="relative" style={{ height: 100 }}>
            {['🎨', '📝', '💬', '📢'].map((emoji, i) => {
              const angle = (i / 4) * 2 * Math.PI - Math.PI / 2;
              const rx = 75, ry = 28;
              const cx = 120, cy = 50;
              const px = cx + rx * Math.cos(angle);
              const py = cy + ry * Math.sin(angle);

              return (
                <div
                  key={i}
                  className="absolute text-lg animate-float"
                  style={{
                    left: px - 12,
                    top: py - 12,
                    animationDelay: `${i * 0.4}s`,
                    animationDuration: '2s',
                  }}
                >
                  {emoji}
                </div>
              );
            })}
          </div>

          {/* Speech bubble for current line */}
          {currentLine && (
            <div className="mt-1 mx-2 animate-slide-up">
              <div
                className="bg-empire-surface border border-empire-border rounded px-2 py-1 text-xs text-slate-300"
                style={{ fontSize: '10px' }}
              >
                {currentLine}
              </div>
            </div>
          )}

          {/* Meeting indicator */}
          <div className="flex items-center justify-center gap-1 mt-1">
            <div className="w-1.5 h-1.5 rounded-full bg-empire-green blink" />
            <span className="text-xs text-empire-green font-pixel" style={{ fontSize: '7px' }}>
              DAILY REVIEW
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
