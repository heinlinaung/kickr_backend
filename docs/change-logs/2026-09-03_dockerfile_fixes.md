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

MongoDB is **external** (Atlas), and Mongoose's default
`serverSelectionTimeoutMS` is 30s — so one slow DNS/TLS round trip plus a single
Nest retry already exceeds 30s. `--start-period` is therefore **60s**; the 20s I
first wrote would have marked a healthy container unhealthy on boot.

Because the deployment is a plain `docker run` on a droplet, **nothing else is
probing the container** — this healthcheck is the only readiness signal, and
`--restart unless-stopped` plus a healthy status is what tells you the app is
actually serving rather than merely running.

## 4. Other changes

- **Node 20 → 22.** Development and CI run Node 22; shipping 20 means testing
  one runtime and deploying another.
- **Runs as the unprivileged `node` user** the base image already provides,
  with `chown` on `/app` so the app can still write `uploads/`. Root in a
  container is avoidable blast radius.
- **`NODE_ENV=production`** set in the image, so it holds however the
  container is started.
- **`npm cache clean --force`** after the production install, so the layer does
  not carry the download cache.
- **`.dockerignore`** now also excludes `docs`, `webpush-test`, `*.md`,
  `.github` and `.vscode`. None are build inputs, and excluding them stops a
  docs edit from invalidating the cached `npm ci` layer. Confirmed no build step
  reads markdown.

## 5. No compose — and what that changes

`docker-compose.yml` is **deleted**. The deployment target is a DigitalOcean
droplet running the image directly, and MongoDB is external (Atlas), so there
was no second service for compose to orchestrate.

Two consequences worth stating, because the compose file used to hide both:

- **`.env` must be passed explicitly** (`--env-file .env`). It is excluded from
  the image on purpose, so a container started without it has no `MONGODB_URI`,
  no Cognito config and no Firebase credentials — and, since Mongoose blocks
  bootstrap, will simply never open its port.
- **`uploads` needs a named volume.** Compose declared one; a bare
  `docker run` does not, and without `-v kickr_uploads:/app/uploads` every
  uploaded image disappears with the container.

⚠️ **A local `docker run --env-file .env` now talks to the real Atlas cluster.**
Compose used to override `MONGODB_URI` to a local Mongo; nothing does that any
more. Point `MONGODB_URI` at a scratch database before testing against a
container, or local experiments will write to production data.

## 6. What is NOT verified

**The image has never been built.** No `docker build`, no `docker run`, no
running container. Specifically unverified:

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

# 2. Confirm the entrypoint exists in the image (catches §1 directly,
#    without needing a database or any configuration)
docker run --rm kickr-api ls -1 dist/src/main.js

# 3. Run it. Use a SCRATCH MONGODB_URI, not the production one.
docker run -d --name kickr-api \
  -p 3000:3000 --env-file .env \
  -v kickr_uploads:/app/uploads \
  kickr-api

# 4. Health takes up to 60s on a cold start
docker ps                    # STATUS should reach "healthy", not "starting"
docker logs -f kickr-api
curl -s localhost:3000/api-docs-json | head -c 80

# 5. Prove the upload volume is writable as the node user (see above)
docker exec kickr-api touch uploads/profiles/.probe && echo "writable"
```

If step 5 fails with `Permission denied`, the named volume mounted root-owned
and `USER node` cannot write it. The fix is to chown the mount on first run —
`docker run --user root ... chown -R node:node /app/uploads` once, or an
entrypoint script — not a change to the build.

Step 2 is worth running on its own: it proves the fix in §1 with no database,
no credentials and no network.
