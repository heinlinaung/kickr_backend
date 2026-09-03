# Change Log — 2026-09-03 · Dockerfile fixes

**Branch:** `events-feature-spec`
**Verified:** by inspection and by running the production entrypoint locally.
**The image has NOT been built** — see §6.

---

## 1. The container would have crashed on start

`CMD ["node", "dist/main"]` — but the build emits **`dist/src/main.js`**.

The image would build successfully and then die immediately with
`MODULE_NOT_FOUND`. Nothing in the build catches it, because the path is only
resolved at container start.

**Root cause:** `tsconfig.json` sets `outDir` but no `rootDir`, so TypeScript
infers the root from the common ancestor of all inputs. `scripts/` is compiled
alongside `src/`, making that ancestor the project root — so output nests as
`dist/src/` and `dist/scripts/`.

Fixed by pointing the commands at the real path rather than changing the
layout: setting `rootDir: "./src"` would give the conventional flat `dist/` but
would drop `scripts/` from the build, and those maintenance scripts are
compiled on purpose.

**`package.json` had the same bug.** `start:prod` was also `node dist/main`, so
production start was broken outside Docker too. Both now use `dist/src/main`.

## 2. Verified without Docker

The daemon is not running in this environment and the sandbox has no network,
so `docker build` was not possible. What *was* possible is the check that
matters most:

```
$ node dist/src/main
[Nest] LOG [NestFactory] Starting Nest application...
[Nest] LOG [InstanceLoader] MongooseModule dependencies initialized
... all modules initialized ...
[Nest] ERROR [MongooseModule] Unable to connect to the database. Retrying (1)...
```

The entrypoint resolves and Nest bootstraps fully; it stops only at the Atlas
DNS lookup the sandbox blocks. That is exactly the assertion `dist/main` vs
`dist/src/main` decides.

## 3. The healthcheck, and what testing it revealed

Added a `HEALTHCHECK` that probes `/api-docs-json` — a real HTTP response,
which requires Nest to have finished bootstrapping, rather than a mere port
check.

Probing it locally surfaced something that changed the configuration:
**Mongoose blocks bootstrap, so the app binds no port at all until the database
connects.** With no local `mongod` the port stayed closed rather than serving
errors.

So on a cold `docker compose up` the API waits for Mongo's healthcheck (up to
~50s at `interval=10s x retries=5`) plus Nest's own connect retries (9 attempts,
3s apart by default). `--start-period` is therefore **60s**; the 20s I first
wrote would have marked a healthy container unhealthy on first boot.

## 4. Other changes

- **Node 20 → 22.** Development and CI run Node 22; shipping 20 means testing
  one runtime and deploying another.
- **Runs as the unprivileged `node` user** the base image already provides,
  with `chown` on `/app` so the app can still write `uploads/`. Root in a
  container is avoidable blast radius.
- **`NODE_ENV=production`** set in the image, not just compose.
- **`npm cache clean --force`** after the production install, so the layer does
  not carry the download cache.
- **`.dockerignore`** now also excludes `docs`, `webpush-test`, `*.md`,
  `.github` and `.vscode`. None are build inputs, and excluding them stops a
  docs edit from invalidating the cached `npm ci` layer. Confirmed no build step
  reads markdown.

## 5. A compose subtlety worth knowing

The checked-out `.env` points `MONGODB_URI` at the **Atlas** cluster, while
compose sets it to the local `mongo` service. Compose applies `environment:`
**after** `env_file:`, so the container uses local Mongo and **a local run never
touches Atlas data**. That precedence is the only reason this is safe, so it is
now commented in the file rather than left as folklore.

## 6. What is NOT verified

**The image has never been built.** No `docker build`, no `docker compose up`,
no running container. Specifically unverified:

- that `npm ci` succeeds inside `node:22-alpine` (native modules, if any, need
  build tools that Alpine lacks by default)
- that the healthcheck command passes against a live container
- that the `USER node` + `chown` combination actually permits writes to the
  mounted `uploads` volume — a mounted volume can arrive root-owned and
  override the image's ownership
- that Node 22 changes nothing at runtime

### How to test it

```bash
# 1. Build — the first real test of `npm ci` on alpine
docker build -t kickr-api .

# 2. Confirm the entrypoint exists in the image (catches §1 directly)
docker run --rm kickr-api ls -1 dist/src/main.js

# 3. Full stack
docker compose up --build

# 4. Watch for health, which takes up to 60s on a cold start
docker compose ps            # api should read "healthy", not "starting"
curl -s localhost:3000/api-docs-json | head -c 80

# 5. Prove the upload volume is writable as the node user (see above)
docker compose exec api touch uploads/profiles/.probe && echo "writable"
```

If step 5 fails with `Permission denied`, the volume mounted root-owned; the fix
is an init step that chowns the mount, not a change to the Dockerfile's build.
