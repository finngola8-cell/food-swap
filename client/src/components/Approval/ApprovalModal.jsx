import React, { useState } from 'react';
import { useEmpireStore } from '../../stores/empireStore';
import { CheckCircle, XCircle, AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';

export default function ApprovalModal() {
  const { pendingDecisions, approveDecision, rejectDecision } = useEmpireStore();
  const [index, setIndex] = useState(0);

  const decision = pendingDecisions[Math.min(index, pendingDecisions.length - 1)];
  if (!decision) return null;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-6">
      <div className="bg-empire-panel border border-empire-gold/50 rounded-xl w-full max-w-lg shadow-2xl animate-slide-up">
        {/* Header */}
        <div className="flex items-center gap-3 p-4 border-b border-empire-border">
          <AlertTriangle size={20} className="text-empire-gold" />
          <div>
            <div className="text-sm font-bold text-empire-gold">Human Approval Required</div>
            <div className="text-xs text-slate-400">{pendingDecisions.length} pending decision{pendingDecisions.length !== 1 ? 's' : ''}</div>
          </div>
          {pendingDecisions.length > 1 && (
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => setIndex((i) => Math.max(0, i - 1))}
                disabled={index === 0}
                className="p-1 hover:text-white text-slate-500 disabled:opacity-30"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="text-xs text-slate-400">{index + 1}/{pendingDecisions.length}</span>
              <button
                onClick={() => setIndex((i) => Math.min(pendingDecisions.length - 1, i + 1))}
                disabled={index >= pendingDecisions.length - 1}
                className="p-1 hover:text-white text-slate-500 disabled:opacity-30"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          )}
        </div>

        {/* Body */}
        <div className="p-4 space-y-3">
          <div className="text-xs text-slate-400 uppercase tracking-wide">
            Agent: <span className="text-white">{decision.agent_name}</span>
          </div>
          <div className="bg-empire-surface rounded p-3 border border-empire-border">
            <div className="text-sm text-slate-200">{decision.decision}</div>
          </div>

          {decision.metadata && Object.keys(decision.metadata).length > 0 && (
            <details className="text-xs">
              <summary className="text-slate-500 cursor-pointer hover:text-slate-300">View details</summary>
              <pre className="mt-2 bg-empire-bg rounded p-2 text-slate-400 overflow-auto max-h-32 text-xs">
                {JSON.stringify(decision.metadata, null, 2)}
              </pre>
            </details>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-3 p-4 border-t border-empire-border">
          <button
            onClick={() => {
              rejectDecision(decision.id);
              setIndex((i) => Math.max(0, i - 1));
            }}
            className="flex-1 flex items-center justify-center gap-2 bg-empire-red/10 hover:bg-empire-red/20 border border-empire-red/40 text-empire-red rounded-lg py-2.5 text-sm font-bold transition-colors"
          >
            <XCircle size={16} /> Reject
          </button>
          <button
            onClick={() => {
              approveDecision(decision.id);
              setIndex((i) => Math.max(0, i - 1));
            }}
            className="flex-1 flex items-center justify-center gap-2 bg-empire-green/10 hover:bg-empire-green/20 border border-empire-green/40 text-empire-green rounded-lg py-2.5 text-sm font-bold transition-colors"
          >
            <CheckCircle size={16} /> Approve
          </button>
        </div>
      </div>
    </div>
  );
}
