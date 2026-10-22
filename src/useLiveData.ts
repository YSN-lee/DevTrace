import { useEffect, useState } from 'react';
import { createApi, type ListQuery, type Snapshot } from './api.ts';

export function useLiveData(enabled: boolean, api: ReturnType<typeof createApi>, query: ListQuery) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const queryKey = JSON.stringify(query);
  useEffect(() => { setSnapshot(null); setError(''); }, [api]);
  useEffect(() => {
    if (!enabled) return;
    let active = true; const controller = new AbortController();
    setLoading(true); setError('');
    void (async () => {
      try {
        const health = await api.health(controller.signal);
        if (health.database !== 'connected' || health.storage !== 'mongodb') throw new Error('The API did not confirm a MongoDB connection.');
        const next = await api.list(JSON.parse(queryKey), controller.signal);
        if (active) setSnapshot(next);
      } catch (e) {
        if (active) { setSnapshot(null); setError(e instanceof Error ? e.message : 'The API request failed.'); }
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; controller.abort(); };
  }, [enabled, api, queryKey, revision]);
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => { if (document.visibilityState === 'visible') setRevision(v => v + 1); }, 15000);
    return () => clearInterval(timer);
  }, [enabled]);
  return { snapshot, error, loading, ready: enabled && !!snapshot && !error, refresh: () => setRevision(v => v + 1) };
}
