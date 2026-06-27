#!/bin/bash
set -e
REPO_DIR="$HOME/code-world"
LOG="$REPO_DIR/scripts/auto-build.log"
MAX_ATTEMPTS=5
mkdir -p "$REPO_DIR/scripts/prompts"

log() { echo "[$(date '+%H:%M:%S')] $1" | tee -a "$LOG"; }

wait_for_merge() {
  local branch=$1
  log "Waiting for merge: $branch"
  while true; do
    STATE=$(gh pr list --head "$branch" --json state -q '.[0].state' 2>/dev/null || echo "")
    if [ "$STATE" = "MERGED" ]; then
      log "Merged: $branch"
      return 0
    elif [ -z "$STATE" ]; then
      log "No PR found for $branch - waiting 60s..."
    else
      log "PR state: $STATE - waiting 60s..."
    fi
    sleep 60
  done
}

run_area() {
  local area=$1
  local prompt_file="$REPO_DIR/scripts/prompts/${area}.md"
  local branch="feat/shibuya-${area}"

  log "====== START: $area ======"

  if [ ! -f "$prompt_file" ]; then
    log "ERROR: Prompt file not found: $prompt_file - skipping $area"
    return 0
  fi

  cd "$REPO_DIR"
  git checkout main && git pull

  # Retry loop for Claude token limits (capped at MAX_ATTEMPTS)
  local attempt=0
  local success=0
  while [ $attempt -lt $MAX_ATTEMPTS ]; do
    attempt=$((attempt + 1))
    log "Attempt $attempt/$MAX_ATTEMPTS for $area"

    if claude --dangerously-skip-permissions < "$prompt_file"; then
      log "Claude Code completed for $area"
      success=1
      break
    else
      EXIT_CODE=$?
      log "Claude Code failed (exit $EXIT_CODE) - waiting 5min and retrying..."
      sleep 300
    fi
  done

  if [ $success -eq 0 ]; then
    log "ERROR: $area failed after $MAX_ATTEMPTS attempts - skipping"
    return 0
  fi

  # Enable auto-merge on created PR
  PR_NUM=$(gh pr list --head "$branch" --json number -q '.[0].number' 2>/dev/null || echo "")
  if [ -n "$PR_NUM" ]; then
    gh pr merge "$PR_NUM" --merge --auto 2>/dev/null || true
    log "Auto-merge enabled for PR #$PR_NUM"
  fi

  wait_for_merge "$branch"
  sleep 30  # Let Railway deploy
  log "====== DONE: $area ======"
}

# Queue - 公園通りは既に手動で実行中なので宮益坂から
log "Starting Shibuya auto-build queue"
run_area "miyamazuzaka"
run_area "eki-higashi"
run_area "bunkamura"
log "All areas complete! Check production."
