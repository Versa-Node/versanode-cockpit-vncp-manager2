#!/bin/bash

# Quick Docker Detection Fix Script for VNCP Manager
echo "=== VNCP Manager Docker Detection Fix ==="
echo

# Function to check and fix common issues
fix_docker_detection() {
    echo "1. Checking Docker installation..."
    
    if ! command -v docker >/dev/null 2>&1; then
        echo "❌ Docker command not found. Please install Docker first:"
        echo "   curl -fsSL https://get.docker.com -o get-docker.sh"
        echo "   sudo sh get-docker.sh"
        return 1
    fi
    
    echo "✅ Docker command found"
    
    echo "2. Checking Docker service..."
    if ! systemctl is-active docker.service >/dev/null 2>&1; then
        echo "⚠️ Docker service not running. Starting it..."
        sudo systemctl start docker.service
        sudo systemctl enable docker.service
    fi
    
    if systemctl is-active docker.service >/dev/null 2>&1; then
        echo "✅ Docker service is running"
    else
        echo "❌ Failed to start Docker service"
        return 1
    fi
    
    echo "3. Checking Docker socket..."
    if [ -S "/var/run/docker.sock" ]; then
        echo "✅ Docker socket exists at /var/run/docker.sock"
    elif [ -S "/run/docker.sock" ]; then
        echo "✅ Docker socket exists at /run/docker.sock"
    else
        echo "❌ No Docker socket found. Docker may not be running properly."
        return 1
    fi
    
    echo "4. Checking systemd unit files..."
    unit_found=false
    for path in "/lib/systemd/system/docker.socket" "/usr/lib/systemd/system/docker.socket" "/lib/systemd/system/docker.service" "/usr/lib/systemd/system/docker.service"; do
        if [ -f "$path" ]; then
            echo "✅ Found systemd unit: $path"
            unit_found=true
            break
        fi
    done
    
    if [ "$unit_found" = false ]; then
        echo "❌ No Docker systemd units found. This may prevent VNCP Manager from appearing."
        echo "   Checking if Docker was installed properly with systemd integration..."
    fi
    
    echo "5. Testing Docker API..."
    if docker info >/dev/null 2>&1; then
        echo "✅ Docker API is responding"
    else
        echo "❌ Docker API not responding"
        return 1
    fi
    
    return 0
}

# Check current user permissions
echo "Checking user permissions..."
if groups | grep -q docker; then
    echo "✅ Current user is in docker group"
else
    echo "⚠️ Current user not in docker group. Adding to docker group..."
    sudo usermod -aG docker $USER
    echo "⚠️ Please log out and back in for group changes to take effect"
fi

# Run the fix
if fix_docker_detection; then
    echo
    echo "✅ Docker detection should now work!"
    echo
    echo "Next steps:"
    echo "1. Restart Cockpit: sudo systemctl restart cockpit"
    echo "2. Check VNCP Manager appears in Cockpit menu"
    echo "3. If issues persist, run the full diagnostic: ./test-vncp-detection.sh"
else
    echo
    echo "❌ Docker detection fix failed. Please run full diagnostic:"
    echo "   ./test-vncp-detection.sh"
fi

echo
echo "=== Quick Test ==="
echo "Current Docker status:"
echo "Service: $(systemctl is-active docker.service 2>/dev/null)"
echo "Socket exists: $([ -S /var/run/docker.sock ] && echo "yes" || echo "no")"
echo "API test: $(docker version --format '{{.Server.Version}}' 2>/dev/null || echo "failed")"