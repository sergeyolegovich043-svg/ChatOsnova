#!/usr/bin/env bash
set -Eeuo pipefail

release_dir=${1:?Release directory is required}
install_root=/opt/barsikchat
shared_dir="$install_root/shared"
env_file="$shared_dir/.env"

log() {
  printf '[BarsikChat] %s\n' "$1"
}

fail() {
  printf '[BarsikChat] ERROR: %s\n' "$1" >&2
  exit 1
}

existing_domain=''
if [[ -s "$env_file" ]]; then
  existing_domain=$(sed -n 's/^BARSIKCHAT_DOMAIN=//p' "$env_file" | tail -n 1)
fi
barsikchat_domain=${BARSIKCHAT_DOMAIN:-$existing_domain}
if [[ ! "$barsikchat_domain" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] || [[ "$barsikchat_domain" != *.* ]]; then
  fail 'Set BARSIKCHAT_DOMAIN to a DNS name that points to this server (for example chat.example.com).'
fi
app_origin="https://$barsikchat_domain"

if [[ ! -f "$release_dir/compose.prod.yml" || ! -f "$release_dir/Dockerfile" ]]; then
  printf 'Production release is incomplete: %s\n' "$release_dir" >&2
  exit 1
fi

mkdir -p "$shared_dir"

available_kb=$(df -Pk "$install_root" | awk 'NR == 2 { print $4 }')
if [[ -z "$available_kb" || "$available_kb" -lt 2097152 ]]; then
  printf 'At least 2 GiB of free disk space is required.\n' >&2
  exit 1
fi

if command -v ss >/dev/null 2>&1; then
  for public_port in 80 443; do
    if ss -H -ltn "sport = :$public_port" | grep -q .; then
      if ! command -v docker >/dev/null 2>&1 || ! docker ps --format '{{.Names}}' | grep -Eq '^barsikchat-gateway-[0-9]+$'; then
        printf 'TCP port %s is already used by another service; deployment stopped safely.\n' "$public_port" >&2
        ss -H -ltnp "sport = :$public_port" || true
        exit 1
      fi
    fi
  done
fi

if ! command -v docker >/dev/null 2>&1; then
  log 'Installing Docker from Ubuntu packages'
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y ca-certificates curl openssl docker.io
  apt-get install -y docker-compose-v2 \
    || apt-get install -y docker-compose-plugin \
    || apt-get install -y docker-compose
  systemctl enable --now docker
fi

if docker compose version >/dev/null 2>&1; then
  compose=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  compose=(docker-compose)
else
  printf 'Docker Compose is not available after installation.\n' >&2
  exit 1
fi

if [[ ! -s "$env_file" ]]; then
  log 'Generating production database and Web Push keys'
  db_password=$(openssl rand -hex 32)
  mapfile -t vapid_keys < <(
    docker run --rm node:22-alpine node -e '
      const { generateKeyPairSync } = require("node:crypto");
      const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
      const jwk = privateKey.export({ format: "jwk" });
      const publicKey = Buffer.concat([
        Buffer.from([4]),
        Buffer.from(jwk.x, "base64url"),
        Buffer.from(jwk.y, "base64url")
      ]).toString("base64url");
      process.stdout.write(`${publicKey}\n${jwk.d}\n`);
    '
  )
  if [[ ${#vapid_keys[@]} -ne 2 ]]; then
    printf 'Could not generate VAPID keys.\n' >&2
    exit 1
  fi

  umask 077
  printf '%s\n' \
    'PORT=3000' \
    "BARSIKCHAT_DOMAIN=$barsikchat_domain" \
    "POSTGRES_PASSWORD=$db_password" \
    "DATABASE_URL=postgres://chatosnova:$db_password@postgres:5432/chatosnova" \
    "APP_ORIGIN=$app_origin" \
    'SESSION_DAYS=30' \
    'MAX_USERS=100' \
    'MAX_UPLOAD_MB=50' \
    'DATA_DIR=/app/data' \
    "VAPID_PUBLIC_KEY=${vapid_keys[0]}" \
    "VAPID_PRIVATE_KEY=${vapid_keys[1]}" \
    "VAPID_SUBJECT=mailto:admin@$barsikchat_domain" \
    > "$env_file"
  chmod 600 "$env_file"
else
  log 'Keeping existing production secrets and database connection'
  if [[ "$existing_domain" != "$barsikchat_domain" ]] || ! grep -q '^APP_ORIGIN=https://' "$env_file"; then
    updated_env=$(mktemp "$shared_dir/.env.XXXXXX")
    awk -v domain="$barsikchat_domain" -v origin="$app_origin" '
      BEGIN { saw_domain = 0; saw_origin = 0 }
      /^BARSIKCHAT_DOMAIN=/ { if (!saw_domain) print "BARSIKCHAT_DOMAIN=" domain; saw_domain = 1; next }
      /^APP_ORIGIN=/ { if (!saw_origin) print "APP_ORIGIN=" origin; saw_origin = 1; next }
      { print }
      END {
        if (!saw_domain) print "BARSIKCHAT_DOMAIN=" domain
        if (!saw_origin) print "APP_ORIGIN=" origin
      }
    ' "$env_file" > "$updated_env"
    chmod 600 "$updated_env"
    mv -f "$updated_env" "$env_file"
    log "Updated the public origin to $app_origin"
  fi
fi

ln -sfn "$env_file" "$release_dir/.env"

previous_release=''
if [[ -L "$install_root/current" ]]; then
  previous_release=$(readlink -f "$install_root/current" || true)
fi

show_failure_context() {
  status=$?
  printf '[BarsikChat] Deployment failed with status %s. Recent container logs follow.\n' "$status" >&2
  "${compose[@]}" -f "$release_dir/compose.prod.yml" logs --no-color --tail=120 2>/dev/null || true
  if [[ -n "$previous_release" && -f "$previous_release/compose.prod.yml" ]]; then
    printf '[BarsikChat] Restoring previous release: %s\n' "$previous_release" >&2
    "${compose[@]}" -f "$previous_release/compose.prod.yml" up -d --remove-orphans 2>/dev/null || true
    ln -sfn "$previous_release" "$install_root/current"
  fi
  exit "$status"
}
trap show_failure_context ERR

log 'Validating and starting production containers'
"${compose[@]}" -f "$release_dir/compose.prod.yml" config --quiet
if [[ ${BARSIK_PREBUILT_IMAGE:-} == '1' ]]; then
  "${compose[@]}" -f "$release_dir/compose.prod.yml" up -d --no-build --remove-orphans
else
  "${compose[@]}" -f "$release_dir/compose.prod.yml" up -d --build --remove-orphans
fi

healthy=''
for _ in $(seq 1 60); do
  if health_json=$("${compose[@]}" -f "$release_dir/compose.prod.yml" exec -T app wget -qO- http://127.0.0.1:3000/api/health 2>/dev/null); then
    healthy=1
    break
  fi
  sleep 3
done

if [[ -z "$healthy" ]]; then
  printf 'BarsikChat did not become healthy within 180 seconds.\n' >&2
  false
fi

ln -sfn "$release_dir" "$install_root/current"

if command -v ufw >/dev/null 2>&1 && ufw status | grep -q '^Status: active'; then
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw allow 443/udp >/dev/null
fi

trap - ERR
log "Deployment complete: $release_dir"
printf '%s' "$health_json"
printf '\n'
"${compose[@]}" -f "$release_dir/compose.prod.yml" ps
