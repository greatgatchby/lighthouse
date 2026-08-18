#!/bin/sh
# Nightly backup: pg_dump + storage sync into /backups (bind-mounted).
# This is your financial and document archive — the restore script is tested, use it.
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
STORAGE_DIR="${STORAGE_DIR:-/app/storage}"
STAMP="$(date +%Y-%m-%d)"

mkdir -p "$BACKUP_DIR/db" "$BACKUP_DIR/storage"

pg_dump "$DATABASE_URL" --format=custom --file="$BACKUP_DIR/db/lighthouse-$STAMP.dump"

# content-addressed files never change, so a plain copy-if-missing is a sync
cp -Rn "$STORAGE_DIR/." "$BACKUP_DIR/storage/" 2>/dev/null || true

# keep the last 30 dumps
ls -1t "$BACKUP_DIR"/db/lighthouse-*.dump 2>/dev/null | tail -n +31 | xargs rm -f 2>/dev/null || true

echo "backup complete: $BACKUP_DIR/db/lighthouse-$STAMP.dump"
