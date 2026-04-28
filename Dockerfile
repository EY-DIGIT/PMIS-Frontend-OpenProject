# ── Stage 1: Build ────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# All VITE_ variables come from .env.development via deploy.sh build args.
# Developer only needs to update .env.development — nothing else.
# Add more ARG lines here if .env.development gets new VITE_ variables.
ARG VITE_API_BASE_URL
ARG VITE_APP_NAME
ARG VITE_APP_ENV

# Make them available to Vite at build time
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_APP_NAME=$VITE_APP_NAME
ENV VITE_APP_ENV=$VITE_APP_ENV

RUN npm run build

# ── Stage 2: Serve ────────────────────────────────────────────────
FROM nginx:1.25-alpine

RUN rm -rf /usr/share/nginx/html/*
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
