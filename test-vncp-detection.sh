#!/bin/bash

# Test VNCP Manager plugin installation and Docker detection
echo "=== VNCP Manager Plugin Test ==="
echo "Date: $(date)"
echo

# Check if we're on the target server
echo "=== System Information ==="
echo "Hostname: $(hostname)"
echo "OS: $(cat /etc/os-release | grep PRETTY_NAME)"
echo "User: $(whoami)"
echo

# Check Cockpit installation
echo "=== Cockpit Status ==="
systemctl is-active cockpit.socket 2>/dev/null && echo "✓ Cockpit socket is active" || echo "✗ Cockpit socket not active"
systemctl is-enabled cockpit.socket 2>/dev/null && echo "✓ Cockpit socket is enabled" || echo "✗ Cockpit socket not enabled"

# Check if cockpit is running
if systemctl is-active cockpit.socket >/dev/null 2>&1; then
    echo "✓ Cockpit is running"
    ss -tlnp | grep :9090 && echo "✓ Cockpit listening on port 9090" || echo "✗ Cockpit not listening on port 9090"
else
    echo "✗ Cockpit is not running"
fi

echo

# Check plugin installation
echo "=== VNCP Manager Plugin Installation ==="
PLUGIN_PATHS=(
    "/usr/local/share/cockpit/vncp"
    "/usr/share/cockpit/vncp"  
    "/home/$(whoami)/.local/share/cockpit/vncp"
)

for path in "${PLUGIN_PATHS[@]}"; do
    if [ -d "$path" ]; then
        echo "✓ Plugin found at: $path"
        ls -la "$path"
        if [ -f "$path/manifest.json" ]; then
            echo "  ✓ manifest.json exists"
            echo "  Manifest contents:"
            cat "$path/manifest.json"
        else
            echo "  ✗ manifest.json missing"
        fi
    else
        echo "✗ Plugin not found at: $path"
    fi
done

echo

# Check Docker installation and paths
echo "=== Docker Detection Analysis ==="

# Check Docker command
if command -v docker >/dev/null 2>&1; then
    echo "✓ Docker command available"
    echo "  Docker version: $(docker --version 2>/dev/null || echo 'Version check failed')"
else
    echo "✗ Docker command not available"
fi

echo

# Check systemd unit files (what manifest.json checks)
echo "=== Systemd Unit File Detection ==="
UNIT_PATHS=(
    "/lib/systemd/system/docker.socket"
    "/usr/lib/systemd/system/docker.socket" 
    "/etc/systemd/system/docker.socket"
    "/lib/systemd/system/docker.service"
    "/usr/lib/systemd/system/docker.service"
    "/etc/systemd/system/docker.service"
)

manifest_condition_met=false
for path in "${UNIT_PATHS[@]}"; do
    if [ -f "$path" ]; then
        echo "✓ EXISTS: $path"
        manifest_condition_met=true
    else
        echo "✗ MISSING: $path"
    fi
done

if [ "$manifest_condition_met" = true ]; then
    echo "✓ Manifest condition should be satisfied"
else
    echo "✗ Manifest condition NOT satisfied - plugin won't appear in Cockpit"
fi

echo

# Check actual Docker socket files (what rest.ts connects to)
echo "=== Docker Socket Files ==="
SOCKET_PATHS=(
    "/var/run/docker.sock"
    "/run/docker.sock"
    "/tmp/docker.sock"
)

socket_found=false
for path in "${SOCKET_PATHS[@]}"; do
    if [ -S "$path" ]; then
        echo "✓ SOCKET EXISTS: $path"
        ls -la "$path"
        socket_found=true
    else
        echo "✗ NO SOCKET: $path"
    fi
done

if [ "$socket_found" = true ]; then
    echo "✓ Docker socket available for connections"
else
    echo "✗ No Docker sockets found - connections will fail"
fi

echo

# Check Docker service status
echo "=== Docker Service Status ==="
echo "docker.service:"
systemctl is-active docker.service 2>/dev/null && echo "  ✓ Active" || echo "  ✗ Not active"
systemctl is-enabled docker.service 2>/dev/null && echo "  ✓ Enabled" || echo "  ✗ Not enabled"

echo "docker.socket:"
systemctl is-active docker.socket 2>/dev/null && echo "  ✓ Active" || echo "  ✗ Not active"  
systemctl is-enabled docker.socket 2>/dev/null && echo "  ✓ Enabled" || echo "  ✗ Not enabled"

echo

# Try to test Docker API connection
echo "=== Docker API Connection Test ==="
if [ -S "/var/run/docker.sock" ]; then
    echo "Testing Docker API via /var/run/docker.sock..."
    curl --unix-socket /var/run/docker.sock http://localhost/version 2>/dev/null | head -3 && echo "✓ Docker API responds" || echo "✗ Docker API not responding"
elif [ -S "/run/docker.sock" ]; then
    echo "Testing Docker API via /run/docker.sock..."
    curl --unix-socket /run/docker.sock http://localhost/version 2>/dev/null | head -3 && echo "✓ Docker API responds" || echo "✗ Docker API not responding"
else
    echo "✗ No Docker socket available for API test"
fi

echo

# Summary
echo "=== Summary ==="
if [ "$manifest_condition_met" = true ] && [ "$socket_found" = true ]; then
    echo "✓ Both manifest conditions and socket files are satisfied"
    echo "  → VNCP Manager should appear and work in Cockpit"
elif [ "$manifest_condition_met" = true ]; then
    echo "⚠ Manifest condition met but no Docker socket found"
    echo "  → VNCP Manager will appear but show 'Docker service failed'"
elif [ "$socket_found" = true ]; then
    echo "⚠ Docker socket exists but manifest condition not met" 
    echo "  → VNCP Manager won't appear in Cockpit menu"
else
    echo "✗ Neither manifest condition nor socket files found"
    echo "  → VNCP Manager won't appear and won't work"
fi

echo
echo "=== Recommendations ==="
if [ "$manifest_condition_met" = false ]; then
    echo "1. Install Docker properly with systemd integration"
    echo "2. Or modify manifest.json to use different detection method"
fi

if [ "$socket_found" = false ]; then
    echo "1. Start Docker service: sudo systemctl start docker"
    echo "2. Enable Docker service: sudo systemctl enable docker"  
    echo "3. Check Docker installation"
fi

echo
echo "Test completed. Check above output for issues."