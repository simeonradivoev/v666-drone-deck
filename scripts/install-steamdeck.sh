#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || ! -f "$1" ]]; then
  echo "Usage: $0 /path/to/China-Drone-Deck-*.AppImage" >&2
  exit 2
fi

install_dir="${HOME}/Applications"
desktop_dir="${HOME}/.local/share/applications"
app_path="${install_dir}/China-Drone-Deck.AppImage"
mkdir -p "$install_dir" "$desktop_dir"
install -m 755 "$1" "$app_path"

cat > "${desktop_dir}/china-drone-deck.desktop" <<EOF
[Desktop Entry]
Name=China Drone Deck
Comment=V666 Wi-Fi drone ground station
Exec=${app_path} --no-sandbox
Terminal=false
Type=Application
Categories=Game;Utility;
StartupWMClass=China Drone Deck
EOF

echo "Installed ${app_path}"
echo "In Steam Desktop Mode: Steam > Add a Non-Steam Game > China Drone Deck."
