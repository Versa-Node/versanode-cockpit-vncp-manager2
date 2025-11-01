#!/bin/bash

# Test script to check Docker detection paths
echo "=== Docker Detection Test ==="
echo "Date: $(date)"
echo "User: $(whoami)"
echo

echo "=== Checking common Docker paths ==="

# Common systemd unit file locations
paths=(
    "/lib/systemd/system/docker.socket"
    "/usr/lib/systemd/system/docker.socket" 
    "/etc/systemd/system/docker.socket"
    "/lib/systemd/system/docker.service"
    "/usr/lib/systemd/system/docker.service"
    "/etc/systemd/system/docker.service"
)

for path in "${paths[@]}"; do
    if [ -f "$path" ]; then
        echo "✓ EXISTS: $path"
    else
        echo "✗ MISSING: $path"
    fi
done

echo
echo "=== Checking Docker socket files ==="

# Common socket file locations
socket_paths=(
    "/var/run/docker.sock"
    "/run/docker.sock" 
    "/tmp/docker.sock"
)

for path in "${socket_paths[@]}"; do
    if [ -S "$path" ]; then
        echo "✓ SOCKET EXISTS: $path"
        ls -la "$path"
    else
        echo "✗ NO SOCKET: $path"
    fi
done

echo
echo "=== Checking systemctl status ==="
echo "Docker service status:"
systemctl is-active docker.service 2>/dev/null || echo "docker.service not active"
systemctl is-enabled docker.service 2>/dev/null || echo "docker.service not enabled"

echo
echo "Docker socket status:"
systemctl is-active docker.socket 2>/dev/null || echo "docker.socket not active"  
systemctl is-enabled docker.socket 2>/dev/null || echo "docker.socket not enabled"

echo
echo "=== Checking Docker command ==="
if command -v docker >/dev/null 2>&1; then
    echo "✓ Docker command available"
    docker version 2>/dev/null || echo "Docker command failed"
else
    echo "✗ Docker command not found"
fi

echo
echo "=== Systemd unit file search ==="
find /lib/systemd/system /usr/lib/systemd/system /etc/systemd/system -name "*docker*" 2>/dev/null || echo "No systemd Docker units found"

echo
echo "=== Process check ==="
ps aux | grep -i docker | grep -v grep || echo "No Docker processes found"