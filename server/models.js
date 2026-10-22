import mongoose from 'mongoose';

export function createModels(connection) {
  const options = { strict: 'throw', versionKey: false, bufferCommands: false };
  const issueSchema = new mongoose.Schema({
    fingerprint: { type: String, required: true, unique: true, match: /^[a-f0-9]{64}$/ },
    status: { type: String, enum: ['open', 'resolved'], default: 'open', required: true }
  }, { ...options, timestamps: true });
  const eventSchema = new mongoose.Schema({
    eventId: { type: String, required: true, unique: true },
    fingerprint: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
    payloadHash: { type: String, required: true },
    type: { type: String, required: true, maxlength: 64 },
    message: { type: String, required: true, maxlength: 1024 },
    kind: { type: String, enum: ['error', 'unhandledrejection'], required: true },
    stack: { type: String, maxlength: 8192 }, source: { type: String, maxlength: 1024 },
    page: { type: String, maxlength: 1024 }, line: Number, column: Number,
    timestamp: { type: Number, required: true }, clientTimestamp: Number
  }, options);
  eventSchema.index({ timestamp: -1, _id: -1 });
  eventSchema.index({ fingerprint: 1, timestamp: -1 });
  return { Issue: connection.model('Issue', issueSchema), ErrorEvent: connection.model('ErrorEvent', eventSchema) };
}

export async function connectDatabase(uri) {
  const connection = mongoose.createConnection(uri, {
    serverSelectionTimeoutMS: 3000, connectTimeoutMS: 3000, socketTimeoutMS: 8000,
    maxPoolSize: 10, bufferCommands: false, autoIndex: false, writeConcern: { w: 'majority' }
  });
  try {
    await connection.asPromise();
    const models = createModels(connection);
    // Unique indexes exist before the server can accept concurrent ingestion.
    await Promise.all(Object.values(models).map(model => model.createIndexes()));
    return { connection, ...models };
  } catch (error) { await connection.close().catch(() => {}); throw error; }
}
