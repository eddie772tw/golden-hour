#!/bin/sh
set -eu
if [ "$#" -eq 0 ]; then set -- host; fi
exec node "$(dirname "$0")/launch.mjs" "$@"
