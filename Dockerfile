# syntax=docker/dockerfile:1

# ---------- Build stage ----------
FROM node:22-alpine AS builder

WORKDIR /app

# Copied before the source so a source-only change reuses the cached install.
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---------- Production stage ----------
FROM node:22-alpine AS production

ENV NODE_ENV=production

WORKDIR /app

COPY package*.json ./
# --omit=dev is safe here: everything needed at runtime (firebase-admin
# included) is a production dependency. `npm cache clean` keeps the layer from
# carrying the download cache, which is dead weight in the image.
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist

# Serving and multer both resolve uploads from process.cwd(), i.e. /app/uploads.
# Created here so the directories exist even when no volume is mounted; with the
# compose volume, it is the mount point.
RUN mkdir -p uploads/profiles uploads/groups \
  && chown -R node:node /app

# The base image ships an unprivileged `node` user. Running as root inside a
# container is an unnecessary blast radius, and the app never needs it.
USER node

EXPOSE 3000

# Reports unhealthy on anything but a 2xx/3xx from the docs route, which
# requires the Nest app to have finished bootstrapping — not merely the port to
# be open. Compose can then gate dependents on real readiness.
#
# start-period is 60s because Mongoose blocks bootstrap until it connects: the
# app binds NO port at all while the database is unreachable (verified locally —
# without a mongod the port stays closed rather than serving errors). On a cold
# start the API therefore waits for Mongo's own healthcheck (up to ~50s at
# interval=10s x retries=5) plus Nest's connect retries. A shorter period would
# mark a perfectly healthy container unhealthy on first boot.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/api-docs-json',r=>process.exit(r.statusCode<400?0:1)).on('error',()=>process.exit(1))"

# dist/src/main, NOT dist/main: tsconfig sets no `rootDir`, so TypeScript infers
# it from the common ancestor of all inputs. Because scripts/ is compiled
# alongside src/, that ancestor is the project root and the output nests as
# dist/src/ and dist/scripts/. `node dist/main` builds fine and then crashes at
# startup with MODULE_NOT_FOUND.
CMD ["node", "dist/src/main"]
