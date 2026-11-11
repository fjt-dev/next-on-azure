#!/usr/bin/env bash
# `pnpm install` with up to three attempts. The postinstall of azure-functions-core-tools downloads a binary,
# and that download failed now and then on GitHub runners (a network error), which failed the whole job.
# A real failure (a wrong lockfile, a missing package) fails three times and then fails the job.
#   bash scripts/ci/pnpm-install.sh [pnpm install flags]
set -u
for attempt in 1 2 3; do
  if pnpm install "$@"; then exit 0; fi
  echo "pnpm install failed (attempt ${attempt} of 3)" >&2
  [ "${attempt}" -lt 3 ] && sleep 20
done
exit 1
