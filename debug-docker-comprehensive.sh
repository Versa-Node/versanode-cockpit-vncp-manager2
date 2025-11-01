#!/bin/bash

# Docker Socket Discovery and Test Script
echo "=== VNCP Docker Socket Discovery ==="
echo "Date: $(date)"
echo "User: $(whoami) (UID: $(id -u))"
echo "System: $(cat /etc/os-release | grep PRETTY_NAME | cut -d'"' -f2)"
echo

# Function to test a socket
test_socket() {
    local socket_path="$1"
    local label="$2"
    
    echo "Testing: $socket_path ($label)"
    
    if [ ! -e "$socket_path" ]; then
        echo "  ✗ File does not exist"
        return 1
    fi
    
    if [ ! -S "$socket_path" ]; then
        echo "  ✗ Not a socket file"
        ls -la "$socket_path" 2>/dev/null || echo "  ✗ Cannot access file"
        return 1
    fi
    
    echo "  ✓ Socket file exists"
    ls -la "$socket_path"
    
    # Test API access
    if command -v curl >/dev/null 2>&1; then
        echo "  Testing Docker API..."
        if timeout 5 curl --unix-socket "$socket_path" http://localhost/version >/dev/null 2>&1; then
            echo "  ✓ Docker API responds"
            echo "  API Version: $(curl --unix-socket "$socket_path" http://localhost/version 2>/dev/null | grep -o '"ApiVersion":"[^"]*"' | cut -d'"' -f4)"
            return 0
        else
            echo "  ✗ Docker API does not respond"
            return 1
        fi
    else
        echo "  ⚠ curl not available for API test"
        return 0
    fi
}

# Test all possible Docker socket locations
echo "=== Docker Socket Detection ==="
working_sockets=()

# Standard locations
test_socket "/var/run/docker.sock" "Standard system socket" && working_sockets+=("/var/run/docker.sock")
test_socket "/run/docker.sock" "Alternative system socket" && working_sockets+=("/run/docker.sock")
test_socket "/tmp/docker.sock" "Temporary socket" && working_sockets+=("/tmp/docker.sock")

# Snap Docker
test_socket "/var/snap/docker/common/var-lib-docker.sock" "Snap Docker socket" && working_sockets+=("/var/snap/docker/common/var-lib-docker.sock")

# User-specific locations
test_socket "/run/user/$(id -u)/docker.sock" "User runtime socket" && working_sockets+=("/run/user/$(id -u)/docker.sock")
test_socket "$HOME/.docker/docker.sock" "User home socket" && working_sockets+=("$HOME/.docker/docker.sock")

echo
echo "=== Docker Installation Analysis ==="

# Check Docker command
if command -v docker >/dev/null 2>&1; then
    echo "✓ Docker command available: $(which docker)"
    echo "  Version: $(docker --version 2>/dev/null || echo 'Version check failed')"
    
    # Test Docker command
    if docker ps >/dev/null 2>&1; then
        echo "  ✓ Docker command works"
    else
        echo "  ✗ Docker command fails (may need sudo or different socket)"
    fi
else
    echo "✗ Docker command not available"
fi

# Check installation method
echo
echo "Installation method detection:"
if command -v snap >/dev/null 2>&1 && snap list | grep -q docker; then
    echo "  ✓ Docker installed via Snap"
    snap info docker | grep "installed:"
elif which docker | grep -q snap; then
    echo "  ✓ Docker installed via Snap (symlink detected)"
elif dpkg -l | grep -q docker; then
    echo "  ✓ Docker installed via APT/dpkg"
    dpkg -l | grep docker
elif rpm -qa | grep -q docker; then
    echo "  ✓ Docker installed via RPM/YUM/DNF"
    rpm -qa | grep docker
else
    echo "  ? Docker installation method unclear"
fi

echo
echo "=== Service Status ==="
systemctl is-active docker >/dev/null 2>&1 && echo "✓ docker.service is active" || echo "✗ docker.service not active"
systemctl is-active docker.socket >/dev/null 2>&1 && echo "✓ docker.socket is active" || echo "✗ docker.socket not active"

# Check if Docker daemon is running
if pgrep dockerd >/dev/null 2>&1; then
    echo "✓ Docker daemon (dockerd) is running"
    echo "  Process: $(pgrep -f dockerd | head -1)"
    echo "  Command: $(ps -p $(pgrep -f dockerd | head -1) -o cmd --no-headers 2>/dev/null)"
else
    echo "✗ Docker daemon (dockerd) not running"
fi

echo
echo "=== Summary and Recommendations ==="
if [ ${#working_sockets[@]} -gt 0 ]; then
    echo "✓ Found ${#working_sockets[@]} working Docker socket(s):"
    for socket in "${working_sockets[@]}"; do
        echo "  - $socket"
    done
    echo
    echo "For VNCP Manager, use this socket path in rest.ts:"
    echo "  const DOCKER_SOCKET_PATH = \"${working_sockets[0]}\";"
    echo
    echo "To fix VNCP Manager immediately:"
    echo "1. Edit src/rest.ts and change the socket path to: ${working_sockets[0]}"
    echo "2. Rebuild: node build.js"
    echo "3. Reinstall: sudo make install"
    echo "4. Restart Cockpit: sudo systemctl restart cockpit"
else
    echo "✗ No working Docker sockets found!"
    echo
    echo "Troubleshooting steps:"
    echo "1. Check if Docker is running: sudo systemctl status docker"
    echo "2. Start Docker if needed: sudo systemctl start docker"
    echo "3. Check Docker installation: docker --version"
    echo "4. Test Docker manually: docker ps"
    echo "5. Check permissions: sudo ls -la /var/run/docker.sock"
fi

echo
echo "=== Current User Docker Access ==="
if groups | grep -q docker; then
    echo "✓ Current user is in 'docker' group"
else
    echo "✗ Current user NOT in 'docker' group"
    echo "  Add to group: sudo usermod -aG docker $(whoami)"
    echo "  Then log out and back in"
fi