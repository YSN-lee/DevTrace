# Manual acceptance checklist

**All browser steps below are currently Not Tested.** Record the date, browser version, source commit and actual outcome when executed. Use controlled test errors only. Run `npm test`, `npm run build` and the real MongoDB integration suite first.

## Local setup

1. Follow README setup. Verify `docker compose ps` reports healthy MongoDB (or use a real MongoDB 7+ instance).
2. Start `npm run server`; readiness must say MongoDB connected. Start `npm run dev` separately.
3. Open `http://127.0.0.1:4173`. Choose **Live monitoring**. A blank API URL uses Vite's proxy.
4. Open browser developer tools, select Network, filter `/api/`, and enable Preserve log. `GET /api/health` should return 200 and `database: connected`; `GET /api/issues` should return actual stored results.

## Complete error path

| Step | Expected result | Evidence to record |
|---|---|---|
| Demo Lab → TypeError | Real uncaught exception in console; exactly one `POST /api/events` | Console entry, request payload and response status |
| Inspect response | 201, `ok: true`, stored event ID, fingerprint, server timestamp | JSON response without tokens |
| Query MongoDB directly | Matching event exists in `devtrace.errorevents`; matching metadata in `devtrace.issues` | mongosh output with IDs and count |
| Open Issues / inspect drawer | Actual error message, stack, source, count and timestamps | Screenshot of live mode and detail |
| Trigger same TypeError again | New event ID, same fingerprint, count increases by one | Before/after detail counts |
| Trigger ReferenceError | Different fingerprint, separate issue | Issue list and database query |
| Repeat ×3 | Three new event IDs under one matching TypeError issue | Count increase by three, not three duplicate issues |
| Reload page and select Live monitoring | Previously stored events remain | Same event IDs and counts after fresh GET |
| Resolve issue, reload, select Live | Status still resolved | PATCH response, database status, screenshot after reload |
| Trigger resolved issue again | Count increases; status stays resolved until explicitly reopened | Detail response |

A controlled database inspection using the included Compose service:

```bash
docker compose exec mongo mongosh devtrace --quiet --eval 'db.errorevents.find({}, {eventId:1,fingerprint:1,type:1,timestamp:1}).sort({timestamp:-1}).limit(5).toArray()'
docker compose exec mongo mongosh devtrace --quiet --eval 'db.issues.find({}, {fingerprint:1,status:1}).toArray()'
```

For an external token-protected API, refresh clears the in-memory token. Re-enter it to read the same persistent records; lack of a token is not loss of database data.

## Failure and isolation checks

| Action | Required behavior |
|---|---|
| Stop the backend, refresh activity | Explicit disconnected/error message; no success toast or fabricated empty metrics |
| Restart backend | Refresh reconnects and retrieves existing database records |
| Stop MongoDB while API is running | Requests fail with bounded 503 behavior; no local persistence fallback |
| Restart MongoDB | Verify recovery after refreshing; restart the API if its initial startup failed |
| Submit `{}` to `POST /api/events` with JSON content type | 400, stable error object and request ID |
| Submit >16 KiB JSON / incorrect content type | 413 / 415 |
| Use wrong bearer token on configured server | 401; no event content leaked |
| Send disallowed Origin / Host | 403 |
| Switch to Demo Data, restore it | Exactly six fixture issues / 76 synthetic events; MongoDB contents unchanged |
| View event stream, search, change time range and paginate | Correct records and honest 1,000-summary scope; all-range cards stay independent of table filters |
| Select last page of open issues, resolve last visible issue | Pagination adjusts to available results |
| Export live events | JSON says live and identifies bounded event-summary scope; no fake fixture records |

Example invalid request (only a local, unprotected development API):

```bash
curl -i http://127.0.0.1:3001/api/events -H 'Content-Type: application/json' --data '{}'
```

## Existing UI regression checks

- Check desktop and narrow mobile widths: navigation, banner, connection controls, table scrolling and drawer remain usable.
- Check keyboard Tab order, Escape to close dialogs, focus returning to the invoking control, and `/` search shortcut.
- Check issue overview / stack / occurrences tabs, copy, status buttons and JSON export.
- Verify a failed status update never displays a success notification.
- Confirm token is absent from localStorage, sessionStorage, URLs, screenshots and exported event JSON. Only the API base URL is in sessionStorage.

## Screenshots to add after verification

Create `docs/screenshots/` and capture actual application screens, not design mockups:

1. `live-issue.png`: Live monitoring list after an acknowledged MongoDB write.
2. `live-occurrences.png`: one issue after repeated errors, showing count and real timestamps.
3. `network-ingestion.png`: actual POST status/payload and response, with authorization headers hidden.
4. `resolved-after-reload.png`: persisted resolved status after a fresh read.

Record each screenshot's date, source commit and test step in the verification report. Do not claim these screenshots exist until they are captured.
