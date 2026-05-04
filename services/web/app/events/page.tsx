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