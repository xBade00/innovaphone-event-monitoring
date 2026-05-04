const CATEGORY_PATTERNS = {
  CERTIFICATE: ['cert', 'certificate', 'tls', 'ssl', 'x509'],
  SIP:         ['sip', 'register', 'invite', 'dialog'],
  RTP:         ['rtp', 'media', 'codec', 'jitter', 'packet'],
  H323:        ['h323', 'h.323', 'ras', 'gatekeeper'],
  APP_API:     ['app', 'api', 'registered', 'unregistered'],
};

const CRITICAL_PATTERNS = ['rejected', 'expired', 'invalid', 'failed', 'error', 'critical'];
const WARNING_PATTERNS  = ['warning', 'timeout', 'retry', 'unreachable', 'warn'];

function categorize(payload) {
  const text = JSON.stringify(payload).toLowerCase();
  for (const [category, patterns] of Object.entries(CATEGORY_PATTERNS)) {
    if (patterns.some(p => text.includes(p))) return category;
  }
  return 'OTHER';
}

function getSeverity(payload, category) {
  const text = JSON.stringify(payload).toLowerCase();
  if (category === 'CERTIFICATE' && (text.includes('rejected') || text.includes('expired')))
    return 'CRITICAL';
  if (CRITICAL_PATTERNS.some(p => text.includes(p))) return 'CRITICAL';
  if (WARNING_PATTERNS.some(p => text.includes(p)))  return 'WARNING';
  return 'INFO';
}

module.exports = { categorize, getSeverity };