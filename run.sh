#!/usr/bin/env bash
# One command for everything, designed for a fresh GitHub Codespace.
#
#   bash run.sh                 install, test, lint, deploy a fresh contract, run the live e2e, write a report
#   bash run.sh test            offline tests only (no network needed)
#   bash run.sh deploy          deploy the contract to Studionet and write artifacts/deployment.json
#   bash run.sh e2e [flags]     run the live end-to-end suite against artifacts/deployment.json
#
# Extra flags after "all" or "e2e" go to scripts/e2e.mjs, for example:
#   bash run.sh all --finality              wait for FINALIZED (slower, strongest)
#   bash run.sh all --only light-speed      only some scenarios
#   bash run.sh all --skip-refusals         skip the refusal proofs
#
# Environment (all optional):
#   TRIANGULATE_PRIVATE_KEY   0x... deployer / signer 0 key (default: throwaway keys; Studionet is gasless)
#   TRIANGULATE_RPC           RPC endpoint (default https://studio.genlayer.com/api)
#   TRIANGULATE_ADDRESS       use an existing deployment instead of artifacts/deployment.json

set -euo pipefail
cd "$(dirname "$0")"

step() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
note() { printf '   %s\n' "$1"; }
die() { printf '\n\033[31m%s\033[0m\n' "$1" >&2; exit 1; }

need_tools() {
  command -v node >/dev/null 2>&1 || die "Node.js is required (version 20 or newer)."
  command -v python3 >/dev/null 2>&1 || die "Python 3 is required."
  local major
  major="$(node -p 'process.versions.node.split(".")[0]')"
  [ "$major" -ge 20 ] || die "Node.js 20 or newer is required (found $(node -v))."
}

install_deps() {
  step "Installing dependencies"
  if [ ! -d node_modules/genlayer-js ]; then
    npm install --no-audit --no-fund
  else
    note "node_modules present"
  fi
  if ! command -v genvm-lint >/dev/null 2>&1; then
    note "installing genvm-linter (optional, used to check the contract against the real GenVM rules)"
    pip install --quiet genvm-linter 2>/dev/null || pip install --quiet --break-system-packages genvm-linter 2>/dev/null || note "could not install genvm-linter; the lint step will be skipped"
  fi
}

run_tests() {
  step "Offline tests: contract, simulator, hygiene, determinism (Python)"
  python3 -m unittest discover -s tests -t tests
  step "Offline tests: scripts, receipts, report and the whole e2e flow against the real contract code (Node)"
  node --test tests/node/*.test.mjs
}

run_lint() {
  step "Checking the contract against the real GenVM linter"
  if command -v genvm-lint >/dev/null 2>&1; then
    genvm-lint check contracts/triangulate.py
  else
    note "genvm-lint is not installed; skipped"
  fi
}

run_deploy() {
  step "Deploying to Studionet"
  node scripts/deploy.mjs
}

run_e2e() {
  step "Live end-to-end run on Studionet"
  node scripts/e2e.mjs "$@"
}

command="${1:-all}"
if [ "$#" -gt 0 ]; then shift; fi

need_tools
case "$command" in
  test)
    install_deps
    run_tests
    run_lint
    ;;
  deploy)
    install_deps
    run_deploy
    ;;
  e2e)
    install_deps
    run_e2e "$@"
    ;;
  all)
    install_deps
    run_tests
    run_lint
    run_deploy
    run_e2e "$@"
    ;;
  *)
    die "Unknown command '$command'. Use: all, test, deploy or e2e."
    ;;
esac
printf '\nDone.\n'
