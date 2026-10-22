import { ApiError } from './validation.js';

export function publicEvent(doc) {
  const event = { id: doc.eventId, fingerprint: doc.fingerprint, timestamp: doc.timestamp, synthetic: false };
  for (const key of ['type', 'message', 'kind', 'stack', 'source', 'page', 'line', 'column', 'clientTimestamp']) if (doc[key] !== undefined) event[key] = doc[key];
  return event;
}
function publicIssue(row) {
  return { id: row._id, label: 'DT-' + row._id.slice(0, 4).toUpperCase(), type: row.type,
    message: row.message, kind: row.kind, source: row.source || 'Source unavailable',
    status: row.status, count: row.count, firstSeen: row.firstSeen, lastSeen: row.lastSeen,
    events: row.events.map(publicEvent), recentTimestamps: row.recentTimestamps };
}
const groupStages = (detail = false) => [
  { $group: { _id: '$fingerprint', count: { $sum: 1 }, firstSeen: { $min: '$timestamp' }, lastSeen: { $max: '$timestamp' },
    events: { $topN: { sortBy: { timestamp: -1, _id: -1 }, output: '$$ROOT', n: detail ? 20 : 1 } },
    recentTimestamps: { $topN: { sortBy: { timestamp: -1, _id: -1 }, output: '$timestamp', n: 20 } } } },
  { $lookup: { from: 'issues', localField: '_id', foreignField: 'fingerprint', as: 'metadata' } },
  { $set: { status: { $ifNull: [{ $arrayElemAt: ['$metadata.status', 0] }, 'open'] }, latest: { $arrayElemAt: ['$events', 0] } } },
  { $set: { type: '$latest.type', message: '$latest.message', source: '$latest.source', kind: '$latest.kind' } },
  { $unset: ['latest', 'metadata'] }
];
const regexEscape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function createRepository({ connection, Issue, ErrorEvent }) {
  const assertReady = () => { if (connection.readyState !== 1) throw new ApiError(503, 'DATABASE_UNAVAILABLE', 'The database is unavailable. No local fallback is used.'); };
  const aggregate = pipeline => ErrorEvent.aggregate(pipeline).option({ maxTimeMS: 5000, allowDiskUse: true });
  return {
    async health() { assertReady(); await connection.db.admin().ping(); return { status: 'ready', database: 'connected', storage: 'mongodb', version: '0.2.0' }; },
    async ingest(clean) {
      assertReady();
      try { await Issue.updateOne({ fingerprint: clean.fingerprint }, { $setOnInsert: { fingerprint: clean.fingerprint, status: 'open' } }, { upsert: true, runValidators: true }); }
      catch (error) { if (error.code !== 11000) throw error; }
      let duplicate = false;
      try {
        const result = await ErrorEvent.updateOne({ eventId: clean.eventId }, { $setOnInsert: { ...clean, timestamp: Date.now() } }, { upsert: true, runValidators: true });
        duplicate = result.upsertedCount === 0;
      } catch (error) { if (error.code !== 11000) throw error; duplicate = true; }
      const stored = await ErrorEvent.findOne({ eventId: clean.eventId }).lean().maxTimeMS(5000);
      if (!stored) throw new ApiError(503, 'WRITE_UNCONFIRMED', 'The write could not be confirmed. Retry with the same eventId.');
      if (stored.payloadHash !== clean.payloadHash) throw new ApiError(409, 'EVENT_ID_CONFLICT', 'This eventId already belongs to a different payload.');
      return { event: publicEvent(stored), issueId: stored.fingerprint, duplicate };
    },
    async list({ range, status, kind, q, page, limit }) {
      assertReady(); const now = Date.now();
      const first = range === 'all' ? await ErrorEvent.findOne().sort({ timestamp: 1 }).select('timestamp').lean().maxTimeMS(5000) : null;
      const hours = range === 'all' ? Math.max(24, Math.ceil((now - (first?.timestamp ?? now)) / 3600000)) : Number(range);
      const start = now - hours * 3600000;
      const match = { timestamp: { $gte: start, $lte: now } };
      const filter = {};
      if (status !== 'all') filter.status = status;
      if (kind !== 'all') filter.kind = kind;
      if (q) {
        const regex = regexEscape(q);
        filter.$or = ['type', 'message', 'source'].map(key => ({ [key]: { $regex: regex, $options: 'i' } }));
        if (/^DT-[a-f0-9]{1,64}$/i.test(q)) filter.$or.push({ _id: { $regex: '^' + q.slice(3).toLowerCase() } });
      }
      const [result] = await aggregate([
        { $match: match },
        { $facet: {
          rows: [...groupStages(), { $match: filter }, { $sort: { lastSeen: -1, _id: 1 } }, { $skip: (page - 1) * limit }, { $limit: limit }],
            total: [...groupStages(), { $match: filter }, { $count: 'count' }],
            summary: [...groupStages(), { $group: { _id: null, events: { $sum: '$count' }, issues: { $sum: 1 },
              open: { $sum: { $cond: [{ $eq: ['$status', 'open'] }, 1, 0] } },
              resolved: { $sum: { $cond: [{ $eq: ['$status', 'resolved'] }, 1, 0] } }, lastSeen: { $max: '$lastSeen' } } }],
          recentEvents: [{ $sort: { timestamp: -1, _id: -1 } }, { $limit: 1000 }, { $project: { payloadHash: 0, stack: 0, page: 0 } }],
          activity: [{ $project: { bin: { $min: [47, { $floor: { $divide: [{ $subtract: ['$timestamp', start] }, hours * 3600000 / 48] } }] } } }, { $group: { _id: '$bin', count: { $sum: 1 } } }]
        } }
      ]);
      const grouped = result;
      const summary = grouped.summary[0] || { events: 0, issues: 0, open: 0, resolved: 0, lastSeen: 0 };
      delete summary._id;
      const activity = Array(48).fill(0);
      for (const row of result.activity) activity[row._id] = row.count;
      const total = grouped.total[0]?.count || 0;
      return { items: grouped.rows.map(publicIssue), summary, activity,
        recentEvents: result.recentEvents.map(publicEvent), eventsTruncated: summary.events > 1000,
        pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
        window: { from: start, to: now, hours }, generatedAt: now };
    },
    async detail(id) {
      assertReady(); const [row] = await aggregate([{ $match: { fingerprint: id } }, ...groupStages(true)]);
      if (!row) throw new ApiError(404, 'ISSUE_NOT_FOUND', 'No stored events belong to this issue.');
      return publicIssue(row);
    },
    async updateStatus(id, status) {
      assertReady();
      if (!await ErrorEvent.exists({ fingerprint: id })) throw new ApiError(404, 'ISSUE_NOT_FOUND', 'No stored events belong to this issue.');
      await Issue.updateOne({ fingerprint: id }, { $set: { status } }, { runValidators: true });
      return this.detail(id);
    }
  };
}
