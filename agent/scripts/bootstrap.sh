#!/usr/bin/env bash
# Bootstrap a fresh Ubuntu 24.04 Hetzner box as a rushsite CS2 host.
#
# Installs SteamCMD, CS2, Metamod:Source, a pinned CounterStrikeSharp build,
# the rushsite agent binary and its systemd unit.
# Paths match infra/hetzner/README.md and infra/systemd/.
#
# Run as root:
#   AGENT_BINARY=./rushsite-agent CSS_ZIP=/root/css-pr1432-linux.zip ./bootstrap.sh
#
# Settings, all overridable from the environment:
#   AGENT_BINARY     built agent binary to install. Build with: cd agent && GOOS=linux GOARCH=amd64 go build -o rushsite-agent .
#   CSS_ZIP          required. URL or local path of a CounterStrikeSharp "with-runtime" linux zip
#                    built from a pinned commit or PR. The latest release is too old for the
#                    current CS2 build. See the notes by install_css below.
#   CSS_SHA256       optional sha256 of CSS_ZIP. Checked when set.
#   METAMOD_URL      optional. Metamod:Source 2.0 linux tarball. Default is the latest 2.0 dev build.
#   PUBLIC_IP        optional. Detected from the default route when unset.
#   SKIP_CS2_INSTALL set to 1 to skip the 60 GB CS2 download, for example on a re-run.

set -euo pipefail

CS2_USER="${CS2_USER:-cs2}"
CS2_HOME="${CS2_HOME:-/srv/cs2home}"
CS2_DIR="${CS2_DIR:-/srv/cs2}"
AGENT_BINARY="${AGENT_BINARY:-./rushsite-agent}"
AGENT_BIN_DIR=/opt/rushsite/bin
ENV_DIR=/etc/rushsite
ENV_FILE="$ENV_DIR/agent.env"
DATA_DIR=/var/lib/rushsite-agent
UNIT_FILE=/etc/systemd/system/rushsite-agent.service
PORT_RANGE="${PORT_RANGE:-27015-27030}"
STEAMCMD=/usr/games/steamcmd
CSS_ZIP="${CSS_ZIP:-}"
CSS_SHA256="${CSS_SHA256:-}"
METAMOD_URL="${METAMOD_URL:-}"
SKIP_CS2_INSTALL="${SKIP_CS2_INSTALL:-0}"

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run as root"
[ -f "$AGENT_BINARY" ] || die "agent binary not found at $AGENT_BINARY. Set AGENT_BINARY."
[ -n "$CSS_ZIP" ] || die "CSS_ZIP is required. Point it at a CounterStrikeSharp build from a pinned commit or PR, not the latest release."

as_cs2() { sudo -u "$CS2_USER" -H "$@"; }

install_packages() {
	log "Installing packages"
	export DEBIAN_FRONTEND=noninteractive
	apt-get update
	apt-get install -y software-properties-common
	add-apt-repository -y multiverse
	dpkg --add-architecture i386
	echo steam steam/question select "I AGREE" | debconf-set-selections
	echo steam steam/license note '' | debconf-set-selections
	apt-get update
	apt-get install -y steamcmd lib32gcc-s1 lib32stdc++6 ca-certificates curl unzip tar jq openssl iproute2
	ln -sf "$STEAMCMD" /usr/local/bin/steamcmd
}

create_user_and_dirs() {
	log "Creating user $CS2_USER and directories"
	if ! id "$CS2_USER" >/dev/null 2>&1; then
		useradd --system --create-home --home-dir "$CS2_HOME" --shell /usr/sbin/nologin "$CS2_USER"
	fi
	mkdir -p "$CS2_DIR" "$AGENT_BIN_DIR" "$ENV_DIR" "$DATA_DIR"
	chown "$CS2_USER:" "$CS2_DIR" "$DATA_DIR"
	cat >/etc/security/limits.d/cs2.conf <<EOF
$CS2_USER soft nofile 1048576
$CS2_USER hard nofile 1048576
EOF
}

install_cs2() {
	if [ "$SKIP_CS2_INSTALL" = "1" ]; then
		log "Skipping CS2 install"
		return
	fi
	log "Installing CS2 dedicated server into $CS2_DIR (about 60 GB)"
	local i
	for i in 1 2 3; do
		if as_cs2 "$STEAMCMD" +force_install_dir "$CS2_DIR" +login anonymous +app_update 730 validate +quit; then
			break
		fi
		[ "$i" -lt 3 ] || die "steamcmd failed 3 times"
		echo "steamcmd failed, retrying"
		sleep 10
	done
	[ -x "$CS2_DIR/game/bin/linuxsteamrt64/cs2" ] || die "cs2 binary missing after install"
	if [ -f "$CS2_DIR/game/csgo/maps/rush_001.vpk" ]; then
		echo "rush_001.vpk present"
	else
		echo "warning: game/csgo/maps/rush_001.vpk not found. Rush will not start."
	fi
}

link_steamclient() {
	log "Linking steamclient.so for the server"
	local sdk="$CS2_HOME/.steam/sdk64" src=""
	local c
	for c in \
		"$CS2_HOME/.local/share/Steam/steamcmd/linux64/steamclient.so" \
		"$CS2_HOME/.steam/steamcmd/linux64/steamclient.so" \
		"$CS2_HOME/.steam/steam/linux64/steamclient.so" \
		"$CS2_DIR/game/bin/linuxsteamrt64/steamclient.so"; do
		if [ -f "$c" ]; then src="$c"; break; fi
	done
	if [ -z "$src" ]; then
		echo "warning: steamclient.so not found. The server may fail to log in to Steam."
		return
	fi
	as_cs2 mkdir -p "$sdk"
	as_cs2 ln -sf "$src" "$sdk/steamclient.so"
}

fetch() {
	# fetch <url or path> <dest>
	case "$1" in
		http://* | https://*) curl -fsSL --retry 3 -o "$2" "$1" ;;
		*) cp "$1" "$2" ;;
	esac
}

install_metamod() {
	log "Installing Metamod:Source 2.0"
	local url="$METAMOD_URL"
	if [ -z "$url" ]; then
		local name
		name="$(curl -fsSL https://mms.alliedmods.net/mmsdrop/2.0/mmsource-latest-linux)"
		url="https://mms.alliedmods.net/mmsdrop/2.0/$name"
	fi
	echo "Metamod: $url"
	local tmp
	tmp="$(mktemp -d)"
	fetch "$url" "$tmp/mms.tar.gz"
	as_cs2 mkdir -p "$CS2_DIR/game/csgo"
	tar -xzf "$tmp/mms.tar.gz" -C "$CS2_DIR/game/csgo"
	chown -R "$CS2_USER:" "$CS2_DIR/game/csgo/addons"
	rm -rf "$tmp"
	patch_gameinfo
}

patch_gameinfo() {
	# The agent does this too on start and after every CS2 update, since updates reset the file.
	local gi="$CS2_DIR/game/csgo/gameinfo.gi"
	[ -f "$gi" ] || { echo "warning: $gi missing, skipping Metamod patch"; return; }
	if grep -q 'csgo/addons/metamod' "$gi"; then
		echo "gameinfo.gi already loads Metamod"
		return
	fi
	sed -i '/Game_LowViolence[[:space:]]*csgo_lv/a\			Game	csgo/addons/metamod' "$gi"
	grep -q 'csgo/addons/metamod' "$gi" || die "could not patch $gi"
	echo "gameinfo.gi patched"
}

# CounterStrikeSharp v1.0.374, the latest release, predates CS2 1.41.8.2 and is broken on Linux:
# vtable offsets moved, ChangeTeam does nothing and Teleport crashes. Fixes are in PR #1432 and #1433.
# To get a build: on a dev machine run
#   gh run download --repo roflmuffin/CounterStrikeSharp <run-id> --name <with-runtime linux artifact>
# for the PR's CI run, or build that commit from source, then pass the zip as CSS_ZIP.
# Record the commit you used next to the zip. Switch back to releases once a fixed one ships.
install_css() {
	log "Installing CounterStrikeSharp from $CSS_ZIP"
	local tmp
	tmp="$(mktemp -d)"
	fetch "$CSS_ZIP" "$tmp/css.zip"
	if [ -n "$CSS_SHA256" ]; then
		echo "$CSS_SHA256  $tmp/css.zip" | sha256sum -c - || die "CSS_ZIP checksum mismatch"
	fi
	unzip -q -o "$tmp/css.zip" -d "$tmp/css"
	# Artifacts are sometimes nested one level down. Find the dir holding addons/.
	local root
	root="$(dirname "$(find "$tmp/css" -maxdepth 3 -type d -name addons | head -n1)")"
	[ -d "$root/addons/counterstrikesharp" ] || die "CSS_ZIP has no addons/counterstrikesharp"
	cp -a "$root/addons/." "$CS2_DIR/game/csgo/addons/"
	chown -R "$CS2_USER:" "$CS2_DIR/game/csgo/addons"
	rm -rf "$tmp"
	echo "CounterStrikeSharp installed. Drop the rushsite plugin into addons/counterstrikesharp/plugins/."
}

install_agent() {
	log "Installing agent to $AGENT_BIN_DIR/rushsite-agent"
	install -m 755 "$AGENT_BINARY" "$AGENT_BIN_DIR/rushsite-agent"

	if [ ! -f "$ENV_FILE" ]; then
		local ip="${PUBLIC_IP:-}"
		if [ -z "$ip" ]; then
			ip="$(ip -4 route get 1.1.1.1 | awk '{for (i=1;i<=NF;i++) if ($i=="src") print $(i+1)}')"
		fi
		[ -n "$ip" ] || die "could not detect the public IPv4. Set PUBLIC_IP."
		umask 077
		cat >"$ENV_FILE" <<EOF
# /etc/rushsite/agent.env  chmod 600, owned by root.
# The token must match RUSHSITE_AGENT_TOKEN in the API's .env.
RUSHSITE_AGENT_TOKEN=$(openssl rand -hex 32)
RUSHSITE_CS2_DIR=$CS2_DIR
RUSHSITE_PORT_RANGE=$PORT_RANGE
RUSHSITE_PUBLIC_IP=$ip
RUSHSITE_LISTEN=0.0.0.0:8080
RUSHSITE_DATA_DIR=$DATA_DIR
RUSHSITE_STEAMCMD=$STEAMCMD
EOF
		chmod 600 "$ENV_FILE"
		echo "Wrote $ENV_FILE with a new token. Copy the token into the API's .env."
	else
		echo "$ENV_FILE exists, leaving it alone"
	fi

	# Same unit as infra/systemd/rushsite-agent.service.
	cat >"$UNIT_FILE" <<EOF
[Unit]
Description=rushsite host agent
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
User=$CS2_USER
Group=$CS2_USER
EnvironmentFile=$ENV_FILE
ExecStart=$AGENT_BIN_DIR/rushsite-agent
Restart=always
RestartSec=3
# CS2 servers are children of the agent. Let them finish on agent restart.
KillMode=process
StateDirectory=rushsite-agent
LimitNOFILE=1048576
Nice=-5

[Install]
WantedBy=multi-user.target
EOF
	systemctl daemon-reload
	systemctl enable rushsite-agent
	systemctl restart rushsite-agent
}

install_packages
create_user_and_dirs
install_cs2
link_steamclient
install_metamod
install_css
install_agent

log "Done"
cat <<EOF
Next steps:
  - Firewall per infra/hetzner/README.md. UDP $PORT_RANGE open to all, TCP 8080 to the API only.
    GOTV uses game port + 100 (RUSHSITE_TV_PORT_OFFSET) and should stay closed.
  - curl -s -H "Authorization: Bearer \$TOKEN" http://127.0.0.1:8080/health
  - journalctl -u rushsite-agent -f
  - Rush test by hand, as $CS2_USER, before wiring the allocator:
    $CS2_DIR/game/bin/linuxsteamrt64/cs2 -dedicated -port 27015 +tv_enable 1 +bot_quota 0 +game_type 0 +game_mode 6 +map rush_001 +sv_setsteamaccount <GSLT>
EOF
