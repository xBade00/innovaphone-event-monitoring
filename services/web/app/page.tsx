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