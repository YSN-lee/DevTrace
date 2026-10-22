import { capture, type RawEvent, type TraceEvent } from './core.ts';
type Callbacks = { send: (event: TraceEvent) => Promise<TraceEvent>; onCapture: (event: TraceEvent) => void | Promise<void>; onFailure: (message: string) => void };
let removeCurrent: (() => void) | undefined;
export function installCollector({ send, onCapture, onFailure }: Callbacks): () => void {
  if (removeCurrent) removeCurrent();
  let active = true; let pending = 0; let arrivals: number[] = [];
  const fail = (message: string) => { try { onFailure(message); } catch { /* Reporting must not create another unhandled error. */ } };
  const report = async (raw: RawEvent) => {
    if (!active) return;
    const now = Date.now(); arrivals = arrivals.filter(t => now - t < 10000);
    if (arrivals.length >= 20 || pending >= 10) { fail('Capture limit reached. Wait a few seconds before trying again.'); return; }
    arrivals.push(now); pending++;
    try {
      const event = await capture(raw);
      if (!active) return;
      const stored = await send(event);
      if (active) await onCapture(stored);
    }
    catch { if (active) fail('Delivery not confirmed. Check the API connection, then refresh before retrying.'); }
    finally { pending--; }
  };
  const onError = (e: ErrorEvent) => { try { if (!e.message) return; void report({ type: e.error instanceof Error ? e.error.name : 'Error', message: e.message, kind: 'error', stack: e.error instanceof Error ? e.error.stack : undefined, source: e.filename || undefined, line: e.lineno || undefined, column: e.colno || undefined, page: location.pathname }); } catch { /* Leave the host running. */ } };
  const onRejection = (e: PromiseRejectionEvent) => { try { const reason = e.reason; void report({ type: reason instanceof Error ? reason.name : 'NonErrorRejection', message: reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : 'Unhandled non-Error rejection', stack: reason instanceof Error ? reason.stack : undefined, kind: 'unhandledrejection', page: location.pathname }); } catch { /* Leave the host running. */ } };
  window.addEventListener('error', onError); window.addEventListener('unhandledrejection', onRejection);
  const cleanup = () => { active = false; window.removeEventListener('error', onError); window.removeEventListener('unhandledrejection', onRejection); if (removeCurrent === cleanup) removeCurrent = undefined; };
  removeCurrent = cleanup; return cleanup;
}
export function triggerTypeError() { setTimeout(() => { const products = JSON.parse('null'); products.map((p: unknown) => p); }, 0); }
export function triggerRejection() { void Promise.reject(new Error('Checkout request timed out')); }
export function triggerReferenceError() { setTimeout(() => { throw new ReferenceError('cartTotal is not defined'); }, 0); }
