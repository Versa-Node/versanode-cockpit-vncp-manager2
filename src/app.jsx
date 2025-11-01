/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2017 Red Hat, Inc.
 *
 * Cockpit is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * Cockpit is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

import React from 'react';

import { Alert, AlertActionCloseButton, AlertGroup } from "@patternfly/react-core/dist/esm/components/Alert";
import { Button } from "@patternfly/react-core/dist/esm/components/Button";
import { EmptyState, EmptyStateFooter, EmptyStateActions, EmptyStateVariant } from "@patternfly/react-core/dist/esm/components/EmptyState";
import { Page, PageSection, } from "@patternfly/react-core/dist/esm/components/Page";
import { Stack } from "@patternfly/react-core/dist/esm/layouts/Stack";
import { ExclamationCircleIcon } from '@patternfly/react-icons';
import { WithDialogs } from "dialogs.jsx";

import cockpit from 'cockpit';
import { basename } from "cockpit-path";
import * as python from "python";
import { superuser } from "superuser";

import ContainerHeader from './ContainerHeader.jsx';
import Containers from './Containers.jsx';
import Images from './Images.jsx';
import * as client from './client.ts';
import detect_quadlets from './detect-quadlets.py';
import rest from './rest.ts';
import { makeKey, WithDockerInfo, debug } from './util.js';

const _ = cockpit.gettext;

// sort order of "users" state for dialogs: system, session user, then other users by ascending name
function compareUser(a, b) {
    if (a.uid === 0)
        return -1;
    if (b.uid === 0)
        return 1;
    if (a.uid === null)
        return -1;
    if (b.uid === null)
        return 1;
    return a.name.localeCompare(b.name);
}

class Application extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            serviceAvailable: null, // null = not checked yet, true/false = available or not
            images: null,
            containers: null,
            pods: null,
            quadletContainers: null,
            quadletPods: null,
            containersLoaded: false,
            imagesLoaded: false,
            containersFilter: "all",
            containersStats: {},
            textFilter: "",
            ownerFilter: "all",
            notifications: [],
            version: '1.3.0',
            selinuxAvailable: false,
            location: {},
            users: [{ uid: 0, name: _("system") }], // Simplified single-user array
        };
        this.onAddNotification = this.onAddNotification.bind(this);
        this.onDismissNotification = this.onDismissNotification.bind(this);
        this.onFilterChanged = this.onFilterChanged.bind(this);
        this.onOwnerChanged = this.onOwnerChanged.bind(this);
        this.onContainerFilterChanged = this.onContainerFilterChanged.bind(this);
        this.updateContainer = this.updateContainer.bind(this);
        this.goToServicePage = this.goToServicePage.bind(this);
        this.onNavigate = this.onNavigate.bind(this);

        this.pendingUpdateContainer = {}; // key (uid-id) → promise
    }

    onAddNotification(notification) {
        notification.index = this.state.notifications.length;

        this.setState(prevState => ({
            notifications: [
                ...prevState.notifications,
                notification
            ]
        }));
    }

    onDismissNotification(notificationIndex) {
        const notificationsArray = this.state.notifications.concat();
        const index = notificationsArray.findIndex(current => current.index == notificationIndex);

        if (index !== -1) {
            notificationsArray.splice(index, 1);
            this.setState({ notifications: notificationsArray });
        }
    }

    updateUrl(options) {
        cockpit.location.go([], options);
    }

    onFilterChanged(value) {
        this.setState({
            textFilter: value
        });

        const options = { ...this.state.location };
        if (value === "")
            delete options.name;
        else
            options.name = value;
        this.updateUrl(options);
    }

    onOwnerChanged(value) {
        this.setState({
            ownerFilter: value
        });

        const options = { ...this.state.location };
        if (value == "all")
            delete options.owner;
        else
            options.owner = value.toString();
        this.updateUrl(options);
    }

    onContainerFilterChanged(value) {
        this.setState({
            containersFilter: value
        });

        const options = { ...this.state.location };
        if (value == "running")
            delete options.container;
        else
            options.container = value;
        this.updateUrl(options);
    }

    updateState(state, key, newValue) {
        this.setState(prevState => {
            return {
                [state]: { ...prevState[state], [key]: newValue }
            };
        });
    }

    updateContainerStats() {
        // Container stats streaming disabled for simplified client architecture
        // Can be re-implemented later if needed per-container
        console.debug("Container stats streaming disabled for simplified architecture");
    }

    initContainers() {
        return client.getContainers()
                .then(containerList => Promise.all(
                    containerList.map(container => client.inspectContainer(container.Id))
                ))
                .then(containerDetails => {
                    const containers = {};
                    for (const detail of containerDetails) {
                        detail.key = detail.Id;
                        containers[detail.key] = detail;
                    }

                    this.setState({
                        containers,
                        containersLoaded: true
                    });
                    this.updateContainerStats();
                })
                .catch(e => console.warn("initContainers failed:", e.toString()));
    }

    updateImages() {
        client.getImages()
                .then(reply => {
                    const images = {};
                    Object.entries(reply).forEach(([Id, image]) => {
                        image.key = Id;
                        images[image.key] = image;
                    });

                    this.setState({
                        images,
                        imagesLoaded: true
                    });
                })
                .catch(ex => {
                    console.warn("Failed to update images:", JSON.stringify(ex));
                });
    }

    updateContainer(con, id, event) {
        /* when firing off multiple calls in parallel, docker can return them in a random order.
         * This messes up the state. So we need to serialize them for a particular container. */
        const key = makeKey(con.uid, id);
        const wait = this.pendingUpdateContainer[key] ?? Promise.resolve();

        const new_wait = wait.then(() => client.inspectContainer(id))
                .then(details => {
                    details.uid = con.uid;
                    details.key = key;
                    // HACK: during restart State never changes from "running"
                    //       override it to reconnect console after restart
                    if (event?.Action === "restart")
                        details.State.Status = "restarting";
                    this.updateState("containers", key, details);
                })
                .catch(e => console.warn("updateContainer uid", con.uid, "inspectContainer failed:", e.toString()));
        this.pendingUpdateContainer[key] = new_wait;
        new_wait.finally(() => { delete this.pendingUpdateContainer[key] });

        return new_wait;
    }

    updateImage(con, id) {
        client.getImages(id)
                .then(reply => {
                    const image = reply[id];
                    image.uid = con.uid;
                    image.key = makeKey(con.uid, id);
                    this.updateState("images", image.key, image);
                })
                .catch(ex => {
                    console.warn("Failed to do updateImage for uid", con.uid, ":", JSON.stringify(ex));
                });
    }

    // see https://docs.docker.io/en/latest/markdown/docker-events.1.html

    handleImageEvent(event, con) {
        switch (event.Action) {
        case 'push':
        case 'save':
        case 'tag':
            this.updateImage(con, event.Actor.ID);
            break;
        case 'pull': // Pull event has not event.id
        case 'untag':
        case 'remove':
        case 'prune':
        case 'build':
            this.updateImages(con);
            break;
        default:
            console.warn('Unhandled event type ', event.Type, event.Action);
        }
    }

    handleContainerEvent(event, con) {
        const id = event.Actor.ID;

        switch (event.Action) {
        /* The following events do not need to trigger any state updates */
        case 'attach':
        case 'exec':
        case 'export':
        case 'import':
        case 'init':
        case 'kill':
        case 'mount':
        case 'prune':
        case 'restart':
        case 'sync':
        case 'unmount':
        case 'wait':
            break;
        /* The following events need only to update the Container list
         * We do get the container affected in the event object but for
         * now we 'll do a batch update
         */
        case 'start':
            // HACK: We don't get 'started' event for pods got started by the first container which was added to them
            // https://github.com/containers/docker/issues/7213
            (event.Actor.Attributes.podId
                ? this.updatePod(con, event.Actor.Attributes.podId)
                : this.updatePods(con)
            ).then(() => this.updateContainer(con, id, event));
            break;
        case 'checkpoint':
        case 'cleanup':
        case 'create':
        case 'died':
        case 'exec_died': // HACK: pick up health check runs with older docker versions, see https://github.com/containers/docker/issues/19237
        case 'health_status':
        case 'pause':
        case 'restore':
        case 'stop':
        case 'unpause':
        case 'rename': // rename event is available starting docker v4.1; until then the container does not get refreshed after renaming
            this.updateContainer(con, id, event);
            break;

        case 'remove':
            this.setState(prevState => {
                const containers = { ...prevState.containers };
                delete containers[makeKey(con.uid, id)];
                let pods;

                if (event.Actor.Attributes.podId) {
                    const podKey = makeKey(con.uid, event.Actor.Attributes.podId);
                    const newPod = { ...prevState.pods[podKey] };
                    newPod.Containers = newPod.Containers.filter(container => container.Id !== id);
                    pods = { ...prevState.pods, [podKey]: newPod };
                } else {
                    // HACK: with docker < 4.3.0 we don't get a pod event when a container in a pod is removed
                    // https://github.com/containers/docker/issues/15408
                    pods = prevState.pods;
                    this.updatePods(con);
                }

                return { containers, pods };
            });
            break;

        // only needs to update the Image list, this ought to be an image event
        case 'commit':
            this.updateImages(con);
            break;
        default:
            console.warn('Unhandled event type ', event.Type, event.Action);
        }
    }

    handlePodEvent(event, con) {
        switch (event.Action) {
        case 'create':
        case 'kill':
        case 'pause':
        case 'start':
        case 'stop':
        case 'unpause':
            this.updatePod(con, event.Actor.ID);
            break;
        case 'remove':
            this.setState(prevState => {
                const pods = { ...prevState.pods };
                delete pods[makeKey(con.uid, event.Actor.ID)];
                return { pods };
            });
            break;
        default:
            console.warn('Unhandled event type ', event.Type, event.Action);
        }
    }

    handleEvent(event, con) {
        switch (event.Type) {
        case 'container':
            this.handleContainerEvent(event, con);
            break;
        case 'image':
            this.handleImageEvent(event, con);
            break;
        case 'pod':
            this.handlePodEvent(event, con);
            break;
        default:
            console.warn('Unhandled event type ', event.Type);
        }
    }

    cleanupAfterService(con) {
        debug("cleanupAfterService", con.uid, "current owner filter:", this.state.ownerFilter);
        ["images", "containers", "pods"].forEach(t => {
            if (this.state[t])
                this.setState(prevState => {
                    const copy = {};
                    Object.entries(prevState[t] || {}).forEach(([id, v]) => {
                        if (v.uid !== con.uid)
                            copy[id] = v;
                    });
                    return { [t]: copy };
                });
        });

        // keep dummy (null) connections from other users, only remove valid ones
        this.setState(prevState => ({ users: prevState.users.filter(u => u.con === null || u.uid !== con.uid) }));

        // reset owner filter if the current filter is the closed connection
        if (con.uid == this.state.ownerFilter)
            this.onOwnerChanged("all");
    }

    // Read information about quadlets from /run/ until docker provides a remote API for this.
    // https://github.com/containers/docker/issues/27119
    // Required for cockpit-docker to show inactive quadlets which have no
    // stopped container/pod associated with them as they are ephemeral.
    // The state object of the container or pod has just enough properties to mock a real inactive container or pod.
    async initQuadlets(con) {
        let path = "/run/systemd/generator";
        let quadlets = { pods: {}, containers: {} };

        if (con.uid === null) {
            path = sessionStorage.getItem('XDG_RUNTIME_DIR') + '/systemd/generator';
        } else if (con.uid !== 0) {
            // TODO: support loading other users quadlets
            debug(`unsupported connection ${con.uid} for loading quadlets`);
            this.setState(prevState => {
                const users = prevState.users.map(u => u.uid === con.uid ? { ...u, quadletsLoaded: true } : u);
                return { users };
            });
            return;
        }

        try {
            const quadlets_str = await python.spawn(detect_quadlets, [path]);
            quadlets = JSON.parse(quadlets_str);
        } catch (exc) {
            console.warn(`error during discovering of quadlets for ${con.uid}`, exc);
            this.setState(prevState => {
                const users = prevState.users.map(u => u.uid === con.uid ? { ...u, quadletsLoaded: true } : u);
                return { users };
            });
            return;
        }

        // { id-service_name: { } }
        this.setState(prevState => {
            const podNameServiceMap = {};

            const copyQuadletPods = {};
            // keep/copy the pods of other users
            Object.entries(prevState.quadletPods || {}).forEach(([id, container]) => {
                if (container.uid !== con.uid)
                    copyQuadletPods[id] = container;
            });

            for (const key of Object.keys(quadlets.pods)) {
                const quadlet_pod = quadlets.pods[key];
                const container_key = makeKey(con.uid, key);

                const pod = {
                    uid: con.uid,
                    key: container_key,
                    Id: container_key,
                    Status: "Exited",
                    Name: quadlet_pod.name,
                    Labels: {
                        PODMAN_SYSTEMD_UNIT: key,
                    }
                };
                copyQuadletPods[pod.key] = pod;

                // The key is the service name, but that isn't used in reference
                podNameServiceMap[basename(quadlet_pod.source_path)] = key;
            }

            const copyQuadletContainers = {};
            // keep/copy the containers of other users
            Object.entries(prevState.quadletContainers || {}).forEach(([id, container]) => {
                if (container.uid !== con.uid)
                    copyQuadletContainers[id] = container;
            });

            for (const key of Object.keys(quadlets.containers)) {
                const quadlet = quadlets.containers[key];
                const container_key = makeKey(con.uid, key);

                // Mock docker container state
                const container = {
                    uid: con.uid,
                    key: container_key,
                    Id: key,
                    IsService: false,
                    IsInfra: false,
                    Name: quadlet.name,
                    ImageName: quadlet.image,
                    NetworkSettings: {
                        Ports: [],
                    },
                    Mounts: [],
                    Config: {
                        Labels: {
                            PODMAN_SYSTEMD_UNIT: key,
                        },
                    },
                    State: {
                        Status: 'exited'
                    }
                };

                const found_pod = podNameServiceMap[quadlet.pod];
                if (found_pod) {
                    container.Pod = found_pod;
                }
                copyQuadletContainers[container.key] = container;
            }

            const users = prevState.users.map(u => u.uid === con.uid ? { ...u, quadletsLoaded: true } : u);
            return { quadletContainers: copyQuadletContainers, quadletPods: copyQuadletPods, users };
        });
    }

    async subscribeDaemonReload(con) {
        // We don't support subscribing on reload events for "other" users.
        if (con.uid !== 0 && con.uid !== null) {
            return;
        }

        debug('subscribe daemon reload', con);

        const options = con.uid === 0 ? { bus: "system", superuser: "try" } : { bus: "session" };
        const subscribe = (client) => {
            const subscription = client.subscribe({ interface: "org.freedesktop.systemd1.Manager", member: "Reloading" }, (_path, _iface, _signal, [reloading]) => {
                if (!reloading)
                    this.initQuadlets(con);
            });

            this.setState(prevState => {
                const users = prevState.users.map(u => u.uid === con.uid ? { ...u, dbus: { client, subscription } } : u);
                return { users };
            });
        };

        let client = null;
        const user = this.state.users.find(u => u.uid === con.uid);

        // don't add multiple Reload subscriptions
        if (user?.dbus?.subscription) {
            return;
        }

        if (user?.dbus) {
            client = user.dbus.client;
        } else {
            client = cockpit.dbus("org.freedesktop.systemd1", options);
        }

        client.call("/org/freedesktop/systemd1", "org.freedesktop.systemd1.Manager", "Subscribe", []).then(() => {
            subscribe(client);
        })
                .catch(err => {
                    if (err.name === "org.freedesktop.systemd1.AlreadySubscribed") {
                        subscribe(client);
                    } else {
                        client.close();
                        console.error(`Cannot subscribe systemd reload event for ${con.uid}`);
                    }
                });
    }

    async init() {
        console.debug("Initializing Docker connection...");
        
        try {
            // Simple connection test like working repository
            const reply = await client.getInfo();
            console.debug("Docker connection successful");
            
            this.setState({
                serviceAvailable: true,
                version: reply.version?.Version || reply.ServerVersion,
                registries: reply.registries || reply.RegistryConfig?.IndexConfigs,
                cgroupVersion: reply.host?.cgroupVersion || reply.CgroupVersion,
            });
            
            this.updateImages();
            this.initContainers();
            
            // Start event streaming
            client.streamEvents(message => this.handleEvent(message))
                    .catch(e => console.error("streamEvents failed:", JSON.stringify(e)))
                    .finally(() => {
                        console.log("Docker service connection closed");
                        this.setState({ serviceAvailable: false });
                    });
        } catch (err) {
            console.warn("Docker connection failed:", err.toString());
            this.setState({ serviceAvailable: false });
        }
    }

    componentDidMount() {
        // Simple initialization like working repository
        this.init();

        cockpit.spawn("selinuxenabled", { error: "ignore" })
                .then(() => this.setState({ selinuxAvailable: true }))
                .catch(() => this.setState({ selinuxAvailable: false }));

        cockpit.addEventListener("locationchanged", this.onNavigate);
        this.onNavigate();
    }

    componentWillUnmount() {
        cockpit.removeEventListener("locationchanged", this.onNavigate);
        // Simplified architecture - no multi-user cleanup needed
    }

    onNavigate() {
        // Simplified navigation for single-user architecture
        const { options, path } = cockpit.location;
        this.setState({ location: options }, () => {
            // only use the root path
            if (path.length === 0) {
                if (options.name) {
                    this.onFilterChanged(options.name);
                }
                if (options.container) {
                    this.onContainerFilterChanged(options.container);
                }
                // Simplified owner filter - just update state without complex user management
                this.setState({
                    ownerFilter: options.owner || "all"
                });
            }
        });
    }

    async checkUserRestartService() {
        const out = await cockpit.spawn(
            ["systemctl", "--user", "show", "--value", "-p", "LoadState", "docker-restart"],
            { environ: ["LC_ALL=C"], error: "ignore" });
        this.setState({ userDockerRestartAvailable: out.trim() === "loaded" });
    }

    startService(e) {
        if (!e || e.button !== 0)
            return;

        // Simple docker.socket startup like working repository
        cockpit.spawn(["systemctl", "start", "docker.socket"], { superuser: "require", err: "message" })
                .then(() => {
                    console.debug("Successfully started docker.socket");
                    // Reinitialize connections after starting service
                    this.init(0, _("system"));
                })
                .catch(err => {
                    console.warn("Failed to start docker.socket:", JSON.stringify(err));
                    this.onAddNotification({ type: 'danger', error: _("Failed to start Docker service"), errorDetail: err.message });
                });
    }

    goToServicePage(e) {
        if (!e || e.button !== 0)
            return;
        cockpit.jump("/system/services#/docker.socket");
    }

    render() {
        // Show start screen if Docker service is not available
        if (this.state.serviceAvailable === false) {
            return (
                <Page className="pf-m-no-sidebar">
                    <PageSection hasBodyWrapper={false}>
                        <EmptyState headingLevel="h2" icon={ExclamationCircleIcon} titleText={_("Docker service is not active")} variant={EmptyStateVariant.full}>
                            <EmptyStateFooter>
                                <Button variant="primary" onClick={this.startService}>
                                    {_("Start docker")}
                                </Button>
                                <EmptyStateActions>
                                    <Button variant="link" onClick={this.goToServicePage}>
                                        {_("Troubleshoot")}
                                    </Button>
                                </EmptyStateActions>
                            </EmptyStateFooter>
                        </EmptyState>
                    </PageSection>
                </Page>
            );
        }

        // Show loading while checking Docker availability
        if (this.state.serviceAvailable === null)
            return null;

        let imageContainerList = {};
        if (this.state.containers !== null) {
            Object.keys(this.state.containers).forEach(c => {
                const container = this.state.containers[c];
                const imageKey = container.Image;
                if (!imageContainerList[imageKey])
                    imageContainerList[imageKey] = [];
                imageContainerList[imageKey].push({
                    container,
                    stats: this.state.containersStats[container.Id],
                });
            });
        } else
            imageContainerList = null;

        const imageList = (
            <Images
                key="imageList"
                images={this.state.imagesLoaded ? this.state.images : null}
                imageContainerList={imageContainerList}
                onAddNotification={this.onAddNotification}
                textFilter={this.state.textFilter}
                ownerFilter={this.state.ownerFilter}
                showAll={ () => this.setState({ containersFilter: "all" }) }
                users={this.state.users}
            />
        );
        const containerList = (
            <Containers
                key="containerList"
                version={this.state.version}
                images={this.state.imagesLoaded ? this.state.images : null}
                containers={this.state.containersLoaded ? this.state.containers : null}
                pods={this.state.pods}
                containersStats={this.state.containersStats}
                filter={this.state.containersFilter}
                handleFilterChange={this.onContainerFilterChanged}
                textFilter={this.state.textFilter}
                ownerFilter={this.state.ownerFilter}
                users={this.state.users}
                onAddNotification={this.onAddNotification}
                cgroupVersion={this.state.cgroupVersion}
                updateContainer={this.updateContainer}
                quadletContainers={this.state.quadletContainers}
                quadletPods={this.state.quadletPods}
            />
        );

        const notificationList = (
            <AlertGroup isToast>
                {this.state.notifications.map((notification, index) => {
                    return (
                        <Alert key={index} title={notification.error} variant={notification.type}
                               isLiveRegion
                               actionClose={<AlertActionCloseButton onClose={() => this.onDismissNotification(notification.index)} />}>
                            {notification.errorDetail}
                        </Alert>
                    );
                })}
            </AlertGroup>
        );

        const contextInfo = {
            cgroupVersion: this.state.cgroupVersion,
            registries: this.state.registries,
            selinuxAvailable: this.state.selinuxAvailable,
            userDockerRestartAvailable: this.state.userDockerRestartAvailable,
            userLingeringEnabled: this.state.userLingeringEnabled,
            version: this.state.version,
        };

        return (
            <WithDockerInfo value={contextInfo}>
                <WithDialogs>
                    <Page id="overview" key="overview" className="pf-m-no-sidebar">
                        {notificationList}
                        <PageSection hasBodyWrapper={false} className="content-filter"
                        >
                            <ContainerHeader
                              handleFilterChanged={this.onFilterChanged}
                              handleOwnerChanged={this.onOwnerChanged}
                              ownerFilter={this.state.ownerFilter}
                              textFilter={this.state.textFilter}
                              users={this.state.users}
                            />
                        </PageSection>
                        <PageSection hasBodyWrapper={false} className='ct-pagesection-mobile'>
                            <Stack hasGutter>
                                {imageList}
                                {containerList}
                            </Stack>
                        </PageSection>
                    </Page>
                </WithDialogs>
            </WithDockerInfo>
        );
    }
}

export default Application;
