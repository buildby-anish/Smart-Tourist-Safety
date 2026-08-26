#!/bin/sh
set -euo pipefail

if [ -z "${PODS_ROOT:-}" ]; then
  PODS_ROOT="./Pods"
fi

find "${PODS_ROOT}/Target Support Files" -maxdepth 2 -name "*-frameworks.sh" -type f -print0 2>/dev/null | xargs -0 chmod +x || true
find "${PODS_ROOT}/Target Support Files" -maxdepth 2 -name "*-resources.sh" -type f -print0 2>/dev/null | xargs -0 chmod +x || true
