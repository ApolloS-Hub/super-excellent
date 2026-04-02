#!/bin/bash
# Dev mode for Super Excellent
# Starts Vite dev server + Tauri in dev mode

set -e

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR/apps/desktop"

echo "🌟 Starting Super Excellent in dev mode..."
echo "Frontend: http://localhost:1420"
echo ""

# Option 1: Full Tauri dev (with Rust backend)
if command -v cargo &> /dev/null; then
  echo "🦀 Tauri dev mode (with Rust backend)"
  npx tauri dev
else
  echo "⚡ Vite-only dev mode (no Rust backend)"
  echo "   Install Rust for full Tauri experience"
  npx vite dev
fi
