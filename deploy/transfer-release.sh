#!/bin/sh
set -u

apk add --no-cache openssh-client sshpass iproute2 tor torsocks >/dev/null
ip link set dev eth0 mtu 1000

mkdir -p /tmp/tor-data
tor \
  --SocksPort 9050 \
  --DataDirectory /tmp/tor-data \
  --Log 'notice file /tmp/tor.log' \
  >/dev/null 2>&1 &

tor_ready=''
for _ in $(seq 1 90); do
  if grep -q 'Bootstrapped 100%' /tmp/tor.log 2>/dev/null; then
    tor_ready=1
    break
  fi
  sleep 1
done

if [ -z "$tor_ready" ]; then
  cat /tmp/tor.log >&2 || true
  exit 1
fi

remote_command='mkdir -p /opt/barsikchat/releases/20260814-112002 && tar -xzf - -C /opt/barsikchat/releases/20260814-112002 && bash /opt/barsikchat/releases/20260814-112002/deploy/install-server.sh /opt/barsikchat/releases/20260814-112002'

if cat /payload/prod.tar.gz | torsocks sshpass -e ssh \
  -o UserKnownHostsFile=/tmp/known_hosts \
  -o StrictHostKeyChecking=accept-new \
  -o ServerAliveInterval=20 \
  -o ServerAliveCountMax=30 \
  -o ConnectTimeout=45 \
  root@185.233.187.252 "$remote_command"; then
  ssh-keygen -lf /tmp/known_hosts
else
  result=$?
  if [ -f /tmp/known_hosts ]; then
    ssh-keygen -lf /tmp/known_hosts || true
  fi
  exit "$result"
fi
