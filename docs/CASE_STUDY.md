# DevTrace: replacing browser-only monitoring with an API boundary

## Problem

The original DevTrace UI looked like a monitoring dashboard but held both its synthetic examples and captured errors in localStorage. That demonstrated grouping and inspection, but not server ingestion or shared persistent storage. The engineering objective was to preserve the interface while making its data path explicit and testable.

## Implemented changes

The existing React/TypeScript dashboard now has two clearly labeled data sources. Demo Data remains a synthetic local fixture. Live monitoring uses an Express API and has no local fallback. A collector listens for browser `error` and `unhandledrejection` events, sanitizes available context, and submits an HTTP payload. It reports success only after the API acknowledges the event.

The JavaScript backend contains real Mongoose models and operations. An ErrorEvent represents one occurrence; Issue holds a unique fingerprint and manual status. Fingerprints hash a normalized tuple of type, message and source position. Unique event IDs support idempotent retries. Counts and first/last timestamps are derived from stored event records, avoiding a separately maintained counter across two documents. This choice trades aggregate read cost for a simpler consistency story at prototype scale.

The API validates JSON fields, bounds payloads, handles database errors, restricts origins/hosts, and defaults to loopback. Externally bound instances require a token. The frontend uses server results for live cards/chart, retrieves issue details separately, and exposes connection failures. Its existing visual structure is retained.

## Evidence and limits

The audit inspected source rather than inferring behavior from the dashboard. The original 12 tests passed. After implementation, 25 unit/HTTP tests passed and the TypeScript/Vite build succeeded. Tests exercised real Express request rejection, missing-database responses, security guards, fingerprint parity, HTTP collector contract behavior and failure containment.

**MongoDB persistence is not yet verified.** The real MongoDB test command failed its connection prerequisite in this environment; no persistence assertion ran. Actual browser TypeError capture, Network-panel evidence, page reload persistence and screenshots are also Not Tested. A supplied integration suite uses a real database and fresh API process, and a manual checklist covers the remaining browser evidence. These pending gates must be completed before presenting the project as an end-to-end verified monitoring service.

The hosted Site is the frontend. A separate HTTPS Node service and MongoDB connection remain necessary. Source is prepared for GitHub, including CI, but no GitHub push or successful workflow run is claimed.

## Interview discussion and attribution

Be prepared to explain event versus issue, fingerprint collisions/splits, idempotent retry versus a new occurrence, aggregate counts, two-write failure behavior, manual resolution, HTTP error states and the difference between a transport fixture and persistence evidence.

This implementation was created with AI assistance in ChatGPT Work. The student's independent authorship, understanding and later contributions are not inferred. Before submitting, reproduce the workflow, inspect the code, record the completed tests and describe personal contributions accurately. A defensible statement today is: “I am developing an AI-assisted error-monitoring prototype. Its API guards and transport logic are tested; real database and browser acceptance remain outstanding.” Update that statement only when the missing evidence exists.
