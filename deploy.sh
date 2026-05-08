#!/usr/bin/env bash
set -euo pipefail

IMAGE_NAME="pmis-frontend"
VERSION_FILE=".image_version"
ENV_FILE=".env"
HOST_PORT=""

echo "---------------------------------------"
echo " PMIS FRONTEND DOCKER DEPLOYMENT"
echo "---------------------------------------"

# ── Pre-flight: only check things that must exist before git pull ──
if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker not installed"; exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "ERROR: docker compose not installed"; exit 1
fi
if [ ! -f "package.json" ]; then
  echo "ERROR: package.json not found — are you in the project root?"; exit 1
fi

# ── Git pull FIRST — so all files are up to date ──────────────────
echo ""
echo "Pulling latest code from GitHub..."

if ! git -C . rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "ERROR: Not a git repository."; exit 1
fi

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo "Branch : $CURRENT_BRANCH"

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Local changes detected — stashing before pull..."
  git stash push -m "deploy.sh auto-stash $(date '+%Y-%m-%d %H:%M:%S')"
  GIT_STASHED=true
else
  GIT_STASHED=false
fi

git pull origin "$CURRENT_BRANCH"

if [[ "$GIT_STASHED" == "true" ]]; then
  git stash pop || echo "WARN: stash pop had conflicts — check: git status"
fi

COMMIT=$(git rev-parse --short HEAD)
echo "Commit : $COMMIT"
echo "Code   : up to date"

# ── Post-pull file checks ──────────────────────────────────────────
if [ ! -f "Dockerfile" ]; then
  echo "ERROR: Dockerfile not found after pull"; exit 1
fi
if [ ! -f "docker-compose.yml" ]; then
  echo "ERROR: docker-compose.yml not found after pull"; exit 1
fi
if [ ! -f "nginx.conf" ]; then
  echo "ERROR: nginx.conf not found after pull"; exit 1
fi

# ── Read values from .env.development ─────────────────────────────
# Developer sets all URLs here — deploy.sh picks them up automatically.
# No hardcoding needed in this script or Dockerfile.
if [ ! -f ".env.development" ]; then
  echo "ERROR: .env.development not found — developer must create this file"
  exit 1
fi

echo ""
echo "Reading config from .env.development..."

# Safe parser — handles comments, spaces, blank lines
while IFS='=' read -r key value; do
  [[ -z "$key" || "$key" =~ ^# ]] && continue
  value="${value%%#*}"                          # strip inline comments
  value="${value#"${value%%[![:space:]]*}"}"    # trim leading space
  value="${value%"${value##*[![:space:]]}"}"    # trim trailing space
  [[ -n "$key" ]] && export "$key=$value"
done < ".env.development"

# VITE_API_BASE_URL must be set in .env.development
if [ -z "${VITE_API_BASE_URL:-}" ]; then
  echo "ERROR: VITE_API_BASE_URL is not set in .env.development"
  echo "       Add this line:  VITE_API_BASE_URL=http://your-server-ip:8000"
  exit 1
fi

echo "VITE_API_BASE_URL = $VITE_API_BASE_URL"

# ── Docker Hub login ───────────────────────────────────────────────
echo ""
read -rp  "Docker Hub Username: " DOCKER_USERNAME
read -rsp "Docker Hub Password / Access Token: " DOCKER_PASSWORD
echo ""
echo ""
echo "Logging in to Docker Hub..."
echo "$DOCKER_PASSWORD" | docker login -u "$DOCKER_USERNAME" --password-stdin

# ── Version increment ──────────────────────────────────────────────
if [ -f "$VERSION_FILE" ]; then
  CURRENT_VERSION=$(cat "$VERSION_FILE")
  if ! [[ "$CURRENT_VERSION" =~ ^[0-9]+$ ]]; then
    CURRENT_VERSION=0
  fi
else
  CURRENT_VERSION=0
fi

NEW_VERSION=$(( CURRENT_VERSION + 1 ))
TAG="v${NEW_VERSION}"
FULL_IMAGE="${DOCKER_USERNAME}/${IMAGE_NAME}:${TAG}"
LATEST_IMAGE="${DOCKER_USERNAME}/${IMAGE_NAME}:latest"

echo ""
echo "---------------------------------------"
echo " Building image : $FULL_IMAGE"
echo " Git commit     : $COMMIT"
echo " API URL        : $VITE_API_BASE_URL"
echo "---------------------------------------"

# Pass ALL VITE_ variables from .env.development as build args
# So developer just updates .env.development — nothing else to touch
BUILD_ARGS=""
while IFS='=' read -r key value; do
  [[ -z "$key" || "$key" =~ ^# ]] && continue
  value="${value%%#*}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  # Only pass VITE_ prefixed variables — those are frontend env vars
  if [[ "$key" == VITE_* && -n "$value" ]]; then
    BUILD_ARGS="$BUILD_ARGS --build-arg $key=$value"
  fi
done < ".env.development"

docker build $BUILD_ARGS -t "$FULL_IMAGE" .
docker tag "$FULL_IMAGE" "$LATEST_IMAGE"

echo ""
echo "Pushing to Docker Hub..."
docker push "$FULL_IMAGE"
docker push "$LATEST_IMAGE"

# Version saved ONLY after successful push
echo "$NEW_VERSION" > "$VERSION_FILE"

cat > "$ENV_FILE" << EOF
DOCKER_USERNAME=$DOCKER_USERNAME
VERSION=$TAG
EOF

# ── Redeploy ───────────────────────────────────────────────────────
echo ""
echo "Stopping old container..."
docker compose down 2>/dev/null || true

echo ""
echo "Starting new container..."
docker compose up -d

echo ""
echo "---------------------------------------"
echo " DEPLOYMENT SUCCESS"
echo "---------------------------------------"
echo " Image   : $FULL_IMAGE"
echo " Commit  : $COMMIT"
echo " Branch  : $CURRENT_BRANCH"
echo ""
echo " ENV values baked from .env.development:"
while IFS='=' read -r key value; do
  [[ -z "$key" || "$key" =~ ^# ]] && continue
  [[ "$key" == VITE_* ]] && echo "   $key = $value"
done < ".env.development"
echo ""
echo " App running at:"
echo " http://$(hostname -I | awk '{print $1}'):${HOST_PORT}"
echo "---------------------------------------"
echo ""

