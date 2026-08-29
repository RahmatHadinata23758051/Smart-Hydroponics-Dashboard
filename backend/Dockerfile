# ==============================================================================
# Stage 1: Build stage
# ==============================================================================
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies for native addons (better-sqlite3)
RUN apk add --no-cache python3 make g++

# Copy package descriptors
COPY package*.json ./

# Install all dependencies (including devDependencies for building TypeScript)
RUN npm ci

# Copy source code and config
COPY tsconfig.json ./
COPY src/ ./src/

# Compile TypeScript to JavaScript in /app/dist
RUN npm run build

# Remove devDependencies to keep image lean
RUN npm prune --production

# ==============================================================================
# Stage 2: Production Runtime
# ==============================================================================
FROM node:20-alpine AS runner

WORKDIR /app

# Install minimal runtime requirements for better-sqlite3
RUN apk add --no-cache libstdc++

ENV NODE_ENV=production
ENV PORT=5000

# Copy node_modules and built dist from builder stage
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/dist ./dist

# Create persistent data directory for SQLite
RUN mkdir -p /app/data && chown -R node:node /app

USER node

EXPOSE 5000

# Healthcheck to ensure API is responsive
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:5000/api/v1/health || exit 1

CMD ["node", "dist/server.js"]
