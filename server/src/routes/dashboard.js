import { Router } from 'express';
import supabase from '../services/supabase.js';

const router = Router();

router.get('/stats', async (req, res) => {
  const [
    { data: revenue },
    { data: expenses },
    { data: agents },
    { data: listings },
    { data: activity },
  ] = await Promise.all([
    supabase.from('revenue').select('amount'),
    supabase.from('expenses').select('amount'),
    supabase.from('agents').select('id, name, role, status, current_task'),
    supabase.from('listings').select('id, status'),
    supabase.from('activity_log').select('*').order('created_at', { ascending: false }).limit(20),
  ]);

  const totalRevenue = (revenue ?? []).reduce((s, r) => s + Number(r.amount), 0);
  const totalExpenses = (expenses ?? []).reduce((s, e) => s + Number(e.amount), 0);

  res.json({
    totalRevenue,
    totalExpenses,
    netProfit: totalRevenue - totalExpenses,
    activeAgents: (agents ?? []).filter((a) => a.status === 'active').length,
    totalAgents: (agents ?? []).length,
    agents: agents ?? [],
    listings: {
      total: (listings ?? []).length,
      published: (listings ?? []).filter((l) => l.status === 'published').length,
      draft: (listings ?? []).filter((l) => l.status === 'draft').length,
      pending: (listings ?? []).filter((l) => l.status === 'pending_approval').length,
    },
    recentActivity: activity ?? [],
    divisions: 1,
  });
});

router.get('/messages', async (req, res) => {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

export default router;
