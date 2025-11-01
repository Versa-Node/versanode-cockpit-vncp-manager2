#!/bin/bash

echo "=== Docker Socket Detection Test ==="
echo "Date: $(date)"
echo "System: $(uname -a)"
echo

# Check all possible Docker socket locations
echo "=== Socket File Detection ==="
socket_paths=(
    "/var/run/docker.sock"
    "/run/docker.sock" 
    "/tmp/docker.sock"
    "/run/user/$(id -u)/docker.sock"
    "/run/user/1000/docker.sock"
    "/home/$(whoami)/.docker/docker.sock"
)

working_socket=""
for path in "${socket_paths[@]}"; do
    if [ -S "$path" ]; then
        echo "✓ SOCKET FOUND: $path"
        ls -la "$path"
        working_socket="$path"
    else
        echo "✗ NO SOCKET: $path"
    fi
done

echo
echo "=== Docker Process Detection ==="
ps aux | grep docker | grep -v grep || echo "No Docker processes found"

echo
echo "=== Docker Service Status ==="
systemctl is-active docker 2>/dev/null && echo "Docker service is active" || echo "Docker service not active"
systemctl is-active docker.service 2>/dev/null && echo "docker.service is active" || echo "docker.service not active"
systemctl is-active docker.socket 2>/dev/null && echo "docker.socket is active" || echo "docker.socket not active"

echo
echo "=== Docker Installation Check ==="
which docker && echo "Docker command found at: $(which docker)" || echo "Docker command not found"

if command -v docker >/dev/null 2>&1; then
    echo "Docker version: $(docker --version 2>/dev/null || echo 'Version check failed')"
    
    echo
    echo "=== Docker Info Test ==="
    docker info 2>/dev/null | head -5 || echo "Docker info failed - daemon may not be running"
else
    echo "Docker command not available"
fi

echo
echo "=== Socket API Test ==="
if [ -n "$working_socket" ] && [ -S "$working_socket" ]; then
    echo "Testing Docker API via $working_socket..."
    if command -v curl >/dev/null 2>&1; then
        curl --unix-socket "$working_socket" http://localhost/version 2>/dev/null | head -3 || echo "API test failed"
    else
        echo "curl not available for API test"
    fi
else
    echo "No working socket found for API test"
fi

echo
echo "=== Snap Docker Check ==="
if command -v snap >/dev/null 2>&1; then
    snap list | grep docker && echo "Docker installed via snap" || echo "Docker not installed via snap"
    
    # Snap Docker uses different paths
    if [ -S "/var/snap/docker/common/var-lib-docker.sock" ]; then
        echo "✓ Snap Docker socket found: /var/snap/docker/common/var-lib-docker.sock"
    fi
else
    echo "Snap not available"
fi

echo
echo "=== Summary ==="
if [ -n "$working_socket" ]; then
    echo "Working Docker socket: $working_socket"
    echo "Use this path in VNCP Manager configuration"
else
    echo "No Docker socket found - Docker may not be running or installed properly"
fi