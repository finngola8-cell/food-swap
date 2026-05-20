import { create } from 'zustand';

const API = '/api';

export const useEmpireStore = create((set, get) => ({
  // State
  stats: {
    totalRevenue: 0,
    totalExpenses: 0,
    netProfit: 0,
    activeAgents: 0,
    totalAgents: 4,
    divisions: 1,
    listings: { total: 0, published: 0, draft: 0, pending: 0 },
  },
  agents: [],
  messages: [],
  activityFeed: [],
  pendingDecisions: [],
  ws: null,
  connected: false,

  // Actions
  fetchStats: async () => {
    try {
      const res = await fetch(`${API}/dashboard/stats`);
      const data = await res.json();
      set({ stats: data, agents: data.agents ?? [] });
    } catch (e) {
      console.error('fetchStats failed:', e);
    }
  },

  fetchPendingDecisions: async () => {
    try {
      const res = await fetch(`${API}/decisions/pending`);
      const data = await res.json();
      set({ pendingDecisions: Array.isArray(data) ? data : [] });
    } catch (e) {
      console.error('fetchPendingDecisions failed:', e);
    }
  },

  approveDecision: async (id) => {
    await fetch(`${API}/decisions/${id}/approve`, { method: 'POST' });
    get().fetchPendingDecisions();
    get().fetchStats();
  },

  rejectDecision: async (id) => {
    await fetch(`${API}/decisions/${id}/reject`, { method: 'POST' });
    get().fetchPendingDecisions();
  },

  triggerAgent: async (agentId) => {
    await fetch(`${API}/agents/${agentId}/trigger`, { method: 'POST' });
  },

  connectWs: () => {
    const wsUrl = `ws://${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => set({ connected: true });
    ws.onclose = () => {
      set({ connected: false });
      setTimeout(() => get().connectWs(), 3000);
    };

    ws.onmessage = (e) => {
      const { event, data } = JSON.parse(e.data);

      if (event === 'message') {
        set((s) => ({
          messages: [data, ...s.messages].slice(0, 100),
          activityFeed: [
            { id: data.id ?? Date.now(), text: `${data.from_agent}: ${data.content}`, timestamp: data.created_at ?? new Date().toISOString() },
            ...s.activityFeed,
          ].slice(0, 50),
        }));
      }

      if (event === 'activity') {
        set((s) => ({
          activityFeed: [
            { id: Date.now(), text: data.activity, agent: data.agent_id, timestamp: data.timestamp },
            ...s.activityFeed,
          ].slice(0, 50),
        }));
      }

      if (event === 'agent_update') {
        set((s) => ({
          agents: s.agents.map((a) => (a.id === data.id ? { ...a, ...data } : a)),
        }));
      }

      if (event === 'approval_needed') {
        set((s) => ({
          pendingDecisions: [data, ...s.pendingDecisions],
        }));
      }

      if (event === 'decision_resolved') {
        set((s) => ({
          pendingDecisions: s.pendingDecisions.filter((d) => d.id !== data.id),
        }));
      }
    };

    set({ ws });
  },
}));
