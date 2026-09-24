#!/usr/bin/env bash
# Redeploys the site when the checked out branch moves on origin.
# Run every minute by infra/systemd/rushsite-autodeploy.timer as the deploy user.
#
# - Builds before touching the running stack. A failed build leaves the site up and the
#   commit is skipped until a newer one lands.
# - Keeps the previous api and web images as :prev and puts them back when the new
#   containers fail their health checks. Migrations are not rolled back.
# - Pushes that only touch docs, the agent, the plugin or the worker just fast forward.
#
# Logs: journalctl -u rushsite-autodeploy
set -euo pipefail

# Everything runs inside main so a git pull that rewrites this file cannot change a running copy.
main() {
  cd "${REPO_DIR:-/srv/rushsite}"
  exec 9>"${XDG_RUNTIME_DIR:-/tmp}/rushsite-autodeploy.lock"
  flock -n 9 || exit 0

  local branch old new failed_file changed tag
  branch="$(git rev-parse --abbrev-ref HEAD)"
  git fetch -q origin "$branch"
  old="$(git rev-parse HEAD)"
  new="$(git rev-parse "origin/$branch")"
  [[ "$old" == "$new" ]] && exit 0

  failed_file=".git/autodeploy-failed"
  if [[ -f "$failed_file" && "$(cat "$failed_file")" == "$new" ]]; then exit 0; fi

  echo "$branch: ${old:0:7} -> ${new:0:7}"
  if ! git merge -q --ff-only "origin/$branch"; then
    echo "origin/$branch is not a fast forward of HEAD. Fix the checkout by hand"
    echo "$new" > "$failed_file"
    exit 1
  fi

  changed="$(git diff --name-only "$old" "$new")"
  if ! grep -qvE '^(docs/|agent/|plugin/|worker/)|\.md$' <<<"$changed"; then
    echo "no site files changed, deployed $(git log -1 --oneline) without a rebuild"
    exit 0
  fi

  tag="$(sed -n 's/^IMAGE_TAG=//p' .env)"
  tag="${tag:-dev}"
  for img in api web; do
    docker image inspect "rushsite/$img:$tag" >/dev/null 2>&1 && docker tag "rushsite/$img:$tag" "rushsite/$img:prev"
  done

  if ! docker compose build api web; then
    echo "build failed for ${new:0:7}, site left on ${old:0:7}"
    git reset -q --hard "$old"
    echo "$new" > "$failed_file"
    exit 1
  fi

  if ! docker compose up -d --wait postgres redis api web caddy; then
    echo "new containers are unhealthy, rolling back to the previous images"
    docker compose logs api --tail 40 --no-log-prefix || true
    for img in api web; do
      docker image inspect "rushsite/$img:prev" >/dev/null 2>&1 && docker tag "rushsite/$img:prev" "rushsite/$img:$tag"
    done
    git reset -q --hard "$old"
    echo "$new" > "$failed_file"
    docker compose up -d --wait api web || true
    exit 1
  fi

  # Caddy bind mounts a single file, which git replaces, so it needs a restart to see edits.
  if grep -q '^infra/caddy/' <<<"$changed"; then docker compose restart caddy; fi

  rm -f "$failed_file"
  docker image prune -f >/dev/null
  echo "deployed $(git log -1 --oneline)"
}

main "$@"
exit
