# Projekt: InnoMonitor
## Innovaphone IPVA Event Monitoring System

---

## Projektziel

Eigenständiges Monitoring-System für ~90 innovaphone IPVA Instanzen mit:
- Zentralem Empfang aller Events via HTTP Webhook
- Echtzeit-Dashboard mit Ampelsystem pro Instanz und Eventkategorie
- Persistenter Eventhistorie und Filtermöglichkeiten
- Keine Abhängigkeit zu bestehender Icinga/Caplon Infrastruktur

---

## Wie Webhooks funktionieren

### Polling vs. Webhook — der Unterschied

**Polling** (alt, ineffizient):
```
Unser Server fragt alle 30s bei jeder IPVA an: "Gibt es neue Events?"
→ 90 Instanzen × 2 Anfragen/Min = 180 unnötige Anfragen/Min, meist leer
```

**Webhook** (unser Ansatz):
```
IPVA sendet von sich aus eine HTTP POST Anfrage, sobald ein Event auftritt
→ Wir reagieren nur, wenn wirklich etwas passiert
```

### Ablauf eines Webhook-Calls

```
innovaphone IPVA-001          InnoMonitor (Nginx → Express API)
        │                              │
        │  Event tritt auf             │
        │  (z.B. Zertifikat rejected)  │
        │                              │
        │──── HTTP POST /api/webhook ─►│
        │     Headers:                 │
        │       Content-Type: applic.. │
        │       X-Real-IP: 10.0.1.1    │
        │     Body (JSON):             │
        │       { "type": "cert",      │
        │         "message": "...",    │
        │         "severity": "..."  } │
        │                              │──► Instanz identifizieren/anlegen
        │                              │──► Event kategorisieren
        │                              │──► In PostgreSQL speichern
        │                              │──► Ampelstatus aktualisieren
        │◄─── HTTP 200 { "status":     │
        │              "received" } ───│
        │                              │
```

### Was innovaphone im Webhook-Body sendet

Das genaue Format hängt von der IPVA-Version und Konfiguration ab.
**Wichtig:** Beim ersten Test immer den Raw-Payload loggen (das macht unser Backend automatisch).

Erwartetes Format (muss mit echter Instanz verifiziert werden):
```json
{
  "type": "certificate",
  "event": "rejected",
  "source": "10.0.1.1",
  "message": "Certificate rejected: CN=pbx.example.com expired",
  "timestamp": "2026-05-04T10:23:00Z",
  "severity": "critical"
}
```

### Webhook mit curl testen

Sobald der Server läuft, kann man einen Test-Webhook senden:
```bash
curl -X POST http://<VM-IP>/api/webhook \
  -H "Content-Type: application/json" \
  -d '{"type":"certificate","event":"rejected","message":"Test: Cert expired","severity":"critical"}'
```

Erwartete Antwort: `{"status":"received"}`

---

## Architektur

```
┌──────────────────────────────────────────────────────────────┐
│                       VMware VLAN                            │
│                                                              │
│  ┌──────────┐   HTTP POST      ┌────────────────────────┐   │
│  │ IPVA-001 │──────────────────►                        │   │
│  ├──────────┤  /api/webhook    │    InnoMonitor VM      │   │
│  │ IPVA-002 │──────────────────►   (Ubuntu 22.04)       │   │
│  ├──────────┤                  │                        │   │
│  │   ...    │                  │  ┌──────────────────┐  │   │
│  ├──────────┤                  │  │  Nginx :80/:443  │  │   │
│  │ IPVA-090 │──────────────────►  │  Reverse Proxy   │  │   │
│  └──────────┘                  │  └────────┬─────────┘  │   │
│                                │           │            │   │
│                                │  /api/* ──┤── /* ──    │   │
│                                │           │        │   │   │
│                                │  ┌────────▼──┐  ┌──▼──┐│   │
│                                │  │  Express  │  │Next ││   │
│                                │  │  API:3001 │  │ .js ││   │
│                                │  │           │  │:3000││   │
│                                │  └────────┬──┘  └─────┘│   │
│                                │           │            │   │
│                                │  ┌────────▼──────────┐ │   │
│  Dashboard-Zugriff             │  │    PostgreSQL :5432│ │   │
│  Browser ──────────────────────►  └───────────────────┘ │   │
│  (nur intern im VLAN)          └────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

**Port-Übersicht:**

| Port | Service | Erreichbar von |
|------|---------|----------------|
| 80 | Nginx (HTTP) | IPVA-Instanzen + Browser |
| 443 | Nginx (HTTPS, Stufe 3) | IPVA-Instanzen + Browser |
| 3001 | Express API | Nur intern (Docker-Netzwerk) |
| 3000 | Next.js | Nur intern (Docker-Netzwerk) |
| 5432 | PostgreSQL | Nur intern (Docker-Netzwerk) |

---

## VMware VM Setup

### Schritt 1 — VM erstellen (vSphere/ESXi)

**Empfohlene VM-Spezifikationen:**

| Ressource | Minimum | Empfohlen |
|-----------|---------|-----------|
| vCPU | 2 | 4 |
| RAM | 4 GB | 8 GB |
| Disk | 20 GB | 50 GB |
| NIC | VMXNET3 | VMXNET3 |
| Netzwerk | VLAN mit IPVA-Instanzen | gleich |

**VM anlegen in vSphere:**
1. vSphere Client öffnen → "New Virtual Machine"
2. Guest OS: `Linux → Ubuntu Linux (64-bit)`
3. ISO: `ubuntu-22.04.x-live-server-amd64.iso` einbinden
4. NIC auf das VLAN setzen, in dem die IPVA-Instanzen erreichbar sind
5. VM starten → Ubuntu Server installieren

### Schritt 2 — Ubuntu Server 22.04 installieren

Bei der Installation:
- `Ubuntu Server (minimized)` wählen
- OpenSSH Server: **Ja** (für Remote-Zugriff)
- Keine zusätzlichen Snaps nötig
- Benutzername: `innomonitor` (oder nach Wunsch)

### Schritt 3 — Feste IP-Adresse konfigurieren

Nach der Installation per SSH einloggen:

```bash
# Netzwerk-Interface ermitteln
ip link show
# Typisch bei VMware: ens192 oder ens160

# Netplan-Konfiguration bearbeiten
sudo nano /etc/netplan/00-installer-config.yaml
```

Inhalt anpassen (IP-Adressen entsprechend der eigenen Netzwerkinfrastruktur):
```yaml
network:
  version: 2
  ethernets:
    ens192:
      addresses:
        - 10.0.10.50/24          # feste IP der Monitoring-VM
      routes:
        - to: default
          via: 10.0.10.1         # Gateway
      nameservers:
        addresses: [8.8.8.8, 8.8.4.4]
```

```bash
sudo netplan apply
ip addr show ens192   # IP prüfen
```

### Schritt 4 — Docker installieren

```bash
# System aktualisieren
sudo apt update && sudo apt upgrade -y

# Docker-Abhängigkeiten
sudo apt install -y ca-certificates curl gnupg

# Docker GPG-Key hinzufügen
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
  sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

# Docker Repository hinzufügen
echo "deb [arch=$(dpkg --print-architecture) \
  signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Docker installieren
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Docker ohne sudo nutzen (neu einloggen danach!)
sudo usermod -aG docker $USER
newgrp docker

# Test
docker --version
docker compose version
```

### Schritt 5 — Firewall konfigurieren

```bash
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP (Webhooks + Dashboard)
sudo ufw allow 443/tcp   # HTTPS (Stufe 3)
sudo ufw enable
sudo ufw status
```

### Schritt 6 — Projekt auf die VM bringen

**Option A: Git clone (empfohlen wenn GitHub-Repo vorhanden)**
```bash
cd ~
git clone https://github.com/<dein-repo>/innomonitor.git
cd innomonitor
```

**Option B: Per SCP vom lokalen Rechner hochladen**
```bash
# Auf dem lokalen Mac ausführen:
scp -r ./innomonitor innomonitor@10.0.10.50:~/
```

### Schritt 7 — Umgebungsvariablen konfigurieren

```bash
cd ~/innomonitor
cp .env.example .env
nano .env   # Passwörter anpassen!
```

### Schritt 8 — Anwendung starten

```bash
# Alle Container bauen und starten
docker compose up -d --build

# Status prüfen
docker compose ps

# Logs anschauen
docker compose logs -f

# Test-Webhook senden
curl -X POST http://localhost/api/webhook \
  -H "Content-Type: application/json" \
  -d '{"type":"test","message":"VM läuft","severity":"info"}'
```

### Schritt 9 — Autostart bei VM-Neustart

Docker-Containers starten automatisch neu dank `restart: unless-stopped` in der `docker-compose.yml`.

Docker selbst beim Systemstart:
```bash
sudo systemctl enable docker
```

### Schritt 10 — Dashboard aufrufen

Browser auf einem PC im gleichen VLAN öffnen:
```
http://10.0.10.50
```

---

## Projektstruktur

```
innomonitor/
├── services/
│   ├── api/                        ← Node.js/Express Backend
│   │   ├── src/
│   │   │   ├── index.js            ← Server Einstiegspunkt
│   │   │   ├── webhook.js          ← Webhook Empfänger
│   │   │   ├── events.js           ← Kategorisierung & Schweregrad
│   │   │   ├── db.js               ← Alle Datenbankzugriffe
│   │   │   └── status.js           ← API-Routen für Dashboard
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   ├── web/                        ← Next.js Frontend
│   │   ├── app/
│   │   │   ├── layout.tsx          ← HTML-Grundgerüst
│   │   │   ├── globals.css         ← Tailwind CSS
│   │   │   ├── page.tsx            ← Dashboard (alle Instanzen)
│   │   │   ├── instance/
│   │   │   │   └── [id]/
│   │   │   │       └── page.tsx    ← Detailansicht einer Instanz
│   │   │   └── events/
│   │   │       └── page.tsx        ← Alle Events mit Filtern
│   │   ├── next.config.js
│   │   ├── tailwind.config.ts
│   │   ├── postcss.config.js
│   │   ├── tsconfig.json
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   └── db/
│       └── init.sql                ← Datenbankschema
│
├── nginx/
│   └── nginx.conf                  ← Reverse Proxy Konfiguration
├── docker-compose.yml
├── .env                            ← Geheimnisse (nicht in Git!)
└── .env.example                    ← Vorlage für .env
```

---

## Datenbankschema

`services/db/init.sql`:

```sql
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
```

---

## Ampelsystem

| Status | Farbe | Bedeutung |
|--------|-------|-----------|
| `OK` | Grün | Keine aktiven Probleme |
| `WARNING` | Gelb | Unkritische Events in den letzten 24h |
| `CRITICAL` | Rot | Kritische Events (z.B. Zertifikat abgelaufen) |
| `UNKNOWN` | Grau | Noch kein Event empfangen |

**Priorisierung der Kategorien:**
- **CERTIFICATE** — `rejected`, `expired` → sofort CRITICAL
- **SIP** — Registrierungsfehler → WARNING oder CRITICAL
- **RTP** — Qualitätsprobleme → WARNING
- **H323** — Verbindungsfehler → WARNING
- **APP_API** — App nicht registriert → WARNING

---

## Stufe 1 — Kern-Infrastruktur (vollständiger Code)

### Ziel
Webhook Empfänger läuft, Events werden gespeichert, Dashboard zeigt alle Instanzen.

---

### Backend

#### `services/api/package.json`

```json
{
  "name": "innomonitor-api",
  "version": "1.0.0",
  "main": "src/index.js",
  "scripts": {
    "start": "node src/index.js",
    "dev": "nodemon src/index.js"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "pg": "^8.12.0"
  },
  "devDependencies": {
    "nodemon": "^3.1.4"
  }
}
```

#### `services/api/src/index.js`

```js
require('dotenv').config();
const express = require('express');
const cors    = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api', require('./webhook'));
app.use('/api', require('./status'));

app.listen(process.env.PORT || 3001, () =>
  console.log(`API running on port ${process.env.PORT || 3001}`)
);
```

#### `services/api/src/webhook.js`

```js
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
```

#### `services/api/src/events.js`

```js
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
```

#### `services/api/src/db.js`

```js
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
```

#### `services/api/src/status.js`

```js
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
```

#### `services/api/Dockerfile`

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY src/ ./src/
EXPOSE 3001
CMD ["node", "src/index.js"]
```

---

### Frontend

#### `services/web/package.json`

```json
{
  "name": "innomonitor-web",
  "version": "0.1.0",
  "scripts": {
    "dev":   "next dev",
    "build": "next build",
    "start": "next start"
  },
  "dependencies": {
    "next":      "14.2.5",
    "react":     "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/node":  "^20.14.11",
    "@types/react": "^18.3.3",
    "autoprefixer": "^10.4.19",
    "postcss":      "^8.4.39",
    "tailwindcss":  "^3.4.6",
    "typescript":   "^5.5.3"
  }
}
```

#### `services/web/next.config.js`

```js
/** @type {import('next').NextConfig} */
module.exports = {
  output: 'standalone',
};
```

#### `services/web/tailwind.config.ts`

```ts
import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
};

export default config;
```

#### `services/web/postcss.config.js`

```js
module.exports = {
  plugins: { tailwindcss: {}, autoprefixer: {} },
};
```

#### `services/web/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

#### `services/web/app/globals.css`

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

#### `services/web/app/layout.tsx`

```tsx
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'InnoMonitor',
  description: 'innovaphone IPVA Event Monitoring',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body className="bg-gray-100 min-h-screen">{children}</body>
    </html>
  );
}
```

#### `services/web/app/page.tsx` — Hauptdashboard

```tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Instance {
  id: number;
  name: string;
  ip_address: string;
  location: string;
  cert_status: string;
  sip_status:  string;
  rtp_status:  string;
  h323_status: string;
  app_status:  string;
  last_seen: string | null;
}

const DOT: Record<string, string> = {
  CRITICAL: 'bg-red-500',
  WARNING:  'bg-yellow-400',
  OK:       'bg-green-500',
  UNKNOWN:  'bg-gray-400',
};

const BORDER: Record<string, string> = {
  CRITICAL: 'border-red-400',
  WARNING:  'border-yellow-300',
  OK:       'border-green-400',
  UNKNOWN:  'border-gray-300',
};

function worstStatus(inst: Instance) {
  const all = [inst.cert_status, inst.sip_status, inst.rtp_status,
               inst.h323_status, inst.app_status];
  if (all.includes('CRITICAL')) return 'CRITICAL';
  if (all.includes('WARNING'))  return 'WARNING';
  if (all.includes('OK'))       return 'OK';
  return 'UNKNOWN';
}

export default function Dashboard() {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [filter, setFilter]       = useState('');

  useEffect(() => {
    const load = () =>
      fetch('/api/instances/status').then(r => r.json()).then(setInstances);
    load();
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, []);

  const critical = instances.filter(i => worstStatus(i) === 'CRITICAL').length;
  const warning  = instances.filter(i => worstStatus(i) === 'WARNING').length;
  const ok       = instances.filter(i => worstStatus(i) === 'OK').length;

  const shown = instances.filter(i =>
    i.name.toLowerCase().includes(filter.toLowerCase()) ||
    i.ip_address.includes(filter)
  );

  return (
    <main className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">InnoMonitor</h1>
        <div className="flex gap-4 text-sm font-medium">
          <span className="text-red-600">{critical} CRITICAL</span>
          <span className="text-yellow-600">{warning} WARNING</span>
          <span className="text-green-600">{ok} OK</span>
        </div>
      </div>

      <div className="flex gap-3 mb-6">
        <input
          type="text"
          placeholder="Instanz suchen..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="border rounded px-3 py-2 text-sm w-64"
        />
        <Link href="/events" className="border rounded px-3 py-2 text-sm bg-white hover:bg-gray-50">
          Alle Events
        </Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3">
        {shown.map(inst => {
          const worst = worstStatus(inst);
          return (
            <Link
              key={inst.id}
              href={`/instance/${inst.id}`}
              className={`bg-white rounded-lg p-3 shadow-sm border-2 ${BORDER[worst]} hover:shadow-md transition-shadow`}
            >
              <p className="font-semibold text-xs mb-2 truncate" title={inst.name}>
                {inst.name !== inst.ip_address ? inst.name : inst.ip_address}
              </p>
              {(['cert','sip','rtp','h323','app'] as const).map(cat => {
                const key = `${cat}_status` as keyof Instance;
                return (
                  <div key={cat} className="flex items-center gap-1.5 mb-0.5">
                    <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${DOT[inst[key] as string] ?? 'bg-gray-400'}`} />
                    <span className="text-xs text-gray-500 uppercase">{cat}</span>
                  </div>
                );
              })}
              {inst.last_seen && (
                <p className="text-xs text-gray-400 mt-2 truncate">
                  {new Date(inst.last_seen).toLocaleTimeString('de-DE')}
                </p>
              )}
            </Link>
          );
        })}
        {shown.length === 0 && (
          <p className="col-span-full text-center text-gray-400 py-12">
            Noch keine Instanzen — warte auf ersten Webhook.
          </p>
        )}
      </div>
    </main>
  );
}
```

#### `services/web/app/instance/[id]/page.tsx` — Detailansicht

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

interface Event {
  id: number;
  category: string;
  severity: string;
  message: string;
  received_at: string;
}

const SEV: Record<string, string> = {
  CRITICAL: 'bg-red-100 text-red-700',
  WARNING:  'bg-yellow-100 text-yellow-700',
  INFO:     'bg-blue-50 text-blue-700',
};

export default function InstanceDetail() {
  const { id } = useParams<{ id: string }>();
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/instances/${id}/events`)
      .then(r => r.json())
      .then(data => { setEvents(data); setLoading(false); });
  }, [id]);

  return (
    <main className="p-6">
      <Link href="/" className="text-blue-600 hover:underline text-sm mb-4 inline-block">
        ← Zurück zum Dashboard
      </Link>
      <h1 className="text-xl font-bold mb-4">Instanz #{id} — Eventhistorie</h1>

      {loading ? (
        <p className="text-gray-400">Lade Events…</p>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="p-3 text-left">Zeit</th>
                <th className="p-3 text-left">Kategorie</th>
                <th className="p-3 text-left">Schweregrad</th>
                <th className="p-3 text-left">Nachricht</th>
              </tr>
            </thead>
            <tbody>
              {events.map(e => (
                <tr key={e.id} className="border-t hover:bg-gray-50">
                  <td className="p-3 text-gray-400 whitespace-nowrap">
                    {new Date(e.received_at).toLocaleString('de-DE')}
                  </td>
                  <td className="p-3 font-mono text-xs">{e.category}</td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${SEV[e.severity] ?? ''}`}>
                      {e.severity}
                    </span>
                  </td>
                  <td className="p-3 text-gray-700">{e.message}</td>
                </tr>
              ))}
              {events.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-gray-400">
                    Keine Events vorhanden
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
```

#### `services/web/app/events/page.tsx` — Alle Events mit Filtern

```tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Event {
  id: number;
  instance_name: string;
  ip_address: string;
  category: string;
  severity: string;
  message: string;
  received_at: string;
}

const SEV: Record<string, string> = {
  CRITICAL: 'bg-red-100 text-red-700',
  WARNING:  'bg-yellow-100 text-yellow-700',
  INFO:     'bg-blue-50 text-blue-700',
};

export default function EventsPage() {
  const [events,   setEvents]   = useState<Event[]>([]);
  const [category, setCategory] = useState('');
  const [severity, setSeverity] = useState('');

  useEffect(() => {
    const p = new URLSearchParams();
    if (category) p.set('category', category);
    if (severity) p.set('severity', severity);
    fetch(`/api/events?${p}`).then(r => r.json()).then(setEvents);
  }, [category, severity]);

  return (
    <main className="p-6">
      <Link href="/" className="text-blue-600 hover:underline text-sm mb-4 inline-block">
        ← Dashboard
      </Link>
      <h1 className="text-xl font-bold mb-4">Alle Events</h1>

      <div className="flex gap-3 mb-4">
        <select value={category} onChange={e => setCategory(e.target.value)}
                className="border rounded px-3 py-2 text-sm">
          <option value="">Alle Kategorien</option>
          {['CERTIFICATE','SIP','RTP','H323','APP_API','OTHER'].map(c => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select value={severity} onChange={e => setSeverity(e.target.value)}
                className="border rounded px-3 py-2 text-sm">
          <option value="">Alle Schweregrade</option>
          {['CRITICAL','WARNING','INFO'].map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="p-3 text-left">Zeit</th>
              <th className="p-3 text-left">Instanz</th>
              <th className="p-3 text-left">Kategorie</th>
              <th className="p-3 text-left">Schweregrad</th>
              <th className="p-3 text-left">Nachricht</th>
            </tr>
          </thead>
          <tbody>
            {events.map(e => (
              <tr key={e.id} className="border-t hover:bg-gray-50">
                <td className="p-3 text-gray-400 whitespace-nowrap">
                  {new Date(e.received_at).toLocaleString('de-DE')}
                </td>
                <td className="p-3 font-mono text-xs">
                  {e.instance_name !== e.ip_address ? e.instance_name : e.ip_address}
                </td>
                <td className="p-3 font-mono text-xs">{e.category}</td>
                <td className="p-3">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${SEV[e.severity] ?? ''}`}>
                    {e.severity}
                  </span>
                </td>
                <td className="p-3 text-gray-700">{e.message}</td>
              </tr>
            ))}
            {events.length === 0 && (
              <tr>
                <td colSpan={5} className="p-8 text-center text-gray-400">
                  Keine Events gefunden
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
```

#### `services/web/Dockerfile`

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
EXPOSE 3000
CMD ["node", "server.js"]
```

---

### Nginx

#### `nginx/nginx.conf`

```nginx
events {
  worker_connections 1024;
}

http {
  upstream api { server api:3001; }
  upstream web { server web:3000; }

  server {
    listen 80;

    location /api/ {
      proxy_pass         http://api/api/;
      proxy_set_header   Host              $host;
      proxy_set_header   X-Real-IP         $remote_addr;
      proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
    }

    location / {
      proxy_pass         http://web/;
      proxy_set_header   Host              $host;
      proxy_set_header   X-Real-IP         $remote_addr;
      proxy_http_version 1.1;
      proxy_set_header   Upgrade           $http_upgrade;
      proxy_set_header   Connection        "upgrade";
    }
  }
}
```

---

### Orchestrierung

#### `docker-compose.yml`

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB:       ${POSTGRES_DB:-innomonitor}
      POSTGRES_USER:     ${POSTGRES_USER:-inno}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-inno}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./services/db/init.sql:/docker-entrypoint-initdb.d/init.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-inno}"]
      interval: 5s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  api:
    build: ./services/api
    environment:
      DATABASE_URL: postgres://${POSTGRES_USER:-inno}:${POSTGRES_PASSWORD:-inno}@postgres:5432/${POSTGRES_DB:-innomonitor}
      PORT: 3001
    depends_on:
      postgres:
        condition: service_healthy
    restart: unless-stopped

  web:
    build: ./services/web
    depends_on:
      - api
    restart: unless-stopped

  nginx:
    image: nginx:alpine
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
    ports:
      - "80:80"
    depends_on:
      - api
      - web
    restart: unless-stopped

volumes:
  postgres_data:
```

#### `.env.example`

```env
POSTGRES_DB=innomonitor
POSTGRES_USER=inno
POSTGRES_PASSWORD=sicheres-passwort-hier-aendern
```

---

### Deployment-Befehle (auf der VM)

```bash
# Alles starten
docker compose up -d --build

# Status prüfen
docker compose ps

# Logs aller Services
docker compose logs -f

# Nur API-Logs
docker compose logs -f api

# Stoppen
docker compose down

# Stoppen + Datenbank löschen (Achtung: alle Daten weg!)
docker compose down -v
```

---

### Stufe 1 abschliessen — Instanznamen vergeben

Nachdem die ersten Webhooks eingegangen sind, werden Instanzen automatisch per IP angelegt.
Namen können direkt in der Datenbank vergeben werden:

```bash
# In die PostgreSQL-Shell
docker compose exec postgres psql -U inno -d innomonitor

# Namen vergeben
UPDATE instances SET name = 'Standort-Berlin-01', location = 'Berlin'
WHERE ip_address = '10.0.1.1';

UPDATE instances SET name = 'Standort-Hamburg-01', location = 'Hamburg'
WHERE ip_address = '10.0.1.2';

\q
```

---

## Stufe 2 — Echtzeit & Detailansicht

### Ziel
Dashboard aktualisiert sich automatisch, Instanznamen per UI pflegbar.

### Neue Features

**Server-Sent Events (SSE) statt Polling:**

Statt das Frontend alle 10s pollen zu lassen, pusht der Backend neue Status-Updates:

```js
// In status.js hinzufügen
router.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = async () => {
    const data = await getAllInstancesWithStatus();
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  send();
  const id = setInterval(send, 5000);
  req.on('close', () => clearInterval(id));
});
```

**Instanzverwaltung per API:**
```js
router.put('/instances/:id', async (req, res) => {
  const { name, location } = req.body;
  await pool.query(
    'UPDATE instances SET name = $1, location = $2 WHERE id = $3',
    [name, location, req.params.id]
  );
  res.json({ ok: true });
});
```

**UNKNOWN-Status nach 24h ohne Events:**

Cronjob im Backend (täglich):
```js
// Status auf UNKNOWN setzen wenn seit 24h kein Kontakt
await pool.query(`
  UPDATE instance_status
  SET cert_status = 'UNKNOWN', sip_status = 'UNKNOWN',
      rtp_status  = 'UNKNOWN', h323_status = 'UNKNOWN', app_status = 'UNKNOWN'
  WHERE last_seen < NOW() - INTERVAL '24 hours'
`);
```

---

## Stufe 3 — Produktionsreife

### HTTPS mit selbstsigniertem Zertifikat

```bash
# Auf der VM: selbstsigniertes Zertifikat erstellen
mkdir -p nginx/certs
openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
  -keyout nginx/certs/server.key \
  -out    nginx/certs/server.crt \
  -subj "/CN=innomonitor.intern"
```

Nginx um SSL erweitern (`nginx/nginx.conf`):
```nginx
server {
  listen 443 ssl;
  ssl_certificate     /etc/nginx/certs/server.crt;
  ssl_certificate_key /etc/nginx/certs/server.key;
  # ... gleiche location-Blöcke wie HTTP
}

server {
  listen 80;
  return 301 https://$host$request_uri;
}
```

Zertifikat-Volume in `docker-compose.yml` für nginx hinzufügen:
```yaml
nginx:
  volumes:
    - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
    - ./nginx/certs:/etc/nginx/certs:ro
```

**innovaphone IPVA auf HTTPS umstellen:** Type von `HTTP` auf `HTTPS` ändern, Port auf `443`.
Da das Zertifikat selbstsigniert ist, muss in der IPVA ggf. die Zertifikatsprüfung deaktiviert werden.

### Webhook-Authentifizierung

Gemeinsames Secret zwischen IPVA und Server:

```js
// In webhook.js
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

router.post('/webhook', (req, res, next) => {
  if (WEBHOOK_SECRET && req.headers['x-webhook-secret'] !== WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}, async (req, res) => { /* ... */ });
```

### Alerting per E-Mail bei CRITICAL Events

```bash
# Nodemailer hinzufügen
npm install nodemailer
```

```js
// In webhook.js nach updateStatus():
if (severity === 'CRITICAL') {
  await sendAlert(instance, category, payload.message);
}
```

### Automatisches Cleanup alter Events

```js
// Täglich ausführen (z.B. via setInterval beim Start)
setInterval(async () => {
  await pool.query(
    "DELETE FROM events WHERE received_at < NOW() - INTERVAL '90 days'"
  );
}, 24 * 60 * 60 * 1000);
```

### PostgreSQL-Backup

```bash
# Auf der VM als Cronjob einrichten
crontab -e
```

```cron
0 2 * * * docker exec innomonitor-postgres-1 pg_dump -U inno innomonitor \
  > /home/innomonitor/backups/innomonitor_$(date +\%Y\%m\%d).sql
```

---

## innovaphone Konfiguration

In der Event-App jeder der 90 IPVA-Instanzen:

| Feld | Wert (Stufe 1) | Wert (Stufe 3) |
|------|----------------|----------------|
| Enable | Ja | Ja |
| Type | HTTP | HTTPS |
| Address | `10.0.10.50` | `10.0.10.50` |
| Port | `80` | `443` |
| Path | `/api/webhook` | `/api/webhook` |
| Method | POST | POST |
| Header | — | `X-Webhook-Secret: <secret>` |

**Wo in der IPVA:**
`Konfiguration → Apps → Events → Webhook` (genaue Menüpfade je nach Firmware-Version)

---

## Abnahmekriterien — Stufe 1

- [ ] `docker compose up -d --build` baut und startet alle 4 Container fehlerfrei
- [ ] `docker compose ps` zeigt alle Services als `Up`
- [ ] Test-Webhook per curl liefert `{"status":"received"}`
- [ ] Event erscheint in PostgreSQL: `SELECT * FROM events;`
- [ ] Dashboard unter `http://<VM-IP>` zeigt die Instanz als Kachel
- [ ] Ampelfarbe ändert sich nach eingehenden Events korrekt
- [ ] Klick auf Instanz öffnet Detailseite mit Eventliste
- [ ] Events-Seite zeigt alle Events mit funktionierenden Filtern

---

## Verständnisfragen

1. Warum PostgreSQL statt SQLite — welchen Vorteil hat es bei 90 gleichzeitigen Webhooks?
2. Was passiert, wenn eine IPVA offline geht und nie wieder einen Webhook sendet — wie erkennen wir das?
3. Warum speichern wir den `raw_payload` als JSONB, obwohl wir ihn bereits kategorisieren?
4. Nginx steht vor dem Backend und dem Frontend — welche zwei Probleme löst das gleichzeitig?
5. Was ist der Unterschied zwischen `depends_on: - postgres` und `depends_on: postgres: condition: service_healthy`?

---

## Wichtige Hinweise

- **Feste IP der VM** — alle 90 Instanzen müssen die gleiche Zieladresse kennen; DHCP würde das System unzuverlässig machen
- **Firewall-Regel auf dem VLAN-Switch** — Port 80 (und 443 in Stufe 3) von allen IPVA-Subnetzen zur Monitoring-VM erlauben
- **innovaphone Webhook-Format** — das genaue JSON-Format variiert je nach IPVA-Firmware; beim ersten Einsatz immer die Logs prüfen (`docker compose logs api`) und `events.js` ggf. anpassen
- **Datenbankpasswort** — `.env` niemals ins Git-Repository committen; `.env.example` als Vorlage verwenden
- **Zertifikatsgültigkeit** — das selbstsignierte Zertifikat ist 10 Jahre gültig; bei Ablauf neu erstellen und nginx neustarten

---

*Bereit wenn du es bist. Bei Fragen einfach Claude fragen.*
