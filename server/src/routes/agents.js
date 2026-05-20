import { Router } from 'express';
import supabase from '../services/supabase.js';
import { agentRegistry } from '../index.js';

const router = Router();

router.get('/', async (req, res) => {
  const { data, error } = await supabase.from('agents').select('*');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.post('/:id/start', (req, res) => {
  const agent = agentRegistry[req.params.id];
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  agent.start();
  res.json({ message: `${agent.name} started` });
});

router.post('/:id/stop', (req, res) => {
  const agent = agentRegistry[req.params.id];
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  agent.stop();
  res.json({ message: `${agent.name} stopped` });
});

router.post('/:id/trigger', async (req, res) => {
  const agent = agentRegistry[req.params.id];
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  try {
    if (agent.id === 'design-agent') await agent.generateProductIdeas();
    else if (agent.id === 'listing-agent') await agent.processDraftListings();
    else if (agent.id === 'marketing-agent') await agent.createContent();
    res.json({ message: `${agent.name} triggered successfully` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
