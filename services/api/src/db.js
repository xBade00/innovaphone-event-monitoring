const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function upsertInstance(ip) {
  const res = await pool.query(
    `INSERT INTO instances (ip_address, name)
     VALUES ($1, $1)
     ON CONFLICT (ip_address) DO UPDATE SET ip_address = EXCLUDED.ip_address
     RETURNING *`,
    [ip]
  );
  return res.rows[0];
}

async function saveEvent({ instance_id, category, severity, message, raw_payload }) {
  await pool.query(
    `INSERT INTO events (instance_id, category, severity, message, raw_payload)
     VALUES ($1, $2, $3, $4, $5)`,
    [instance_id, category, severity, message, JSON.stringify(raw_payload)]
  );
}

async function updateStatus(instance_id, category, severity) {
  const col = {
    CERTIFICATE: 'cert_status',
    SIP:         'sip_status',
    RTP:         'rtp_status',
    H323:        'h323_status',
    APP_API:     'app_status',
  }[category];

  if (!col) return;

  await pool.query(
    `INSERT INTO instance_status (instance_id, ${col}, last_seen, updated_at)
     VALUES ($1, $2, NOW(), NOW())
     ON CONFLICT (instance_id) DO UPDATE
       SET ${col}     = EXCLUDED.${col},
           last_seen  = NOW(),
           updated_at = NOW()`,
    [instance_id, severity]
  );
}

async function getAllInstancesWithStatus() {
  const res = await pool.query(
    `SELECT i.*,
            COALESCE(s.cert_status,  'UNKNOWN') AS cert_status,
            COALESCE(s.sip_status,   'UNKNOWN') AS sip_status,
            COALESCE(s.rtp_status,   'UNKNOWN') AS rtp_status,
            COALESCE(s.h323_status,  'UNKNOWN') AS h323_status,
            COALESCE(s.app_status,   'UNKNOWN') AS app_status,
            s.last_seen
     FROM instances i
     LEFT JOIN instance_status s ON i.id = s.instance_id
     ORDER BY i.name`
  );
  return res.rows;
}

async function getInstanceEvents(instance_id, limit = 100) {
  const res = await pool.query(
    `SELECT * FROM events
     WHERE instance_id = $1
     ORDER BY received_at DESC
     LIMIT $2`,
    [instance_id, limit]
  );
  return res.rows;
}

async function getAllEvents({ category, severity, limit = 200 }) {
  const conditions = [];
  const params     = [];

  if (category) { params.push(category); conditions.push(`e.category = $${params.length}`); }
  if (severity) { params.push(severity); conditions.push(`e.severity = $${params.length}`); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit);

  const res = await pool.query(
    `SELECT e.*, i.name AS instance_name, i.ip_address
     FROM events e
     JOIN instances i ON e.instance_id = i.id
     ${where}
     ORDER BY e.received_at DESC
     LIMIT $${params.length}`,
    params
  );
  return res.rows;
}

module.exports = {
  upsertInstance, saveEvent, updateStatus,
  getAllInstancesWithStatus, getInstanceEvents, getAllEvents,
};