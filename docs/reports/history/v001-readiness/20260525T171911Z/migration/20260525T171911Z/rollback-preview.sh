#!/usr/bin/env bash
set -euo pipefail
DATA_DIR="/var/folders/zd/s8tbt3211318l01qswk3sfmw0000gn/T/pact-v001-migration-fixture-LUWtyz"
RECOVERY_ROOT="/Users/unka/DevSpace/Unka-Malloc/Pact/reports/v001-readiness/20260525T171911Z/migration/20260525T171911Z/recovery-files"
echo "Pact v0.0.1 rollback helper"
echo "Data dir: $DATA_DIR"
echo "Recovery root: $RECOVERY_ROOT"
echo "This script prints exact copy commands and does not overwrite files automatically."
find "$RECOVERY_ROOT" -type f | while read -r file; do
  rel="${file#$RECOVERY_ROOT/}"
  printf "cp %q %q\n" "$file" "$DATA_DIR/$rel"
done
