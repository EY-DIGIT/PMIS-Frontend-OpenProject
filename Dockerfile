# ── Stage 1: Build ────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies first (cached layer — only re-runs if package.json changes)
COPY package.json package-lock.json ./
RUN npm ci

# Copy source
COPY . .

# VITE_API_BASE_URL must be baked into the JS bundle at build time.
# Vite replaces import.meta.env.VITE_* at compile time, not runtime.
# We accept it as a build arg so deploy.sh can pass the server IP in.
ARG VITE_API_BASE_URL=http://10.1.131.199:8000
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

RUN npm run build
# Output: /app/dist — fully bundled, minified static files

# ── Stage 2: Serve ────────────────────────────────────────────────
FROM nginx:1.25-alpine

# Remove default nginx page
RUN rm -rf /usr/share/nginx/html/*

# Copy built assets from stage 1
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy our nginx config
COPY nginx.conf /etc/nginx/nginx.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
