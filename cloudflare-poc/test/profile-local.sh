#!/usr/bin/env bash
set -euo pipefail
# GNU time reports command/child elapsed, CPU and maximum RSS (not sum of process peaks).
# These are runner/process measurements, not per-request workerd or hosted CPU billing.
mkdir -p reports
if [ -x /usr/bin/time ]; then
  status=0
  /usr/bin/time -v -o reports/storage-process-profile.txt node --test --test-concurrency=1 test/storage-*.test.mjs || status=$?
  cat reports/storage-process-profile.txt
  exit "$status"
else
  echo "GNU time unavailable; no CPU/RSS profiling" | tee reports/storage-process-profile.txt
  node --test --test-concurrency=1 test/storage-*.test.mjs
fi
