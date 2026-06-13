#!/usr/bin/env bash
# Post a single Discord embed for a CI/CD event.
#
# Inputs are read from the environment (NEVER passed on the command line) so
# untrusted values like commit messages / PR titles can't be shell-injected:
#   DISCORD_WEBHOOK  the webhook URL (a repo secret; required — skips if empty)
#   NOTIFY_TITLE     embed title (status line, e.g. "✅ CI パス: main")
#   NOTIFY_DESC      embed description (free text; commit message / PR title)
#   NOTIFY_COLOR     embed colour as a decimal int (green/red/blue) — optional
#
# Fails soft: a missing webhook (forks, contributors without the secret) or a
# Discord hiccup never breaks the build.
set -uo pipefail

if [ -z "${DISCORD_WEBHOOK:-}" ]; then
  echo "DISCORD_WEBHOOK not configured — skipping Discord notification."
  exit 0
fi

title="${NOTIFY_TITLE:-Notification}"
desc="${NOTIFY_DESC:-}"
color="${NOTIFY_COLOR:-3447003}" # default: blue (info)
# Discord embed descriptions cap at 4096 chars; trim long commit messages.
desc="${desc:0:1800}"
ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# jq builds the JSON so quotes / newlines / backticks in $desc stay data.
payload="$(jq -n \
  --arg t "$title" \
  --arg d "$desc" \
  --argjson c "$color" \
  --arg ts "$ts" \
  '{username: "code-world CI", embeds: [{title: $t, description: $d, color: $c, timestamp: $ts}]}')"

curl -fsS -m 15 -H "Content-Type: application/json" -d "$payload" "$DISCORD_WEBHOOK" >/dev/null \
  && echo "Discord notification sent: $title" \
  || echo "Discord notification failed (ignored)."
exit 0
