import type { JsonObject, JsonValue } from "cockpit";

import type { Connection, MonitorCallback } from "./rest.ts";

// docker API version; oldest one that we support
export const VERSION = "/v3.4.0/";

const dockerCall = (con: Connection, name: string, method: string, args: JsonObject, body?: string):
                   Promise<string> =>
    con.call({ method, path: VERSION + name, body: body || "", params: args, });

const dockerJson = (con: Connection, name: string, method: string, args: JsonObject, body?: string):
                   Promise<JsonObject|JsonValue> =>
    dockerCall(con, name, method, args, body)
            .then(reply => JSON.parse(reply));

export const streamEvents = (con: Connection, callback: MonitorCallback) =>
    con.monitor(VERSION + "libpod/events", callback);

export function getInfo(con: Connection): Promise<JsonObject> {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("timeout")), 10000);
        dockerJson(con, "libpod/info", "GET", {})
                .then(reply => resolve(reply as JsonObject)) // docker API, we know it's an object
                .catch(reject)
                .finally(() => clearTimeout(timeout));
    });
}

export const getContainers = (con: Connection) => dockerJson(con, "libpod/containers/json", "GET", { all: true });

export const streamContainerStats = (con: Connection, callback: MonitorCallback) =>
    con.monitor(VERSION + "libpod/containers/stats", callback);

export function inspectContainer(con: Connection, id: string) {
    const options = {
        size: false // set true to display filesystem usage
    };
    return dockerJson(con, "libpod/containers/" + id + "/json", "GET", options);
}

export const delContainer = (con: Connection, id: string, force: boolean) => dockerCall(con, "libpod/containers/" + id, "DELETE", { force });

export const renameContainer = (con: Connection, id: string, config: JsonObject) => dockerCall(con, "libpod/containers/" + id + "/rename", "POST", config);

export const createContainer = (con: Connection, config: JsonObject) => dockerJson(con, "libpod/containers/create", "POST", {}, JSON.stringify(config));

export const commitContainer = (con: Connection, commitData: JsonObject) => dockerCall(con, "libpod/commit", "POST", commitData);

export const postContainer = (con: Connection, action: string, id: string, args: JsonObject) => dockerCall(con, "libpod/containers/" + id + "/" + action, "POST", args);

export const runHealthcheck = (con: Connection, id: string) => dockerCall(con, "libpod/containers/" + id + "/healthcheck", "GET", {});

export const postPod = (con: Connection, action: string, id: string, args: JsonObject) => dockerCall(con, "libpod/pods/" + id + "/" + action, "POST", args);

export const delPod = (con: Connection, id: string, force: boolean) => dockerCall(con, "libpod/pods/" + id, "DELETE", { force });

export const createPod = (con: Connection, config: JsonObject) => dockerCall(con, "libpod/pods/create", "POST", {}, JSON.stringify(config));

export function execContainer(con: Connection, id: string) {
    const args = {
        AttachStderr: true,
        AttachStdout: true,
        AttachStdin: true,
        Tty: true,
        Cmd: ["/bin/sh"],
    };

    return dockerJson(con, "libpod/containers/" + id + "/exec", "POST", {}, JSON.stringify(args));
}

export function resizeContainersTTY(con: Connection, id: string, exec: boolean, width: number, height: number) {
    const args = {
        h: height,
        w: width,
    };

    let point = "containers/";
    if (!exec)
        point = "exec/";

    return dockerCall(con, "libpod/" + point + id + "/resize", "POST", args);
}

function parseImageInfo(info: JsonObject): JsonObject {
    const image: JsonObject = {};

    if (info.Config) {
        const config = info.Config as JsonObject;
        image.Entrypoint = config.Entrypoint;
        image.Command = config.Cmd;
        image.Ports = Object.keys((config.ExposedPorts as JsonObject) || {});
        image.Env = config.Env || [];
    }
    image.Author = info.Author;

    return image;
}

export function getImages(con: Connection, id?: string) {
    const options: JsonObject = {};
    if (id)
        options.filters = JSON.stringify({ id: [id] });
    return dockerJson(con, "libpod/images/json", "GET", options)
            .then(reply => {
                const images: JsonObject = {};
                const promises: Promise<JsonObject|JsonValue>[] = [];

                for (const image of reply as JsonObject[]) {
                    images[image.Id as string] = image;
                    promises.push(dockerJson(con, "libpod/images/" + image.Id + "/json", "GET", {}));
                }

                return Promise.all(promises)
                        .then(replies => {
                            for (const info of replies as JsonObject[]) {
                                const imageId = info.Id as string;
                                const existingImage = images[imageId] as JsonObject || {};
                                images[imageId] = { uid: con.uid, ...existingImage, ...parseImageInfo(info) };
                            }
                            return images;
                        });
            });
}

export function getPods(con: Connection, id?: string) {
    const options: JsonObject = {};
    if (id)
        options.filters = JSON.stringify({ id: [id] });
    return dockerJson(con, "libpod/pods/json", "GET", options);
}

export const delImage = (con: Connection, id: string, force: boolean) => dockerJson(con, "libpod/images/" + id, "DELETE", { force });

export const untagImage = (con: Connection, id: string, repo: string, tag: string) => dockerCall(con, "libpod/images/" + id + "/untag", "POST", { repo, tag });

export function pullImage(con: Connection, reference: string) {
    return new Promise<void>((resolve, reject) => {
        dockerCall(con, "libpod/images/pull", "POST", { reference })
                .then(r => {
                    // Need to check the last response if it contains error
                    const responses = r.trim().split("\n");
                    const response = JSON.parse(responses[responses.length - 1]);
                    if (response.error) {
                        response.message = response.error;
                        reject(response);
                    } else if (response.cause) // present for 400 and 500 errors
                        reject(response);
                    else
                        resolve();
                })
                .catch(reject);
    });
}

export const pruneUnusedImages = (con: Connection) => dockerJson(con, "libpod/images/prune?all=true", "POST", {});

export const imageHistory = (con: Connection, id: string) => dockerJson(con, `libpod/images/${id}/history`, "GET", {});

export const imageExists = (con: Connection, id: string) => dockerCall(con, "libpod/images/" + id + "/exists", "GET", {});

export const containerExists = (con: Connection, id: string) => dockerCall(con, "libpod/containers/" + id + "/exists", "GET", {});
