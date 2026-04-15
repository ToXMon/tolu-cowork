# Tolu Cowork Core — Multi-stage Docker Build
# Stage 1: Build TypeScript
# Stage 2: Production runtime

# ─── Build Stage ──────────────────────────────────────────────────────────────
FROM node:22-slim AS builder

WORKDIR /build

# Install dependencies first (cache layer)
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

# Copy source and build
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Prune dev dependencies
RUN npm prune --production

# ─── Runtime Stage ────────────────────────────────────────────────────────────
FROM node:22-slim AS runtime

# Create non-root user
RUN groupadd -r tolu && useradd -r -g tolu -m -d /home/tolu -s /sbin/nologin tolu

WORKDIR /app

# Copy built artifacts and production deps
COPY --from=builder /build/dist/ ./dist/
COPY --from=builder /build/node_modules/ ./node_modules/
COPY --from=builder /build/package.json ./

# Create data directory
RUN mkdir -p /home/tolu/.tolu && chown -R tolu:tolu /home/tolu/.tolu

# Set environment
ENV NODE_ENV=production
ENV TOLU_DATA_DIR=/home/tolu/.tolu

# Expose ports
EXPOSE 50051 8080

# Health check endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3   CMD node -e 