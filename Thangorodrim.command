#!/bin/sh
# Double-click in Finder to play.  Opens a Terminal window that runs the
# game; close the window (or press Ctrl+C) to save and quit.
exec sh "$(dirname "$0")/scripts/launch.sh" "$@"
