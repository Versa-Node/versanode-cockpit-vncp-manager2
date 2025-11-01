// client.js
import rest from './rest.js';

const DOCKER_ADDRESS = "/var/run/docker.sock";
export const VERSION = "/v1.43";

export function listNetworks(filtersObj = null) {
  const params = {};
  if (filtersObj) params.filters = JSON.stringify(filtersObj);
  return dockerJson("/networks", "GET", params);
}

export function inspectNetwork(nameOrId) {
  return dockerJson("/networks/" + encodeURIComponent(nameOrId), "GET", {});
}

export function createNetwork(name, driver = "bridge") {
  const body = {
    Name: name,
    Driver: driver,
    CheckDuplicate: true,
    Internal: false,
    Attachable: true,
  };
  return dockerJson("/networks/create", "POST", {}, JSON.stringify(body));
}

export async function ensureNetwork(name) {
  try {
    await inspectNetwork(name);
    return; // exists
  } catch (e) {
    const msg = (e && (e.message || e.reason)) ? String(e.message || e.reason) : "";
    const isNotFound = /404|not\s*found/i.test(msg);
    if (!isNotFound) throw e;
  }
  await createNetwork(name, "bridge");
}

export function getAddress() {
  return DOCKER_ADDRESS;
}

function dockerCall(name, method, args, body) {
  const options = {
    method,
    path: VERSION + name,
    body: body || "",
    params: args,
  };

  if (method === "POST" && body)
    options.headers = { "Content-Type": "application/json" };

  return rest.call(getAddress(), options);
}

const dockerJson = (name, method, args, body) =>
  dockerCall(name, method, args, body).then(reply => JSON.parse(reply));

function dockerMonitor(name, method, args, callback) {
  const options = {
    method,
    path: VERSION + name,
    body: "",
    params: args,
  };

  const connection = rest.connect(getAddress());
  return connection.monitor(options, callback);
}

export const streamEvents = (callback) => dockerMonitor("/events", "GET", {}, callback);

export function getInfo() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("timeout")), 15000);
    dockerJson("/info", "GET", {})
      .then(reply => resolve(reply))
      .catch(reject)
      .finally(() => clearTimeout(timeout));
  });
}

export const getContainers = () => dockerJson("/containers/json", "GET", { all: true });

export const streamContainerStats = (id, callback) =>
  dockerMonitor("/containers/" + id + "/stats", "GET", { stream: true }, callback);

export function inspectContainer(id) {
  const options = {
    size: false // set true to display filesystem usage
  };
  return dockerJson("/containers/" + encodeURIComponent(id) + "/json", "GET", options); // FIX: encode
}

/** Inspect an image by ID or reference (e.g. repo:tag).
 *  UI uses this during prefill to read labels (including README path).
 */
export function inspectImage(ref) {
  return dockerJson("/images/" + encodeURIComponent(ref) + "/json", "GET", {});
}

export const delContainer = (id, force) => dockerCall("/containers/" + encodeURIComponent(id), "DELETE", { force });

// FIX: Docker expects ?name=newName as query param (no JSON body)
export const renameContainer = (id, newName) =>
  dockerCall("/containers/" + encodeURIComponent(id) + "/rename", "POST", { name: newName });

// FIX: name must be in query string; remove from JSON body
export const createContainer = (config) => {
  const params = {};
  const body = { ...config };
  if (body && body.name) {
    params.name = body.name;
    delete body.name;
  }
  return dockerJson("/containers/create", "POST", params, JSON.stringify(body));
};

export const commitContainer = (commitData) => dockerCall("/commit", "POST", commitData);

export const postContainer = (action, id, args) =>
  dockerCall("/containers/" + encodeURIComponent(id) + "/" + action, "POST", args);

export function execContainer(id) {
  const args = {
    AttachStderr: true,
    AttachStdout: true,
    AttachStdin: true,
    Tty: true,
    Cmd: ["/bin/sh"],
  };

  return dockerJson("/containers/" + encodeURIComponent(id) + "/exec", "POST", {}, JSON.stringify(args));
}

export function resizeContainersTTY(id, exec, width, height) {
  const args = {
    h: height,
    w: width,
  };

  let point = "containers/";
  if (!exec)
    point = "exec/";

  return dockerCall("/" + point + encodeURIComponent(id) + "/resize", "POST", args);
}

function parseImageInfo(info) {
  const image = {};

  // Prefer Config.*; fall back to ContainerConfig for ExposedPorts
  const cfg = info?.Config || {};
  const containerCfg = info?.ContainerConfig || {};

  if (cfg) {
    image.Entrypoint = cfg.Entrypoint;
    image.Command = cfg.Cmd;
    image.Env = cfg.Env;

    const exposed = cfg.ExposedPorts || containerCfg.ExposedPorts || {};
    image.ExposedPorts = exposed || {};
    image.Ports = Object.keys(exposed || {}); // backward-compat: array of "port/proto"

    image.Volumes = cfg.Volumes || {};
  }

  image.Author = info.Author;

  return image;
}

export function getImages(id) {
  const options = {};
  if (id)
    options.filters = JSON.stringify({ id: [id] });

  return dockerJson("/images/json", "GET", options)
    .then(reply => {
      const images = {};
      const promises = [];

      for (const image of reply) {
        images[image.Id] = image;
        promises.push(dockerJson("/images/" + image.Id + "/json", "GET", {}));
      }

      return Promise.all(promises)
        .then(replies => {
          for (const info of replies) {
            images[info.Id] = Object.assign(images[info.Id], parseImageInfo(info));
          }
          return images;
        });
    });
}

export const delImage = (id, force) => dockerJson("/images/" + encodeURIComponent(id), "DELETE", { force });

export const untagImage = (id, repo, tag) =>
  dockerCall("/images/" + encodeURIComponent(id) + "/untag", "POST", { repo, tag });

export function pullImage(reference) {
  return new Promise((resolve, reject) => {
    const options = {
      fromImage: reference,
    };
    dockerCall("/images/create", "POST", options)
      .then(r => {
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

export const pruneUnusedImages = () => dockerJson("/images/prune", "POST", {});

// optional: id might be a sha or name; encode to be safe
export const imageHistory = (id) => dockerJson(`/images/${encodeURIComponent(id)}/history`, "GET", {});

// FIX: encode ref; returns 404 if missing
export const imageExists = (idOrRef) =>
  dockerCall("/images/" + encodeURIComponent(idOrRef) + "/json", "GET", {});

// FIX: encode; Docker accepts name or ID
export const containerExists = (idOrName) =>
  dockerCall("/containers/" + encodeURIComponent(idOrName) + "/json", "GET", {});
