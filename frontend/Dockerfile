# ==============================================================================
# Stage 1: Build stage
# ==============================================================================
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package descriptors
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code and configurations
COPY tsconfig*.json ./
COPY vite.config.ts ./
COPY index.html ./
COPY public/ ./public/
COPY src/ ./src/

# Build production SPA
RUN npm run build

# ==============================================================================
# Stage 2: Production Nginx Web Server
# ==============================================================================
FROM nginx:alpine AS runner

# Remove default nginx html
RUN rm -rf /usr/share/nginx/html/*

# Copy built SPA assets
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy custom Nginx configuration with API & WebSocket proxy
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

# Healthcheck to ensure Nginx serves the frontend
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
