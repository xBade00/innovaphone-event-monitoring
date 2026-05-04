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