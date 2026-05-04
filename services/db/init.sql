CREATE TABLE instances (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  ip_address  VARCHAR(45)  NOT NULL UNIQUE,
  location    VARCHAR(100),
  created_at  TIMESTAMP    DEFAULT NOW()
);

CREATE TABLE events (
  id           SERIAL PRIMARY KEY,
  instance_id  INTEGER      REFERENCES instances(id) ON DELETE CASCADE,
  category     VARCHAR(50)  NOT NULL,
  severity     VARCHAR(20)  NOT NULL,
  message      TEXT         NOT NULL,
  raw_payload  JSONB,
  received_at  TIMESTAMP    DEFAULT NOW()
);

CREATE INDEX idx_events_instance ON events(instance_id);
CREATE INDEX idx_events_received ON events(received_at DESC);
CREATE INDEX idx_events_severity ON events(severity);

CREATE TABLE instance_status (
  instance_id  INTEGER PRIMARY KEY REFERENCES instances(id) ON DELETE CASCADE,
  cert_status  VARCHAR(20) DEFAULT 'UNKNOWN',
  sip_status   VARCHAR(20) DEFAULT 'UNKNOWN',
  rtp_status   VARCHAR(20) DEFAULT 'UNKNOWN',
  h323_status  VARCHAR(20) DEFAULT 'UNKNOWN',
  app_status   VARCHAR(20) DEFAULT 'UNKNOWN',
  last_seen    TIMESTAMP,
  updated_at   TIMESTAMP   DEFAULT NOW()
);