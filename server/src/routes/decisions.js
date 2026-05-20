import { Router } from 'express';
import supabase from '../services/supabase.js';
import { messageBus } from '../services/message-bus.js';

const router = Router();

router.get('/pending', async (req, res) => {
  const { data, error } = await supabase
    .from('decisions')
    .select('*')
    .eq('requires_approval', true)
    .is('approved', null)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.post('/:id/approve', async (req, res) => {
  const { data, error } = await supabase
    .from('decisions')
    .update({ approved: true, reviewed_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  messageBus.broadcast('decision_resolved', { id: req.params.id, approved: true });
  res.json(data);
});

router.post('/:id/reject', async (req, res) => {
  const { data, error } = await supabase
    .from('decisions')
    .update({ approved: false, reviewed_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  messageBus.broadcast('decision_resolved', { id: req.params.id, approved: false });
  res.json(data);
});

router.get('/history', async (req, res) => {
  const { data, error } = await supabase
    .from('decisions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

export default router;
