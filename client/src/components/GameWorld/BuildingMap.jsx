import React from 'react';

export default function BuildingMap() {
  return (
    <svg className="absolute inset-0 w-full h-full" xmlns="http://www.w3.org/2000/svg">
      {/* Outer walls */}
      <rect x="60" y="60" width="560" height="480" rx="4"
        fill="none" stroke="#1e3a5f" strokeWidth="2" />

      {/* Floor fill */}
      <rect x="62" y="62" width="556" height="476" rx="3"
        fill="#0d1424" />

      {/* Meeting room (top) */}
      <rect x="220" y="80" width="240" height="130" rx="4"
        fill="#111827" stroke="#1e3a5f" strokeWidth="1.5" />
      <text x="340" y="100" textAnchor="middle" fill="#1e3a5f" fontSize="8" fontFamily="monospace">
        MEETING ROOM
      </text>
      {/* Meeting room door */}
      <rect x="322" y="208" width="36" height="3" fill="#1e3a5f" />

      {/* Design office (left) */}
      <rect x="80" y="150" width="200" height="160" rx="4"
        fill="#0f1721" stroke="#2d1b69" strokeWidth="1.5" />
      <text x="180" y="168" textAnchor="middle" fill="#2d1b69" fontSize="8" fontFamily="monospace">
        DESIGN STUDIO
      </text>

      {/* Listing office (right) */}
      <rect x="300" y="150" width="300" height="160" rx="4"
        fill="#0f1721" stroke="#1e3a5f" strokeWidth="1.5" />
      <text x="450" y="168" textAnchor="middle" fill="#1e3a5f" fontSize="8" fontFamily="monospace">
        LISTING DEPT
      </text>

      {/* Support office (bottom-left) */}
      <rect x="80" y="330" width="200" height="180" rx="4"
        fill="#0f1721" stroke="#0d3320" strokeWidth="1.5" />
      <text x="180" y="348" textAnchor="middle" fill="#0d3320" fontSize="8" fontFamily="monospace">
        SUPPORT DESK
      </text>

      {/* Marketing office (bottom-right) */}
      <rect x="300" y="330" width="300" height="180" rx="4"
        fill="#0f1721" stroke="#3d2500" strokeWidth="1.5" />
      <text x="450" y="348" textAnchor="middle" fill="#3d2500" fontSize="8" fontFamily="monospace">
        MARKETING HUB
      </text>

      {/* Hallway corridor highlights */}
      <line x1="280" y1="150" x2="280" y2="510" stroke="#1e3a5f" strokeWidth="0.5" strokeDasharray="4,6" />
      <line x1="80" y1="310" x2="600" y2="310" stroke="#1e3a5f" strokeWidth="0.5" strokeDasharray="4,6" />

      {/* Desk furniture - Design */}
      <rect x="100" y="200" width="60" height="30" rx="2" fill="#111827" stroke="#2d1b69" strokeWidth="1" />
      <rect x="170" y="200" width="60" height="30" rx="2" fill="#111827" stroke="#2d1b69" strokeWidth="1" />

      {/* Desk furniture - Listing */}
      <rect x="320" y="200" width="60" height="30" rx="2" fill="#111827" stroke="#1e3a5f" strokeWidth="1" />
      <rect x="400" y="200" width="60" height="30" rx="2" fill="#111827" stroke="#1e3a5f" strokeWidth="1" />

      {/* Desk furniture - Support */}
      <rect x="100" y="380" width="60" height="30" rx="2" fill="#111827" stroke="#0d3320" strokeWidth="1" />
      <rect x="170" y="380" width="60" height="30" rx="2" fill="#111827" stroke="#0d3320" strokeWidth="1" />

      {/* Desk furniture - Marketing */}
      <rect x="320" y="380" width="60" height="30" rx="2" fill="#111827" stroke="#3d2500" strokeWidth="1" />
      <rect x="400" y="380" width="60" height="30" rx="2" fill="#111827" stroke="#3d2500" strokeWidth="1" />

      {/* Meeting table */}
      <ellipse cx="340" cy="148" rx="80" ry="30" fill="#0d1424" stroke="#1e3a5f" strokeWidth="1" />

      {/* Plants / decor */}
      <circle cx="90" cy="90" r="8" fill="#0d3320" />
      <circle cx="590" cy="90" r="8" fill="#0d3320" />
      <circle cx="90" cy="500" r="8" fill="#0d3320" />
      <circle cx="590" cy="500" r="8" fill="#0d3320" />
    </svg>
  );
}
