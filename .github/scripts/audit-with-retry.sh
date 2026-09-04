#!/usr/bin/env bash
#
# Run a dependency audit, retrying only when the registry could not be reached.
#
# Both `npm audit` and `pip-audit` exit non-zero for two very different reasons:
# a real advisory, and a registry that would not answer. Only the second is
# worth a retry — the audit endpoints 503 often enough to redden PRs that
# changed no dependency at all. An advisory fails on the first attempt, so a
# vulnerability can never be retried into a pass.
#
# Usage: audit-with-retry.sh <command> [args...]

set -uo pipefail

ATTEMPTS=${AUDIT_ATTEMPTS:-3}
DELAY=${AUDIT_RETRY_DELAY:-30}

# Transport and availability failures, from both npm and pip-audit/urllib3.
NETWORK_FAILURE='audit endpoint returned an error|service unavailable|max retries exceeded|connectionerror|readtimeout|read timed out|temporary failure in name resolution|50[234] server error|etimedout|econnreset|enotfound|socket hang up|connection reset|remotedisconnected|urlopen error|timeouterror'

for attempt in $(seq 1 "$ATTEMPTS"); do
  if out=$("$@" 2>&1); then
    echo "$out"
    exit 0
  fi
  echo "$out"

  if ! grep -qiE "$NETWORK_FAILURE" <<<"$out"; then
    echo "::error::$1 reported findings — see the output above"
    exit 1
  fi

  echo "::warning::$1 could not reach its registry (attempt $attempt/$ATTEMPTS)"
  if [ "$attempt" -lt "$ATTEMPTS" ]; then sleep "$DELAY"; fi
done

echo "::error::$1 could not reach its registry after $ATTEMPTS attempts"
exit 1
