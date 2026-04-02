#!/bin/bash
# Build script for Super Excellent
# Usage: ./scripts/build.sh [platform]
# Platforms: macos, windows, all (default: current platform)

set -e

PLATFORM=${1:-"current"}
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "🌟 Building Super Excellent..."
echo "Platform: $PLATFORM"
echo ""

# Step 1: Install dependencies
echo "📦 Installing dependencies..."
cd "$ROOT_DIR"
pnpm install

# Step 2: Build agent-core
echo "🔧 Building agent-core..."
cd "$ROOT_DIR/packages/agent-core"
npx tsc

# Step 3: Build shared types
echo "🔧 Building shared types..."
cd "$ROOT_DIR/packages/shared"
npx tsc

# Step 4: Build frontend
echo "🎨 Building frontend..."
cd "$ROOT_DIR/apps/desktop"
npx vite build

# Step 5: Build Tauri app
echo "🚀 Building Tauri app..."
cd "$ROOT_DIR/apps/desktop"

case "$PLATFORM" in
  macos)
    npx tauri build --target universal-apple-darwin
    ;;
  windows)
    npx tauri build --target x86_64-pc-windows-msvc
    ;;
  current|all)
    npx tauri build
    ;;
  *)
    echo "Unknown platform: $PLATFORM"
    exit 1
    ;;
esac

echo ""
echo "✅ Build complete!"
echo "📁 Output: apps/desktop/src-tauri/target/release/bundle/"
