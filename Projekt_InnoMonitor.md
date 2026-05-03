# 📡 Projekt: InnoMonitor
## Innovaphone IPVA Event Monitoring System

---

## 🎯 Projektziel

Eigenständiges Monitoring-System für ~90 innovaphone IPVA Instanzen mit:
- Zentralem Empfang aller Events via HTTP/HTTPS Webhook
- Echtzeit-Dashboard mit Ampelsystem pro Instanz und Eventkategorie
- Persistenter Eventhistorie und Filtermöglichkeiten
- Keine Abhängigkeit zu bestehender Icinga/Caplon Infrastruktur

---

## 🏗️ Architektur

```
┌─────────────────────────────────────────────────────────┐
│                    VMware VLAN                          │
│                                                         │
│  ┌──────────┐   HTTPS Webhook   ┌──────────────────┐   │
│  │ IPVA-001 │ ─────────────────►│                  │   │
│  ├──────────┤                   │   InnoMonitor VM  │   │
│  │ IPVA-002 │ ─────────────────►│                  │   │
│  ├──────────┤                   │  ┌─────────────┐ │   │
│  │   ...    │                   │  │    Nginx    │ │   │
│  ├──────────┤                   │  │ Reverse     │ │   │
│  │ IPVA-090 │ ─────────────────►│  │ Proxy       │ │   │
│  └──────────┘                   │  └──────┬──────┘ │   │
│                                 │         │        │   │
│                                 │  ┌──────▼──────┐ │   │
│                                 │  │   Backend   │ │   │
│                                 │  │  (Express)  │ │   │
│                                 │  └──────┬──────┘ │   │
│                                 │         │        │   │
│                                 │  ┌──────▼──────┐ │   │
│                                 │  │ PostgreSQL  │ │   │
│                                 │  └─────────────┘ │   │
│                                 │                  │   │
│                                 │  ┌─────────────┐ │   │
│                                 │  │  Frontend   │ │   │
│                                 │  │  (Next.js)  │ │   │
│                                 │  └─────────────┘ │   │
│                                 └──────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

---

## 📁 Projektstruktur

```
innomonitor/
├── services/
│   ├── api/                    ← Node.js/Express Backend
│   │   ├── src/
│   │   │   ├── index.js        ← Server Einstiegspunkt
│   │   │   ├── webhook.js      ← Webhook Empfänger
│   │   │   ├── events.js       ← Event Verarbeitung & Kategorisierung
│   │   │   ├── db.js           ← Datenbankzugriff
│   │   │   └── status.js       ← Ampelstatus Berechnung
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   ├── web/                    ← Next.js Frontend
│   │   ├── app/
│   │   │   ├── page.tsx        ← Hauptdashboard (Übersicht aller Instanzen)
│   │   │   ├── instance/
│   │   │   │   └── [id]/
│   │   │   │       └── page.tsx ← Detailansicht einer Instanz
│   │   │   └── events/
│   │   │       └── page.tsx    ← Eventliste mit Filtern
│   │   └── Dockerfile
│   │
│   └── db/
│       └── init.sql            ← Datenbankschema
│
├── nginx/
│   └── nginx.conf              ← Reverse Proxy Konfiguration
├── docker-compose.yml
└── .github/
    └── workflows/
        └── ci.yml
```

---

## 🗄️ Datenbankschema

```sql
-- Alle bekannten Instanzen
CREATE TABLE instances (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,      -- z.B. "Standort-Berlin-01"
  ip_address  VARCHAR(45) NOT NULL UNIQUE,
  location    VARCHAR(100),
  created_at  TIMESTAMP DEFAULT NOW()
);

-- Alle eingegangenen Events
CREATE TABLE events (
  id           SERIAL PRIMARY KEY,
  instance_id  INTEGER REFERENCES instances(id),
  category     VARCHAR(50) NOT NULL,      -- CERTIFICATE, SIP, RTP, H323, APP_API
  severity     VARCHAR(20) NOT NULL,      -- CRITICAL, WARNING, INFO
  message      TEXT NOT NULL,
  raw_payload  JSONB,                     -- Original Webhook Payload
  received_at  TIMESTAMP DEFAULT NOW()
);

-- Aktueller Status pro Instanz (für schnellen Dashboard-Zugriff)
CREATE TABLE instance_status (
  instance_id   INTEGER PRIMARY KEY REFERENCES instances(id),
  cert_status   VARCHAR(20) DEFAULT 'OK',
  sip_status    VARCHAR(20) DEFAULT 'OK',
  rtp_status    VARCHAR(20) DEFAULT 'OK',
  h323_status   VARCHAR(20) DEFAULT 'OK',
  app_status    VARCHAR(20) DEFAULT 'OK',
  last_seen     TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT NOW()
);
```

---

## 🚦 Ampelsystem

Jede Instanz hat pro Eventkategorie einen Status:

| Status | Farbe | Bedeutung |
|--------|-------|-----------|
| `OK` | 🟢 Grün | Keine aktiven Events |
| `WARNING` | 🟡 Gelb | Unkritische Events in den letzten 24h |
| `CRITICAL` | 🔴 Rot | Kritische Events (z.B. Certificate Rejected) |
| `UNKNOWN` | ⚪ Grau | Seit >24h keine Verbindung |

**Priorisierung der Kategorien:**
- 🔴 **CERTIFICATE** — `rejected` Events sofort kritisch
- 🟡 **SIP** — Abhängig von Event-Typ
- 🟡 **RTP** — Qualitätsprobleme
- 🟡 **H323** — Verbindungsfehler
- 🟡 **APP_API** — App nicht registriert = Warning

---

## ✅ Stufe 1 — Kern-Infrastruktur

### Ziel
Webhook Empfänger läuft, Events werden gespeichert, einfaches Dashboard zeigt alle Instanzen.

### Schritt 1 — Projekt aufsetzen

```bash
mkdir innomonitor && cd innomonitor
mkdir -p services/api/src services/web services/db nginx .github/workflows
git init
```

### Schritt 2 — Backend: Webhook Empfänger

`services/api/src/webhook.js` empfängt Events von allen Instanzen:

```js
const router = require('express').Router();
const { saveEvent, upsertInstance, updateStatus } = require('./db');
const { categorize, getSeverity } = require('./events');

router.post('/webhook', async (req, res) => {
  const payload = req.body;
  const sourceIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  // Instanz anhand der IP identifizieren oder neu anlegen
  const instance = await upsertInstance(sourceIp);

  // Event kategorisieren und Schweregrad bestimmen
  const category = categorize(payload);
  const severity = getSeverity(payload, category);

  // Event speichern
  await saveEvent({
    instance_id: instance.id,
    category,
    severity,
    message: payload.message || JSON.stringify(payload),
    raw_payload: payload,
  });

  // Ampelstatus aktualisieren
  await updateStatus(instance.id, category, severity);

  res.json({ status: 'received' });
});

module.exports = router;
```

### Schritt 3 — Event Kategorisierung

`services/api/src/events.js`:

```js
const CATEGORY_PATTERNS = {
  CERTIFICATE: ['cert', 'certificate', 'tls', 'ssl', 'x509'],
  SIP:         ['sip', 'register', 'invite', 'dialog'],
  RTP:         ['rtp', 'media', 'codec', 'jitter', 'packet loss'],
  H323:        ['h323', 'h.323', 'ras', 'gatekeeper'],
  APP_API:     ['app', 'api', 'registered', 'unregistered'],
};

const CRITICAL_PATTERNS = ['rejected', 'expired', 'invalid', 'failed', 'error'];
const WARNING_PATTERNS  = ['warning', 'timeout', 'retry', 'unreachable'];

function categorize(payload) {
  const text = JSON.stringify(payload).toLowerCase();
  for (const [category, patterns] of Object.entries(CATEGORY_PATTERNS)) {
    if (patterns.some(p => text.includes(p))) return category;
  }
  return 'OTHER';
}

function getSeverity(payload, category) {
  const text = JSON.stringify(payload).toLowerCase();
  if (CRITICAL_PATTERNS.some(p => text.includes(p))) return 'CRITICAL';
  if (WARNING_PATTERNS.some(p => text.includes(p)))  return 'WARNING';
  return 'INFO';
}

module.exports = { categorize, getSeverity };
```

### Schritt 4 — Datenbank Setup

`services/db/init.sql` — das Schema von oben einfügen.

`docker-compose.yml`:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: innomonitor
      POSTGRES_USER: inno
      POSTGRES_PASSWORD: inno
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./services/db/init.sql:/docker-entrypoint-initdb.d/init.sql
    ports:
      - "5432:5432"

  api:
    build: ./services/api
    environment:
      DATABASE_URL: postgres://inno:inno@postgres:5432/innomonitor
      PORT: 3001
    ports:
      - "3001:3001"
    depends_on:
      - postgres

  web:
    build: ./services/web
    environment:
      NEXT_PUBLIC_API_URL: http://localhost:3001
    ports:
      - "3000:3000"
    depends_on:
      - api

  nginx:
    image: nginx:alpine
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf
    ports:
      - "80:80"
      - "443:443"
    depends_on:
      - api
      - web

volumes:
  postgres_data:
```

### Schritt 5 — Dashboard (Hauptseite)

Die Hauptseite zeigt alle 90 Instanzen als Kacheln mit Ampelfarben:

```
┌─────────────────────────────────────────────────────┐
│  InnoMonitor                          🔴 3  🟡 12  🟢 75 │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────┐ │
│  │ Berlin-01    │  │ Hamburg-01   │  │ München-01│ │
│  │ 🔴 CERT      │  │ 🟢 OK        │  │ 🟡 SIP    │ │
│  │ 🟢 SIP       │  │ 🟢 OK        │  │ 🟢 OK     │ │
│  │ 🟢 RTP       │  │ 🟢 OK        │  │ 🟢 OK     │ │
│  └──────────────┘  └──────────────┘  └───────────┘ │
│                                                     │
│  Filter: [ Alle ▼ ]  Kategorie: [ Alle ▼ ]  🔍     │
└─────────────────────────────────────────────────────┘
```

---

## ✅ Stufe 2 — Echtzeit & Detailansicht

### Ziel
Dashboard aktualisiert sich automatisch, Detailansicht pro Instanz mit Eventhistorie.

### Neue Features
- **Server-Sent Events (SSE)** — Dashboard aktualisiert sich ohne Reload
- **Detailseite** pro Instanz mit vollständiger Eventliste
- **Filterung** nach Zeitraum, Kategorie, Schweregrad
- **Instanz-Verwaltung** — Namen und Standorte pflegen

---

## ✅ Stufe 3 — Produktionsreife

### Ziel
System ist produktionsreif, sicher und wartbar.

### Neue Features
- **HTTPS** mit selbstsigniertem Zertifikat (intern) via Nginx
- **Authentifizierung** — einfacher Login für das Dashboard
- **Webhook Token** — Validierung dass Events wirklich von innovaphone kommen
- **Alerting** — Email bei CRITICAL Events
- **Automatisches Cleanup** — Events älter als 90 Tage löschen
- **Backup** — PostgreSQL Dump täglich per Cronjob

---

## 🔧 innovaphone Konfiguration

Für jede der 90 Instanzen in der Event-App:

| Feld | Wert |
|------|------|
| Enable | ✅ |
| Type | HTTP oder HTTPS |
| Address | `<IP der Monitoring VM>` |
| Port | `80` (oder `443` für HTTPS) |
| Path | `/api/webhook` |
| Method | `POST` |

---

## 🏁 Abnahmekriterien — Stufe 1

- [ ] `docker compose up` startet alle Services fehlerfrei
- [ ] Ein Test-Webhook an `/api/webhook` wird korrekt gespeichert
- [ ] Dashboard zeigt alle konfigurierten Instanzen
- [ ] Ampelfarben ändern sich korrekt nach eingehenden Events
- [ ] Eine Instanz kann angeklickt werden und zeigt ihre Events

---

## 🧠 Verständnisfragen

1. Warum PostgreSQL statt SQLite für dieses Projekt?
2. Was ist der Unterschied zwischen Polling und Webhooks — warum sind Webhooks hier besser?
3. Warum ist es wichtig den `raw_payload` als JSONB zu speichern obwohl wir ihn kategorisieren?

---

## ⚠️ Wichtige Hinweise

- Die VM braucht eine **feste IP** im VLAN damit die 90 Instanzen den Webhook zuverlässig erreichen
- Firewall: Port 80/443 von allen IPVA IPs zur Monitoring VM freigeben
- innovaphone sendet möglicherweise kein Standard-JSON — das Webhook-Format muss mit einer echten Instanz getestet und angepasst werden

---

*Bereit wenn du es bist. Bei Fragen einfach Claude fragen.* 🚀
