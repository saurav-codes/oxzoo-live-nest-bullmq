# nest-bullmq

> **Role in the zoo:** project `nest-bullmq` of [oxzoo-live](https://github.com/saurav-codes/oxzoo-live-control/blob/main/zoo/README.md#projects), deployed with ox on server s1 at https://nest-bullmq.s1.zoo.sorv.dev. The contract it follows is [DESIGN.md](https://github.com/saurav-codes/oxzoo-live-control/blob/main/zoo/DESIGN.md).

NestJS + BullMQ on s1 (`nest-bullmq.s1.zoo.sorv.dev`). The app enqueues jobs in
BullMQ on a private Redis; a separate worker process (an ox worker) hashes the text
and writes the result to the shared Postgres. Proof level P2.

## What it proves

- An ox `[workers]` process that is not the web app, consuming a queue the app fills.
- Built-in services: shared postgres 18 (`DATABASE_URL`) and a private redis 8 (`REDIS_URL`, carries its password).
- `[build] migrate` running before the switch, and an `[app] health` path gating traffic.
- `/_zoo/probe` reports, with real round trips:
  - `postgres`: insert, read back, delete a `zoo_probe` row, with the server version.
  - `redis`: SET with a 10 s TTL, GET, PTTL, DEL.
  - `bullmq`: adds a `probe` job and waits up to 4.5 s for the worker to finish it; the worker writes a `job_results` row, the probe checks the returned value and the row, then deletes the row. With the worker down it fails honestly: `no worker finished the job within 4500 ms (is the worker running?)` (the job is removed).
  - `worker`: the heartbeat the worker writes to Redis every 5 s (stale after 15 s).

## App

- `GET /` page: queue counts, a form to enqueue a job, the 20 newest results.
- `GET /api/queue` the same as JSON. `POST /api/jobs` `{"text": "..."}` (1 to 200 printable characters, 30 per minute per process) answers 202 `{"id", "queued": true}`.
- `GET /_zoo/health`, `GET /_zoo/probe` per DESIGN.md, with CORS from `ZOO_PANEL_ORIGIN`.

## ox features exercised

`[app] health`, detected start (`npm run start:prod`) and build (`npm ci`, `npm run build`, whose `postbuild` writes `dist/build-info.json` for `build.built_at`), `[build] migrate`, `[workers]`, `[services] postgres` (shared) and `redis` (private), node 24 from `engines`.

## Variables

| Variable | Source | Role in probe `vars` |
|----------|--------|----------------------|
| `DATABASE_URL` | provided (postgres) | `service`, fingerprint only |
| `REDIS_URL` | provided (redis) | `service`, fingerprint only |
| `ZOO_PANEL_ORIGIN` | yours, plain | `plain` |

Also read: `PORT`, `HOST`, `OX_RELEASE`, `OX_ENV`, `PUBLIC_HOST` (provided).
The role `service` for provided service keys is not in the DESIGN.md role list yet (see the lead's FINDINGS).

## Tests

```
npm ci
npm test          # node:test on src/zoo.ts, src/jobs.ts, src/page.ts: 14 pass
npm run build
```

Tested locally on 2026-10-09 against brew postgresql 18.6 and redis 8.10 on random
ports: probe `ok: true` (all four checks) with the worker running, the bullmq and
worker checks failing with the messages above when it is stopped, a third parallel
probe answering 429 after 5 s, CORS headers only for listed origins, and the page
enqueueing through the form.

## ox check

```
ox check oxzoo-live/nest-bullmq (manifest: ox.toml)

  app.start                  npm run start:prod                                   detected:package.json
  app.health                 /_zoo/health                                         declared
  build.install              npm ci                                               detected:package-lock.json
  build.commands[0]          npm run build                                        detected:package.json
  build.migrate              node dist/migrate                                    declared
  workers.worker             exec node dist/worker                                declared
  tools.node                 24                                                   detected:package.json
  services.postgres          postgres 18 (shared)                                 default
  services.redis             redis 8 (only for this project)                      default

  Provided by ox: PORT, HOST, OX_ENV, OX_PROJECT, OX_RELEASE, OX_DATA_DIR, PUBLIC_URL, PUBLIC_HOST, DATABASE_URL, REDIS_URL
  Set on the dashboard before the first deploy: ZOO_PANEL_ORIGIN

Ready to deploy.
```
