# Hetzner AX box setup

One dedicated AX server runs everything at launch: Postgres, Redis, API and web in Docker Compose, the Go host agent under systemd, and many CS2 processes sharing one game install.

## 1. Order the box

1. Hetzner Robot, Dedicated, AX line. An AX52 or AX102 is a good start. CS2 servers are mostly single thread bound, so favour high clock AMD Ryzen parts. Plan on roughly one core and 1.5 to 2 GB RAM per 3v3 or 2v2 server, less for 1v1.
2. Location: Falkenstein (FSN1) or Nuremberg (NBG1) for EU players.
3. Disks: 2x NVMe in software RAID 1. The CS2 install is about 60 GB and grows with updates. Demos go to object storage so local disk stays small.
4. Add an extra IPv4 only if you want the web and game traffic split. One IPv4 is enough to start.
5. Add your SSH public key during the order so the rescue system and installimage use it.
6. Order a Hetzner Object Storage bucket in the same location for demos and off box DB backups.

## 2. Install Ubuntu 24.04

1. Boot into the rescue system from Robot, then run `installimage`.
2. Pick Ubuntu 24.04 LTS minimal. Keep software RAID 1 on. Suggested layout:
   ```
   PART swap swap 8G
   PART /boot ext3 1G
   PART / ext4 all
   ```
3. Set the hostname, for example `ax1.rushsite`. Reboot.
4. First login:
   ```bash
   apt update && apt -y full-upgrade
   apt -y install ufw fail2ban unattended-upgrades curl jq htop lib32gcc-s1 lib32stdc++6 ca-certificates
   adduser --disabled-password --gecos "" deploy && usermod -aG sudo deploy
   # copy authorized_keys to deploy, then in /etc/ssh/sshd_config set:
   #   PermitRootLogin prohibit-password
   #   PasswordAuthentication no
   systemctl restart ssh
   timedatectl set-timezone UTC
   ```
5. Enable unattended security upgrades but keep kernel reboots manual so matches are not cut.

## 3. Firewall

Two layers. The Hetzner Robot firewall filters before traffic reaches the box and the host firewall (ufw) is the second line.

| Port | Proto | Source | Purpose |
|---|---|---|---|
| 22 | TCP | admin IPs, or any while bootstrapping | SSH |
| 80 | TCP | any | Caddy HTTP and ACME challenge |
| 443 | TCP and UDP | any | Caddy HTTPS and HTTP/3 |
| 27015-27030 | UDP | any | CS2 game traffic, one port per slot |
| 27015-27030 | TCP | any | Optional. Only needed for RCON from outside, leave closed |
| 8080 | TCP | the API only | Host agent. Never open to the internet |

### Robot firewall

Robot, Server, Firewall. The Robot firewall is stateless, so return traffic must be allowed by hand.

1. `tcp` dst port 22, action accept.
2. `tcp` dst port 80, accept.
3. `tcp` dst port 443, accept. `udp` dst port 443, accept.
4. `udp` dst port 27015-27030, accept.
5. `tcp` dst port 32768-65535, TCP flag `ack`, accept. Replies to outgoing connections such as SteamCMD, apt and Docker pulls.
6. `udp` dst port 32768-65535, accept. DNS replies and Steam master server traffic.
7. ICMP accept.
8. Everything else is dropped by the default rule.

Port 8080 is not listed so it cannot be reached from outside.

### ufw on the host

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw allow 27015:27030/udp
# The API container reaches the agent through the compose bridge rushsite0 (172.30.0.0/24).
ufw allow in on rushsite0 to any port 8080 proto tcp
ufw enable
```

Docker publishes container ports through its own iptables chains and bypasses ufw. That is why `docker-compose.yml` binds Postgres, Redis, API and web to `127.0.0.1` only, and the prod override removes the Postgres and Redis ports entirely. Only Caddy publishes 80 and 443 on all interfaces.

When a second machine or CCX cloud server arrives its agent must be reached over a private network (Hetzner vSwitch or Cloud Network), and 8080 is opened to the API box's private IP only.

## 4. sysctl tuning for game servers

```bash
cp infra/sysctl/99-rushsite-gameserver.conf /etc/sysctl.d/
modprobe nf_conntrack tcp_bbr
echo -e "nf_conntrack\ntcp_bbr" > /etc/modules-load.d/rushsite.conf
sysctl --system
```

It raises UDP socket buffers and backlog, sets `fq` and BBR, widens conntrack, and sets swappiness to 1.

Also:

```bash
# Run CPUs at full clock. Game ticks care about latency more than power.
apt -y install linux-tools-common linux-tools-$(uname -r)
cpupower frequency-set -g performance
# Make it stick across reboots.
cat >/etc/systemd/system/cpupower-performance.service <<'UNIT'
[Unit]
Description=Set CPU governor to performance
[Service]
Type=oneshot
ExecStart=/usr/bin/cpupower frequency-set -g performance
[Install]
WantedBy=multi-user.target
UNIT
systemctl enable --now cpupower-performance
```

Raise open file limits for the cs2 user in `/etc/security/limits.d/cs2.conf`:

```
cs2 soft nofile 1048576
cs2 hard nofile 1048576
```

## 5. Bootstrap order

Do these in order. Each step depends on the one before it.

### 5.1 Docker and the web stack

```bash
curl -fsSL https://get.docker.com | sh
usermod -aG docker deploy
mkdir -p /srv/rushsite && chown deploy: /srv/rushsite
# as deploy
git clone <repo> /srv/rushsite && cd /srv/rushsite
cp .env.example .env   # fill in real secrets, NODE_ENV=production, domains, COOKIE_DOMAIN, S3 and GSLTs
chmod 600 .env
docker compose -f docker-compose.yml -f docker-compose.prod.yml build
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

Point DNS A records for `SITE_DOMAIN` and `API_DOMAIN` at the box before starting Caddy so it can get certificates.

Install the DB backup cron:

```bash
crontab -e   # as deploy
15 4 * * * /srv/rushsite/infra/scripts/db-backup.sh >> /home/deploy/rushsite-backup.log 2>&1
```

### 5.2 Host agent under systemd

The repo lives in `/srv/rushsite`. The agent binary lives at `/opt/rushsite/bin/rushsite-agent`.

```bash
useradd --system --create-home --home-dir /srv/cs2home --shell /usr/sbin/nologin cs2
mkdir -p /opt/rushsite /etc/rushsite /srv/cs2
chown cs2: /srv/cs2
# build on a dev machine with: cd agent && GOOS=linux GOARCH=amd64 go build -o rushsite-agent .
install -m 755 rushsite-agent /opt/rushsite/bin/rushsite-agent
install -m 600 infra/systemd/agent.env.example /etc/rushsite/agent.env   # then edit
cp infra/systemd/rushsite-agent.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now rushsite-agent
```

The agent listens on 0.0.0.0:8080 and relies on the firewall above to keep it private. `AGENT_URLS=http://host.docker.internal:8080` in `.env` lets the API container reach it. The agent token in `/etc/rushsite/agent.env` must match `RUSHSITE_AGENT_TOKEN` in `.env`.

### 5.3 SteamCMD

```bash
dpkg --add-architecture i386
apt update
apt -y install steamcmd   # accept the Steam licence prompt
ln -s /usr/games/steamcmd /usr/local/bin/steamcmd
```

The agent runs SteamCMD itself for updates, so the `cs2` user needs to run it without a prompt.

### 5.4 CS2 dedicated server

```bash
sudo -u cs2 steamcmd +force_install_dir /srv/cs2 +login anonymous +app_update 730 validate +quit
```

Then install Metamod:Source and CounterStrikeSharp into `/srv/cs2/game/csgo/addons` and drop the rushsite plugin build into `addons/counterstrikesharp/plugins/`. The plugin folder has its own install notes.

Rush check for week one: start one server by hand with the Rush game mode and confirm it loads before wiring the allocator.

### 5.5 Verify

```bash
cd /srv/rushsite
API_URL=https://$API_DOMAIN WEB_URL=https://$SITE_DOMAIN AGENT_URLS=http://localhost:8080 make smoke
```

## Updates

- Web stack: deploys itself. `rushsite-autodeploy.timer` checks origin every minute for the branch checked out in `/srv/rushsite`, builds, and swaps the containers. A failed build or an unhealthy container leaves the previous version running and skips that commit until a newer push. Watch it with `journalctl -u rushsite-autodeploy -f`. Install once as root:

  ```bash
  cp /srv/rushsite/infra/systemd/rushsite-autodeploy.{service,timer} /etc/systemd/system/
  systemctl daemon-reload && systemctl enable --now rushsite-autodeploy.timer
  ```

  By hand: `git pull && docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build`.
- CS2: the agent handles it. It stops new allocations, waits for running matches to end, runs SteamCMD, then reopens.
- Agent: replace the binary and `systemctl restart rushsite-agent`. `KillMode=process` leaves running CS2 servers alone.
