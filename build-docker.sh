#!/bin/bash
# Build script for VNCP Manager (Docker version)
# This script handles the build dependencies and compilation

set -e

echo "🐳 Building VNCP Manager (Docker Version)..."

# Check if we have the required build infrastructure
if [ ! -d "pkg/lib" ]; then
    echo "📦 Setting up build infrastructure..."
    
    # Create temporary directory for cockpit checkout
    mkdir -p temp_cockpit
    cd temp_cockpit
    
    # Clone cockpit repository with specific commit
    git clone --depth 1 https://github.com/cockpit-project/cockpit.git .
    git fetch --no-tags --no-write-fetch-head --depth=1 https://github.com/cockpit-project/cockpit.git a358c8816e316340c8d204b457d71660e74ea165
    
    # Copy required files to parent directory
    cd ..
    cp -r temp_cockpit/pkg .
    cp -r temp_cockpit/test/common test/ 2>/dev/null || true
    cp -r temp_cockpit/tools .
    
    # Clean up
    rm -rf temp_cockpit
    
    echo "✅ Build infrastructure set up"
fi

# Install npm dependencies if needed
if [ ! -f "package-lock.json" ] || [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
    echo "✅ Dependencies installed"
fi

# Build the project
echo "🔨 Building project..."
node build.js

echo "✅ Build completed! Output in ./dist/"
echo ""
echo "To install locally for development:"
echo "  mkdir -p ~/.local/share/cockpit"
echo "  cp -r dist ~/.local/share/cockpit/'VNCP Manager'"
echo ""
echo "To install system-wide (requires sudo):"
echo "  sudo mkdir -p /usr/local/share/cockpit"
echo "  sudo cp -r dist/* /usr/local/share/cockpit/'VNCP Manager'"