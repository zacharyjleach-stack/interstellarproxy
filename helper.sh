#!/bin/sh
# Double-click or run: starts the LAN Pinger helper in a visible window.
cd "$(dirname "$0")"
if [ ! -f .master ]; then
  printf "First time setup.\nPaste your main laptop's app address (like https://192.168.1.20:3000): "
  read MASTER
  echo "$MASTER" > .master
fi
MASTER="$(cat .master)"
echo
echo "This computer is now findable and ringable from the app at $MASTER"
echo "Leave this window open. Press Ctrl+C to stop."
echo
node agent.js "$MASTER" "$(hostname)"
