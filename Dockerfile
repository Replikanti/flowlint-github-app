# Multi-stage Dockerfile for FlowLint production deployment
# Stage 1: Builder - compiles TypeScript to JavaScript
# Stage 2: Production - runs compiled code with minimal dependencies

# ============================================================================
# Stage 1: Builder
# ============================================================================
FROM node:24.13.0-alpine@sha256:931d7d57f8c1fd0e2179dbff7cc7da4c9dd100998bc2b32afc85142d8efbc213 AS builder

WORKDIR /app

# Upgrade npm to latest version
RUN npm install -g npm@latest

# Copy package files for dependency installation
COPY package*.json ./

# Install ALL dependencies (including devDependencies for TypeScript compilation)
RUN npm ci && npm cache clean --force

# Copy source code
COPY tsconfig.json ./
COPY apps ./apps
COPY packages ./packages

# Compile TypeScript to JavaScript
RUN npm run build

# ============================================================================
# Stage 2: Production
# ============================================================================
FROM node:24.13.0-alpine@sha256:931d7d57f8c1fd0e2179dbff7cc7da4c9dd100998bc2b32afc85142d8efbc213 AS production

# Upgrade npm to latest version
RUN npm install -g npm@latest

WORKDIR /app

# Set production environment
ENV NODE_ENV=production

# Copy package files
COPY package*.json ./

# Install ONLY production dependencies (no devDependencies)
# Note: --ignore-scripts prevents npm from running 'prepare' script (husky install)
# which requires devDependencies not available in production
RUN npm ci --only=production --ignore-scripts && npm cache clean --force

# Copy compiled JavaScript from builder stage
COPY --from=builder /app/dist ./dist

# Copy package.json for version info
COPY --from=builder /app/package.json ./package.json

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Change ownership of app directory
RUN chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose API port (can be overridden via PORT env var)
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/healthz', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Default command (can be overridden in docker-compose)
# Use --init flag for proper signal handling and zombie process reaping
CMD ["node", "dist/apps/api/src/server.js"]
