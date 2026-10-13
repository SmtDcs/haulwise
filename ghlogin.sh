#!/usr/bin/env bash
# Reads your GitHub token interactively (not shown on screen) and logs gh in.
read -rsp "Paste your GitHub token and press Enter: " TOKEN
echo
printf '%s' "$TOKEN" | /home/sandbox/.local/bin/gh auth login --with-token
echo "Auth status:"
/home/sandbox/.local/bin/gh auth status
