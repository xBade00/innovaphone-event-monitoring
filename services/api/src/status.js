const router = require('express').Router();
const { getAllInstancesWithStatus, getInstanceEvents, getAllEvents } = require('./db');

router.get('/instances/status', async (req, res) => {
  try {
    res.json(await getAllInstancesWithStatus());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/instances/:id/events', async (req, res) => {
  try {
    res.json(await getInstanceEvents(req.params.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/events', async (req, res) => {
  try {
    const { category, severity, limit } = req.query;
    res.json(await getAllEvents({ category, severity, limit: parseInt(limit) || 200 }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;