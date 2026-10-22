# DevTrace audit — 2026-10-20, before implementation

Audited source commit: `d9f6266fc71f9b2103de2fc90e1b11a81317eccd`.
Source inspected directly; the existing checkout was clean. No UI claims were inferred from appearance.

| Feature | Baseline classification | Evidence |
|---|---|---|
| React + TypeScript / Vite static build | Implemented and verified | package.json, src/main.tsx, source manifest |
| Dashboard data loading | Implemented and verified at source level | App.tsx reads two localStorage workspaces; no fetch/API |
| Synthetic sample statistics | Simulated | sampleWorkspace() creates 76 fixture events / six issues |
| Deterministic SHA-256 grouping | Implemented and verified | core.ts and passing Node tests |
| Redaction, limits, JSON round-trip, manual status semantics | Implemented and verified at source level | 12/12 existing Node tests passed in this session |
| Real browser error/rejection listeners | Implemented but unverified in a real browser | collector.ts, EventTarget-based listener tests only |
| Intentional Demo Lab errors | Implemented but unverified in a real browser | actual null.map, rejected Promise, ReferenceError code |
| LocalStorage after browser reload | Implemented but unverified | save/read effects; pure JSON round-trip test only |
| Search, filters, drawers, navigation, chart, export, responsive UI | Implemented but unverified in a browser | React/CSS inspected; no browser automation available |
| Express API / HTTP ingestion | Missing | no server, endpoints or network transport |
| MongoDB / Mongoose persistence | Missing | no database models, connection or credentials |
| Cross-device persistence / authentication | Missing | browser-only state |
| GitHub repository | Missing / access unavailable | Site has its own source repository; GitHub was not connected |

## Runtime and hosting evidence

- The existing Site is static (`static.directory = dist`) and owner-private.
- The Sites platform reference specifies Cloudflare Workers, 128 MB isolates, HTTP external connections and no raw TCP. It cannot directly host this persistent Express process or a MongoDB TCP driver connection.
- An external HTTPS API is the smallest compatible arrangement. The frontend must contain only a public API base URL; MongoDB credentials belong to the backend.
- Node/npm are available. No mongod, mongosh, Docker or Podman executable was found. No MongoDB environment configuration or service on 127.0.0.1:27017 was present.
- An ordinary HTTPS request to the official MongoDB binary download timed out at the network proxy. No alternative database was substituted.
- The supported browser QA tool is unavailable in this managed environment. Actual browser interaction, Network panel evidence and screenshots are **Not Tested**. No screenshots will be fabricated.

## Reuse and implementation decision

Retain branding, navigation, CSS, cards, issue table, detail drawer and lab controls. Retain browser sanitization/fingerprint fixtures and tests. Keep localStorage solely for explicitly labeled **Demo Data**. Add a separate Express/Mongoose server, real fetch transport, live API state, bounded reads, server validation and controlled local-first access. A disconnected API must remain visibly disconnected, never fall back to simulated success.
