# VNCP Manager - Docker Version

This is a Docker-focused version of the Cockpit container management interface, converted from the original Podman-based cockpit-podman project.

## Quick Build & Install

### For Linux/macOS users:
```bash
# Make the build script executable and run it
chmod +x build-docker.sh
./build-docker.sh

# Install locally for development
mkdir -p ~/.local/share/cockpit
cp -r dist ~/.local/share/cockpit/'VNCP Manager'
```

### For Windows users:
```powershell
# Install dependencies and build
npm install
node build.js

# Install locally for development
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.local\share\cockpit"
Copy-Item -Recurse -Force "dist" "$env:USERPROFILE\.local\share\cockpit\VNCP Manager"
```

## What's Different from Podman Version

- **Pod Support Removed**: Docker doesn't have pods like Podman/Kubernetes, so pod-related functionality has been stubbed out
- **Docker-focused Styling**: Uses `docker.scss` instead of `podman.scss`
- **Simplified Build**: No complex submodule dependencies for development

## Development Workflow

1. Make changes to files in `src/`
2. Run `node build.js` to rebuild
3. Copy `dist/` contents to your Cockpit plugin directory
4. Refresh your Cockpit interface

## Build Requirements

- Node.js (v16 or later)
- npm
- Git (for fetching build dependencies)

## Original Project

This is based on [cockpit-podman](https://github.com/cockpit-project/cockpit-podman) but converted for Docker use.

## License

LGPL-2.1 (same as original cockpit-podman)