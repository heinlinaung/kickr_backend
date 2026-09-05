# Change Log — 2026-09-05 · GitHub Actions deploy to the droplet

**Branch:** `events-feature-spec`
**Tests:** 946 passing across 46 suites · build clean
**Verified:** YAML parses, job graph checked. **First CI run: `Test` passed,
`Build & push` failed on the GHA cache driver — fixed in §3b, not yet
re-run.** See §6.

`.github/workflows/deploy.yml`: build a GHCR image on push to `main`, then
redeploy the droplet over SSH. First workflow in this repo.

---

## 1. Changes from the supplied YAML

The structure is unchanged. Five things were added or corrected.

### A `test` job gates the deploy

`npm ci && npm run build && npm test` runs before the image is built, and
`build-and-push` `needs: test`. The suite takes **under 7 seconds**, so a
commit that fails it can never reach the droplet for almost no pipeline cost.

### Deploys the commit SHA, not `:latest`

The supplied script pulled `:latest`. That is a moving target: a second build
finishing between this job's `pull` and its `run` would retag it, and the
droplet would silently start a *different* commit than the one that triggered
the workflow.

Using `${{ github.sha }}` also makes rollback trivial — re-run the deploy job
against an older commit.

`:latest` is still published by `metadata-action`, for anyone pulling by hand.

### A concurrency group

Two pushes in quick succession would otherwise race: two `docker run` calls
against one container name, with the winner decided by which SSH session
finished last rather than which commit is newer. `concurrency: deploy-droplet`
with `cancel-in-progress: false` queues them.

### Waits for the container to report healthy

The script now polls `docker inspect` until the healthcheck passes, dumping the
last 50 log lines and failing if it goes unhealthy or times out.

Without this the job goes green as soon as `docker run` returns — which it does
even for a container that crash-loops on bad configuration. Given the app binds
**no port at all** until Mongo connects, "started" and "serving" are genuinely
different states here.

Budgeted at 40 × 5s = 200s, against the image's 60s health start period.

### Secrets and the username are passed as env vars

`${{ }}` is substituted as raw text before the shell sees it, so a value with
shell metacharacters would execute rather than be read as data. `GHCR_TOKEN`,
`github.actor` and the image tag now go through `envs:` instead.

Nothing here is attacker-controlled — no `github.event.*` or `github.head_ref`
is referenced anywhere in the file, which is where injection normally enters —
but the safe form costs nothing and does not depend on that staying true.

## 2. The container name

Changed `myapp` → `kickr-api`, matching the README. The supplied script's own
comment said "adjust name as needed"; leaving it would have meant the running
container did not match any documentation.

## 3. No volume — and a correction

The supplied `docker run` mounts nothing, and **that is correct**.

I initially flagged it as a bug that would wipe uploads on every deploy. That
was wrong, and the owner caught it: **every upload route uses ImageKit**
(`multerMemoryImageOptions` → `imagekit.upload`, in groups, users and events).
`multerDiskOptions` has **no callers** — it is dead code — and nothing writes to
`uploads/`.

So the container is genuinely **stateless**: all persistent state is external
(MongoDB Atlas, ImageKit), and replacing it loses nothing. That is what makes
the simple stop/remove/run pattern safe rather than risky.

Three stale claims were corrected as a result:

- `README.md` said to mount `uploads` as a named volume "or they vanish with
  the container" — false, and now says the opposite with the reason.
- `README.md`'s tech-stack table said "File uploads | Multer (local disk)".
- The Dockerfile changelog listed the uploads volume's writability as a
  deployment risk to verify. It is not one.

The `uploads/` directory in the image and the `ServeStaticModule` serving it are
both vestigial — left alone, since removing them is unrelated to this change.

## 3b. First run failed on the build cache — fixed

The first CI run (PR #63 merge) got through **Test** and failed in
**Build & push image**:

```
ERROR: failed to build: Cache export is not supported for the docker driver.
Switch to a different image store, or turn on the containerd image store
```

My mistake: `cache-from/cache-to: type=gha` needs the **`docker-container`**
buildx driver, but `docker/build-push-action` uses the plain `docker` driver
unless buildx is set up first — and that driver cannot export a cache.

Fixed by adding `docker/setup-buildx-action@v3` before the login step, which is
the standard companion to GHA caching. Keeps the cache rather than dropping it:
without one, every build reinstalls `node_modules` from scratch.

The run also logged a **Node 20 deprecation** notice. That is about the
runner's default Node for JavaScript actions, not about any version pinned
here — every action in this file is on a current major (`checkout@v4`,
`setup-node@v4`, `setup-buildx-action@v3`, `login-action@v3`,
`metadata-action@v5`, `build-push-action@v6`). Informational.

Worth noting the failure order was useful: **Test passed first**, so the gate
in §1 did its job — the failure was in packaging, not in the code.

## 4. Required secrets

| Secret | Used by | Notes |
|---|---|---|
| `GITHUB_TOKEN` | build | Automatic; needs no setup. `packages: write` is already declared. |
| `GHCR_TOKEN` | deploy | **Separate** from the above — a PAT with `read:packages`, so the droplet can pull. The automatic token is not available on the droplet. |
| `DROPLET_HOST` | deploy | IP or hostname |
| `DROPLET_USERNAME` | deploy | SSH user |
| `DROPLET_SSH_KEY` | deploy | Private key, full PEM including header and footer |
| `DROPLET_PORT` | deploy | Optional; defaults to 22 |

## 5. What the droplet needs

`/home/deploy/.env` must exist and contain, at minimum:

```
MONGODB_URI, APP_BASE_URL,
AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY,
COGNITO_USER_POOL_ID, COGNITO_CLIENT_ID, COGNITO_CLIENT_SECRET,
IMAGEKIT_PUBLIC_KEY, IMAGEKIT_PRIVATE_KEY, IMAGEKIT_URL_ENDPOINT
```

`FIREBASE_*` is optional — without it push is disabled and everything else
works. `ADMIN_KEY` gates the admin routes.

**The ImageKit keys are not optional**, given §3: without them every upload
fails, and there is no local-disk fallback.

## 6. What is NOT verified

**The workflow has run once and failed at packaging** (see §3b). `Test` passed;
the image was never built, so nothing reached GHCR and no deploy happened.
Specifically unverified:

- that `docker build` now succeeds in Actions. The buildx fix addresses the
  reported error, but the build itself has still never completed anywhere —
  here or in CI — so `npm ci` on `node:22-alpine` remains unproven.
- that the droplet can pull from GHCR with `GHCR_TOKEN`
- that the SSH action authenticates
- that `-p 80:3000` binds — the container runs as the unprivileged `node` user,
  though Docker's port publishing is handled by the daemon as root, so this
  should be fine
- **that the app serves over plain HTTP only.** Nothing terminates TLS. Port 80
  is unencrypted, and Cognito access tokens would cross the wire in the clear.
  That needs a reverse proxy with a certificate before any real use.

What *was* verified: the YAML parses, the job graph is `test → build-and-push →
deploy`, `npm test` maps to the suite and passes in under 7 seconds, Node 22
matches the Dockerfile's base image, and `.github` is excluded from the Docker
build context so workflow edits do not bust the image cache.

### First run

Push to `main`, or trigger manually from the Actions tab (`workflow_dispatch`
is enabled). Watch for the deploy job's "Waiting for the container to report
healthy" — a failure there dumps the container logs, which is where a bad
`/home/deploy/.env` will show up.
