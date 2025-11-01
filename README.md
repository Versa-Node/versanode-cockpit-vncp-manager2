# VNCP Manager (VersaNode Container Platform)

This is the [Cockpit](https://cockpit-project.org/) user interface for [Docker
containers](https://docker.io/) with enhanced features for VersaNode container management.

**Note:** This project is a modified version of [cockpit-podman](https://github.com/cockpit-project/cockpit-podman), adapted to work with Docker and enhanced with GHCR (GitHub Container Registry) integration and VersaNode-specific features.

## Features

- Docker container management through Cockpit web interface
- GitHub Container Registry (GHCR) integration for VersaNode organization
- Enhanced image search and repository browsing
- Markdown README viewing for container images
- Container lifecycle management (create, start, stop, delete)
- Image management and deployment

## Technologies

 - VNCP Manager communicates to Docker through its [REST API](https://docs.docker.com/engine/api/).

 - This project is based on the [Cockpit Starter Kit](https://github.com/cockpit-project/starter-kit).
   See [Starter Kit Intro](http://cockpit-project.org/blog/cockpit-starter-kit.html) for details.

# Development dependencies

On Debian/Ubuntu:

    $ sudo apt install gettext nodejs make

On Fedora:

    $ sudo dnf install gettext nodejs make

# Getting and building the source

These commands check out the source and build it into the `dist/` directory:

```
git clone https://github.com/Versa-Node/versanode-cockpit-vncp-manager2
cd versanode-cockpit-vncp-manager2
make
```

# Installing

`sudo make install` installs the package in `/usr/local/share/cockpit/`. This depends
on the `dist` target, which generates the distribution tarball.

You can also run `make rpm` to build RPMs for local installation.

In `production` mode, source files are automatically minified and compressed.
Set `NODE_ENV=production` if you want to duplicate this behavior.

# Development instructions

See [HACKING.md](./HACKING.md) for details about how to efficiently change the
code, run, and test it.

# Automated release

The intention is that the only manual step for releasing a project is to create
a signed tag for the version number, which includes a summary of the noteworthy
changes:

```
123

- this new feature
- fix bug #123
```

Pushing the release tag triggers the [release.yml](.github/workflows/release.yml)
[GitHub action](https://github.com/features/actions) workflow. This creates the
official release tarball and publishes as upstream release to GitHub.

The Fedora and COPR releases are done with [Packit](https://packit.dev/),
see the [packit.yaml](./packit.yaml) control file.

# Automated maintenance

It is important to keep your [NPM modules](./package.json) up to date, to keep
up with security updates and bug fixes. This happens with
[dependabot](https://github.com/dependabot),
see [configuration file](.github/dependabot.yml).

Translations are refreshed every Tuesday evening (or manually) through the
[weblate-sync-po.yml](.github/workflows/weblate-sync-po.yml) action.
Conversely, the PO template is uploaded to weblate every day through the
[weblate-sync-pot.yml](.github/workflows/weblate-sync-pot.yml) action.

# Attribution

This project is based on [cockpit-podman](https://github.com/cockpit-project/cockpit-podman) from the Cockpit Project.

Original cockpit-podman:
- **Repository:** https://github.com/cockpit-project/cockpit-podman
- **License:** LGPL-2.1
- **Copyright:** Red Hat, Inc.

## Modifications for VNCP Manager

This version has been modified and enhanced with:
- Docker API integration (replacing Podman)
- GitHub Container Registry (GHCR) support
- VersaNode organization integration
- Enhanced image search and management
- Markdown README viewing for container images
- Removed Pod functionality to focus on container management

We thank the Cockpit Project team for their excellent foundation that made this project possible.
