# VNCP Manager - Usage Guide

This guide explains how to use the enhanced VNCP (VersaNode Control Panel) Manager with GitHub Container Registry integration.

## Features Added

### 1. GitHub Container Registry (GHCR) Integration

The VNCP Manager now integrates directly with GitHub's Container Registry for the `versa-node` organization:

- **Organization Package Scanning**: Automatically discovers all container packages in the `ghcr.io/versa-node/` namespace
- **Tag Discovery**: Fetches available tags for each package via GitHub API
- **README Support**: Extracts README content from container labels or filesystem
- **Smart Caching**: In-memory caching with 5-15 minute refresh intervals to avoid API rate limits

### 2. Enhanced Image Search

When searching for images, the system now:

- **Auto-includes GHCR packages** when searching broadly or for versa-node related terms
- **Filters by search terms** across package names and descriptions
- **Marks GHCR packages** with special indicators in the UI
- **Falls back gracefully** if GHCR API is unavailable

### 3. Markdown README Rendering

The `MarkdownViewer` component (using react-markdown) provides:

- **Full markdown parsing** with GitHub Flavored Markdown (GFM) support
- **Code syntax highlighting** using highlight.js with GitHub theme
- **Table support** with PatternFly styling integration
- **Task lists, links, and formatting** with proper accessibility
- **Secure link handling** with target="_blank" and security attributes

## Authentication Setup

### GitHub Token (Optional but Recommended)

For enhanced functionality and higher rate limits, create a GitHub token:

1. Go to GitHub Settings → Developer settings → Personal access tokens
2. Create a token with `read:packages` scope
3. Save the token to `/etc/versanode/github.token` (readable by root only)

```bash
sudo mkdir -p /etc/versanode
echo "your_github_token_here" | sudo tee /etc/versanode/github.token
sudo chmod 600 /etc/versanode/github.token
sudo chown root:root /etc/versanode/github.token
```

Without a token, the system uses anonymous API access with lower rate limits.

## Usage Examples

### Searching for VersaNode Packages

1. **Open VNCP Manager** in Cockpit
2. **Click "Pull Image"** to open the search modal
3. **Search for versa-node packages**:
   - Search term: `versa-node` → Shows all versa-node organization packages
   - Search term: `vncp` → Shows packages matching "vncp" in name or description
   - Search term: `ghcr.io` → Includes GHCR packages in results
   
### Viewing Package Documentation

When browsing container images or pulling packages:

1. **README content** is automatically fetched from container labels
2. **Markdown rendering** shows formatted documentation
3. **Table of contents** helps navigate long README files
4. **Code examples** can be copied directly to clipboard

### Package Discovery

The system automatically discovers packages from:

- **Container labels**: `org.opencontainers.image.documentation.readme` (base64 encoded)
- **VersaNode labels**: `versanode.readme` (base64 encoded)
- **Container filesystem**: `/README.md`, `/readme.md`, `/README`, etc.

## Technical Implementation

### API Integration

- **GitHub Packages API**: Fetches organization packages and versions
- **Shell scripting**: Uses `curl` via `cockpit.spawn()` for secure API calls
- **Error handling**: Graceful degradation when API is unavailable
- **Caching**: Intelligent cache management to reduce API calls

### Security Considerations

- **Token security**: GitHub tokens stored with restricted permissions
- **Privilege escalation**: Uses `superuser: "require"` for protected file access
- **Input sanitization**: Proper escaping in shell scripts
- **Error boundaries**: Comprehensive error handling and logging

### Performance Features

- **Concurrent searches**: Parallel execution of Docker API and GHCR API
- **Smart caching**: Reduces API calls while keeping data fresh
- **Incremental loading**: Fast initial results, enhanced with GHCR data
- **Timeout handling**: Prevents hanging operations

## Troubleshooting

### Common Issues

1. **No GHCR packages appear**:
   - Check network connectivity
   - Verify GitHub API rate limits
   - Check console for error messages

2. **API rate limiting**:
   - Set up GitHub token authentication
   - Rate limits reset hourly for authenticated users

3. **README not loading**:
   - Ensure container has proper labels
   - Check if README files exist in container
   - Verify base64 encoding in labels

### Debug Information

Enable debug logging in browser console to see:
- GHCR API calls and responses
- Cache hit/miss information
- Package discovery details
- README extraction process

## Integration Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  Cockpit UI     │◄──►│  VNCP Manager    │◄──►│  Docker Engine  │
│                 │    │                  │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │
                                ▼
                       ┌──────────────────┐
                       │  GitHub API      │
                       │  (GHCR Registry) │
                       └──────────────────┘
```

The VNCP Manager acts as a bridge between the Cockpit interface, local Docker engine, and GitHub's container registry, providing a unified experience for VersaNode package management.