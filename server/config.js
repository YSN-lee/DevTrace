export function readConfig(env = process.env) {
  const host = env.HOST || '127.0.0.1';
  const port = Number(env.PORT || 3001);
  const token = env.API_TOKEN || '';
  const remote = !['127.0.0.1', 'localhost', '::1'].includes(host);
  const origins = (env.ALLOWED_ORIGINS || 'http://127.0.0.1:4173,http://localhost:4173,http://127.0.0.1:3001,http://localhost:3001').split(',').map(s => s.trim());
  const hosts = (env.ALLOWED_HOSTS || 'localhost,127.0.0.1,[::1]').split(',').map(s => s.trim());
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be 1–65535.');
  if (token && token.length < 32) throw new Error('API_TOKEN must have at least 32 characters.');
  if (remote && (!token || !env.ALLOWED_ORIGINS || !env.ALLOWED_HOSTS)) throw new Error('Network binding requires API_TOKEN, ALLOWED_ORIGINS and ALLOWED_HOSTS.');
  for (const origin of origins) {
    let url; try { url = new URL(origin); } catch { throw new Error('ALLOWED_ORIGINS must contain exact URL origins.'); }
    if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol) || (url.protocol !== 'https:' && !['localhost','127.0.0.1','[::1]'].includes(url.hostname)))
      throw new Error('Origins require HTTPS, except localhost.');
  }
  if (hosts.some(s => !s || s.includes('*') || s.includes('/') || s.includes(':') && s !== '[::1]')) throw new Error('ALLOWED_HOSTS must contain exact hostnames without ports.');
  return { host, port, token, origins, hosts, mongoUri: env.MONGODB_URI || 'mongodb://127.0.0.1:27017/devtrace' };
}
