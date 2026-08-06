# syntax=docker/dockerfile:1

# Build context is `server/`, so every path below is relative to that. The
# Next.js app sits outside the context on purpose and never enters the image —
# this container is only the Socket.io process.

FROM node:24-alpine AS build
WORKDIR /app

# Manifests before sources: this layer is only invalidated when dependencies
# actually change, so editing src/ does not reinstall node_modules.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:24-alpine AS runtime
WORKDIR /app

# Set here rather than in the platform's secret group. That group is scoped to
# build *and* runtime, and NODE_ENV=production during a build makes npm skip
# devDependencies — which is where typescript lives, so `npm run build` above
# would fail on a missing `tsc`.
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Only the compiled output crosses over; the toolchain stays in the build stage.
COPY --from=build /app/dist ./dist

# server/src/env.ts reads PORT, then SOCKET_PORT, then falls back to 4000.
# Leave PORT unset on the host and this is the port to expose.
EXPOSE 4000

# The node images ship an unprivileged `node` user. Running as root in a
# container that terminates public traffic buys nothing.
USER node

CMD ["node", "dist/index.js"]
