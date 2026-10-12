#!/bin/sh
# Double-click or run: starts the LAN Pinger helper in a visible window.
cd "$(dirname "$0")"
echo "This computer will find your main laptop on the Wi-Fi and become findable."
echo "Leave this window open. Press Ctrl+C to stop."
echo
node agent.js "" "$(hostname)"
