import { readConfig } from './config.js';
import { connectDatabase } from './models.js';
import { createRepository } from './repository.js';
import { createApp } from './app.js';

let database;
try {
  const config = readConfig();
  database = await connectDatabase(config.mongoUri);
  const app = createApp({ repository: createRepository(database), config });
  const server = app.listen(config.port, config.host, () => console.log(`DevTrace API ready on ${config.host}:${config.port}; MongoDB connected.`));
  server.on('error', async () => { console.error('API could not listen on the configured host/port.'); await database.connection.close(); process.exitCode = 1; });
  const stop = () => {
    server.close(async () => { await database.connection.close(); process.exit(0); });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
} catch {
  console.error('DevTrace API startup failed. Check .env configuration and MongoDB availability. Credentials are never printed.');
  if (database) await database.connection.close().catch(() => {});
  process.exitCode = 1;
}
