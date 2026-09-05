# Change Log — 2026-09-05 · GitHub Actions deploy to the droplet

**Branch:** `events-feature-spec`
**Tests:** 946 passing across 46 suites · build clean
**Verified:** ✅ **The full pipeline is green.** Test → build → push to GHCR →
pull on the droplet → container running → API responding. Took six runs; §3b–3f
record each failure and why.

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

## 3c. Second run: build succeeded, SSH handshake failed

Run #2 (PR #64 merge) got **Test ✅ and Build & push image ✅** — so the buildx
fix in §3b worked and the image reached GHCR. `Deploy` failed:

```
ssh: handshake failed: ssh: unable to authenticate,
attempted methods [none publickey], no supported methods remain
```

This is **not a workflow problem** — it fails before any line of the deploy
script runs. `[none publickey]` means the droplet rejected the key offered by
the action. In likelihood order:

1. **`DROPLET_SSH_KEY` holds the wrong thing.** It must be the *entire private*
   key including the `-----BEGIN/END OPENSSH PRIVATE KEY-----` lines. Pasting
   the `.pub` file, or a copy that lost its footer, produces exactly this error.
2. The matching **public** key is not in that user's `~/.ssh/authorized_keys`
   on the droplet.
3. **`DROPLET_USERNAME` names a different account** than the one holding the
   key (e.g. the key is under `/root` but the secret says `deploy`).

Fastest way to tell 1 from 2/3: `ssh -i <key> user@host "echo OK"` from a local
machine. If that fails the droplet setup is wrong; if it works, the secret's
contents are.

### A secret is also missing

The repo has `DROPLET_HOST`, `DROPLET_PORT`, `DROPLET_SSH_KEY` and
`DROPLET_USERNAME` — but **not `GHCR_TOKEN`**, which the deploy script needs to
pull the image on the droplet.

That is a *later* failure than the handshake, so it has not surfaced yet. Under
`set -euo pipefail` an unset secret arrives as an **empty string rather than an
error**, so `docker login` would have failed with a registry authentication
message that points nowhere near the real cause. The script now checks for it
explicitly and says what to add.

## 3d. The droplet runs podman, not Docker

Verifying the deploy user surfaced this:

```
$ ssh deploy@... "docker ps"
Emulate Docker CLI using podman. Create /etc/containers/nodocker to quiet msg.
```

`docker` is an alias for **podman**. Mostly compatible — `pull`, `run`, `stop`,
`rm`, `logs` and `image prune` all behave — but **podman does not populate
`.State.Health` the way Docker does**: it generally ignores an image's
`HEALTHCHECK` unless one is supplied at run time.

So the health wait added in §1 would have polled `docker inspect -f
'{{.State.Health.Status}}'`, never seen `healthy`, and failed the job after
200 seconds on a container that was serving correctly — a false negative that
looks exactly like a broken deploy.

Replaced with a direct **`curl` against the published port**. That tests the
thing that actually matters — the API answers — and works identically under
both runtimes. `/api-docs-json` only responds once Nest has bootstrapped, which
for this app means Mongo connected, since it binds no port until then. The loop
also bails early if the container has exited, rather than waiting out the full
timeout for something that is not running.

The image's `HEALTHCHECK` is left in place: it is still correct under Docker,
and harmless under podman.

### The SSH failure, finally

Runs #2 and #3 both failed the handshake. The cause was simple and I was slow
to isolate it: **the key was installed for `root` but never for `deploy`**.
`id deploy` proved the *user* existed, which is not the same thing, and the
successful local test used `root@`. Testing `deploy@` specifically is what
found it — one command that should have come before a CI run, not after two.

## 3e. Tag mismatch: short SHA built, long SHA pulled

With SSH and GHCR login both working, run #4 reached the pull and failed:

```
Trying to pull ghcr.io/heinlinaung/kickr_backend:9f1d24ce1f0dae28e9ea5a7379815f2f172387e4...
Error: reading manifest 9f1d24ce... manifest unknown
```

My bug, and a self-inflicted one: the build tagged with `type=sha,prefix=`,
whose default is a **7-character short** SHA, while §1's "deploy the exact
commit" change pulls the **full 40-character** `${{ github.sha }}`. Those never
match.

Visible in run #1's own log — `ghcr.io/heinlinaung/kickr_backend:a8da21f` —
which I had read past. Nothing catches it earlier because the tag is only
resolved at deploy time, so the build happily publishes a tag nobody pulls.

Fixed with `format=long` on the tag directive rather than shortening the pull:
the point of §1 was an unambiguous, rollback-able reference, and the full SHA
keeps that.

**A trap worth recording:** the fix was first written with an explanatory
comment *inside* the `tags: |` block. YAML block scalars have no comments —
those lines are literal content, so `metadata-action` would have received four
`#`-prefixed strings as tag inputs. Confirmed by parsing the file and printing
what the action would actually receive, then moved the comment above the block.

## 3f. Rootless podman cannot bind port 80

Run #5 pulled the image successfully — the §3e tag fix worked, every blob
copied — then failed at `docker run`:

```
Error: rootlessport cannot expose privileged port 80 ...
(currently 1024), or choose a larger port number (>= 1024)
```

The `deploy` user runs **rootless** podman, which cannot bind below 1024. Root
Docker could; a non-root user with podman cannot. This is a direct consequence
of choosing `deploy` over `root` — a tradeoff recommended as better practice
without knowing podman was in play.

nginx was already installed and configured on the droplet, so the container now
publishes **3000** and nginx proxies to it. That also retires the TLS concern
raised in §6: nginx terminates it.

Bound to **`127.0.0.1:3000`**, not `0.0.0.0:3000`. nginx reaches it over
loopback, so exposing the app port publicly would only let someone bypass nginx
— and its TLS — by hitting the port directly.

### A reboot caveat, recorded not fixed

`--restart unless-stopped` restarts a crashed container, but under rootless
podman it does **not** survive a droplet reboot: there is no root daemon to
restore it. That needs `loginctl enable-linger deploy` plus a
`podman generate systemd` unit. Out of scope here, and noted in the workflow so
a reboot is not a mystery outage.

## 3g. Green — and one thing the log proves

Run #6 succeeded end to end:

```
Waiting for the API to respond...
curl: (56) Recv failure: Connection reset by peer
API responding after 2 checks.
✅ Successfully executed commands to all hosts.
```

That first failed curl is the loop doing its job: the container was up but
still bootstrapping — Mongoose connecting to Atlas — so nothing was listening
yet. The retry caught it five seconds later.

It also proves the **entrypoint fix from the 2026-09-03 Dockerfile changelog**.
`CMD ["node", "dist/src/main"]` had never executed in a container anywhere; the
original `dist/main` would have crash-looped, and the loop's container-exited
check would have failed the job with logs attached. Instead it served.

### Rootless podman keeps per-user stores

`docker ps` as **root** shows nothing, and `docker images` lists only a stale
`localhost/kickr_backend` from a manual build. That is expected, not a broken
deployment: **rootless podman gives each user their own container and image
store**, so root cannot see what `deploy` is running. Check as `deploy`.

A practical consequence: the `docker image prune -f` at the end of the deploy
runs as `deploy` and will **never** clean root's store. Those leftovers (~1 GB
of a 23 GB disk here) need clearing by hand once.

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

- ~~that `docker build` succeeds in Actions~~ — **confirmed in run #2.** The
  image builds on `node:22-alpine` and pushes to GHCR, so `npm ci` on Alpine
  works and the Dockerfile is sound as far as packaging goes.
- ~~that the droplet can pull from GHCR with `GHCR_TOKEN`~~ — **`Login
  Succeeded!` in run #4**, so SSH as `deploy`, the secret, and registry auth all
  work. The pull itself then failed on the tag mismatch in §3e.
- ~~that the entrypoint runs~~ — **confirmed in run #6.** The container starts
  and serves, so `dist/src/main` is correct and the original `dist/main` would
  indeed have crash-looped.
- that the SSH action authenticates
- ~~that `-p 80:3000` binds~~ — **it does not**, under rootless podman. Now
  published on `127.0.0.1:3000` behind nginx (§3f).
- ~~that nothing terminates TLS~~ — nginx is installed and configured on the
  droplet, so it holds 80/443 and proxies to the container.

What *was* verified: the YAML parses, the job graph is `test → build-and-push →
deploy`, `npm test` maps to the suite and passes in under 7 seconds, Node 22
matches the Dockerfile's base image, and `.github` is excluded from the Docker
build context so workflow edits do not bust the image cache.

### First run

Push to `main`, or trigger manually from the Actions tab (`workflow_dispatch`
is enabled). Watch for the deploy job's "Waiting for the container to report
healthy" — a failure there dumps the container logs, which is where a bad
`/home/deploy/.env` will show up.
