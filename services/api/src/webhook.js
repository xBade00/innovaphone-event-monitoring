const router = require('express').Router();
const { saveEvent, upsertInstance, updateStatus } = require('./db');
const { categorize, getSeverity } = require('./events');

router.post('/webhook', async (req, res) => {
  try {
    const payload  = req.body;
    const sourceIp = req.headers['x-forwarded-for']?.split(',')[0].trim()
                     || req.socket.remoteAddress;

    console.log(`Webhook from ${sourceIp}:`, JSON.stringify(payload));

    const instance = await upsertInstance(sourceIp);
    const category = categorize(payload);
    const severity = getSeverity(payload, category);

    await saveEvent({
      instance_id: instance.id,
      category,
      severity,
      message:     payload.message || payload.event || JSON.stringify(payload),
      raw_payload: payload,
    });

    await updateStatus(instance.id, category, severity);
    res.json({ status: 'received' });
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).json({ error: 'internal error' });
  }
});

module.exports = router;