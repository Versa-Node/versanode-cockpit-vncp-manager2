import React, { useState, useEffect, useRef } from 'react';

import { Button } from "@patternfly/react-core/dist/esm/components/Button";
import { DataList, DataListCell, DataListItem, DataListItemCells, DataListItemRow } from "@patternfly/react-core/dist/esm/components/DataList";
import { Form, FormGroup } from "@patternfly/react-core/dist/esm/components/Form";
import { FormSelect, FormSelectOption } from "@patternfly/react-core/dist/esm/components/FormSelect";
import {
    Modal, ModalBody, ModalFooter, ModalHeader
} from '@patternfly/react-core/dist/esm/components/Modal';
import { Radio } from "@patternfly/react-core/dist/esm/components/Radio";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput";
import { Flex } from "@patternfly/react-core/dist/esm/layouts/Flex";
import { ExclamationCircleIcon } from '@patternfly/react-icons';
import { useDialogs } from "dialogs.jsx";

import cockpit from 'cockpit';
import { EmptyStatePanel } from "cockpit-components-empty-state.tsx";

import { ErrorNotification } from './Notification.jsx';
import * as client from './client.js';
import rest from './rest.js';
import { fallbackRegistries, useDockerInfo } from './util.js';

import './ImageSearchModal.css';

const _ = cockpit.gettext;

// ---------- GHCR helpers (only versa-node) ----------
const GH_ORG = "versa-node";             // org is case-insensitive in API paths
const GHCR_NAMESPACE = "ghcr.io/versa-node/";

const isGhcr = (reg) => (reg || "").trim().toLowerCase() === "ghcr.io";

// user typed a GHCR versa-node reference? (either fully-qualified or org-prefixed)
const isGhcrVersaNodeTerm = (term) =>
  /^ghcr\.io\/versa-node\/[^/]+/i.test(term || "") || /^versa-node\/[^/]+/i.test(term || "");

// -------- naming helpers (vncp-…) --------

// Strip registry/org + tag/digest from any image ref
const stripToRepo = (ref) => {
  if (!ref) return "";
  // remove digest
  let s = ref.replace(/@sha256:[a-f0-9]{64}$/i, "");
  // split off tag
  s = s.split(":")[0];
  // remove leading registry/org prefixes we use
  s = s.replace(/^ghcr\.io\//i, "")
       .replace(/^docker\.io\//i, "")
       .replace(/^versa-node\//i, "")
       .replace(/^library\//i, "");
  // keep only the last path segment as the repo name
  const last = s.split("/").pop() || s;
  return last;
};

// Pretty label: always show "vncp-<repo>"
const buildShortLabel = (full) => {
  const repo = stripToRepo(full);
  return repo.startsWith("vncp-") ? repo : `vncp-${repo}`;
};

// turn free text into the final ghcr.io/versa-node/<name>
const buildGhcrVersaNodeName = (txt) => {
  const t = (txt || "").trim()
    .replace(/^ghcr\.io\/?/i, "")
    .replace(/^versa-node\/?/i, "");
  return (GHCR_NAMESPACE + t).replace(/\/+$/, "");
};

// Extract repo name (no tag) from a ghcr.io/versa-node/* image ref
const parseGhcrRepoName = (full) => {
  if (!full) return "";
  const noTag = full.split(':')[0];
  return noTag.replace(/^ghcr\.io\/?versa-node\/?/i, "").replace(/^\/+/, "");
};

// -------------------- SIMPLE IN-MEMORY CACHES --------------------
const ghcrOrgCache = { list: null, at: 0 }; // {list: [{name, description}], at: ts}
const ghcrTagsCache = {}; // key: package -> {list: [tags], at: ts}
const readmeCache = {}; // key: package@tag -> {content: string, at: ts}
const descCache = new Map(); // key: `${name}@${tag}` -> description
const tagsCache = new Map(); // key: repo -> [tags]
const tokenCache = new Map(); // key: repo -> token (string)

const now = () => Date.now();
const MIN = 60 * 1000;
const isFresh = (ts, maxAgeMs) => ts && (now() - ts) < maxAgeMs;

// -------------------- ORG LIST (GitHub Packages REST) --------------------
async function fetchGhcrOrgPackagesViaSpawn({ bypassCache = false } = {}) {
  if (!bypassCache && ghcrOrgCache.list && isFresh(ghcrOrgCache.at, 10 * MIN)) {
    return ghcrOrgCache.list;
  }

  // Make sure GH_ORG exists in JS (not env). e.g. const GH_ORG = "versa-node";
  if (!GH_ORG || typeof GH_ORG !== "string" || !GH_ORG.trim()) {
    console.warn("[GHCR] GH_ORG not set in JS context");
    return [];
  }

  const url = `https://api.github.com/orgs/${GH_ORG}/packages?package_type=container&per_page=100`;

  const script = `
set -euo pipefail
URL="${url}"
HDR_ACCEPT="Accept: application/vnd.github+json"
HDR_API="X-GitHub-Api-Version: 2022-11-28"
UA="User-Agent: versanode-cockpit/1.0"
TOKEN_FILE="/etc/versanode/github.token"

command -v curl >/dev/null 2>&1 || { echo "ERR: curl not installed" >&2; exit 97; }

# Read token if present; strip CR/LF to avoid subtle parse issues
TOKEN=""
if [ -r "$TOKEN_FILE" ]; then
  TOKEN="$(tr -d '\\r\\n' < "$TOKEN_FILE" || true)"
fi

# Make request; capture status + body separately
tmp_body="$(mktemp)"
http_code=000

if [ -n "$TOKEN" ]; then
  http_code="$(curl -sS -w '%{http_code}' -o "$tmp_body" \\
    -H "$HDR_ACCEPT" -H "$HDR_API" -H "$UA" \\
    -H "Authorization: Bearer $TOKEN" \\
    "$URL" || true)"
else
  http_code="$(curl -sS -w '%{http_code}' -o "$tmp_body" \\
    -H "$HDR_ACCEPT" -H "$HDR_API" -H "$UA" \\
    "$URL" || true)"
fi

# On success (2xx), print body; otherwise print [] but also an error line to stderr
case "$http_code" in
  200|201|204)
    cat "$tmp_body"
    ;;
  401|403)
    echo "[]"
    echo "ERR: HTTP $http_code from GitHub. Token missing or insufficient scope (need read:packages)." >&2
    head -c 512 "$tmp_body" >&2 || true
    ;;
  404)
    echo "[]"
    echo "ERR: HTTP 404. Check org name (${GH_ORG}) and endpoint. URL: $URL" >&2
    head -c 512 "$tmp_body" >&2 || true
    ;;
  *)
    echo "[]"
    echo "ERR: HTTP $http_code from GitHub." >&2
    head -c 512 "$tmp_body" >&2 || true
    ;;
esac

rm -f "$tmp_body"
`;

  try {
    // require root, so it can read /etc/versanode/github.token even if 0600 root:root
    const out = await cockpit.spawn(["bash", "-lc", script], { superuser: "require", err: "message" });
    const pkgs = JSON.parse(out || "[]");
    const normalized = (pkgs || []).map(p => ({
      name: `ghcr.io/${GH_ORG}/${p.name}`,
      description: (p.description || "").trim(),
    }));
    ghcrOrgCache.list = normalized;
    ghcrOrgCache.at = now();
    console.debug("[GHCR] Org packages fetched:", normalized.length);
    return normalized;
  } catch (e) {
    console.warn("[GHCR] fetchGhcrOrgPackagesViaSpawn failed:", e?.message || e);
    return [];
  }
}

// -------------------- TAG LIST (for a specific package) --------------------
async function fetchGhcrTagsViaSpawn(packageName, { bypassCache = false } = {}) {
  const cacheKey = `tags_${packageName}`;
  if (!bypassCache && ghcrTagsCache[cacheKey] && isFresh(ghcrTagsCache[cacheKey].at, 5 * MIN)) {
    return ghcrTagsCache[cacheKey].list || [];
  }

  if (!packageName || typeof packageName !== "string") {
    console.warn("[GHCR] Invalid packageName for tags");
    return [];
  }

  const barePackage = packageName.replace(/^ghcr\.io\//i, "");
  const url = `https://api.github.com/orgs/${GH_ORG}/packages/container/${encodeURIComponent(barePackage)}/versions?per_page=50`;

  const script = `
set -euo pipefail
URL="${url}"
HDR_ACCEPT="Accept: application/vnd.github+json"
HDR_API="X-GitHub-Api-Version: 2022-11-28"
UA="User-Agent: versanode-cockpit/1.0"
TOKEN_FILE="/etc/versanode/github.token"

command -v curl >/dev/null 2>&1 || { echo "ERR: curl not installed" >&2; exit 97; }

TOKEN=""
if [ -r "$TOKEN_FILE" ]; then
  TOKEN="$(tr -d '\\r\\n' < "$TOKEN_FILE" || true)"
fi

tmp_body="$(mktemp)"
http_code=000

if [ -n "$TOKEN" ]; then
  http_code="$(curl -sS -w '%{http_code}' -o "$tmp_body" \\
    -H "$HDR_ACCEPT" -H "$HDR_API" -H "$UA" \\
    -H "Authorization: Bearer $TOKEN" \\
    "$URL" || true)"
else
  http_code="$(curl -sS -w '%{http_code}' -o "$tmp_body" \\
    -H "$HDR_ACCEPT" -H "$HDR_API" -H "$UA" \\
    "$URL" || true)"
fi

case "$http_code" in
  200|201|204)
    cat "$tmp_body"
    ;;
  401|403)
    echo "[]"
    echo "ERR: HTTP $http_code from GitHub API (tags). Token needed for private repos." >&2
    head -c 512 "$tmp_body" >&2 || true
    ;;
  404)
    echo "[]"
    echo "ERR: HTTP 404. Package not found: ${barePackage}" >&2
    head -c 512 "$tmp_body" >&2 || true
    ;;
  *)
    echo "[]"
    echo "ERR: HTTP $http_code from GitHub API (tags)." >&2
    head -c 512 "$tmp_body" >&2 || true
    ;;
esac

rm -f "$tmp_body"
`;

  try {
    const out = await cockpit.spawn(["bash", "-lc", script], { superuser: "require", err: "message" });
    const versions = JSON.parse(out || "[]");

    // Extract tags from metadata.container.tags array
    const tags = [];
    (versions || []).forEach(v => {
      if (v.metadata && v.metadata.container && v.metadata.container.tags) {
        tags.push(...v.metadata.container.tags);
      }
    });

    // Deduplicate and sort
    const uniqueTags = [...new Set(tags)].sort();

    ghcrTagsCache[cacheKey] = { list: uniqueTags, at: now() };
    console.debug(`[GHCR] Tags for ${packageName}:`, uniqueTags);
    return uniqueTags;
  } catch (e) {
    console.warn(`[GHCR] fetchGhcrTagsViaSpawn failed for ${packageName}:`, e?.message || e);
    return [];
  }
}

// -------------------- README CONTENT --------------------
async function fetchReadmeViaSpawn(packageName, tag = "latest", { bypassCache = false } = {}) {
  const cacheKey = `${packageName}@${tag}`;
  if (!bypassCache && readmeCache[cacheKey] && isFresh(readmeCache[cacheKey].at, 15 * MIN)) {
    return readmeCache[cacheKey].content || "";
  }

  if (!packageName || typeof packageName !== "string") {
    console.warn("[GHCR] Invalid packageName for README");
    return "";
  }

  const barePackage = packageName.replace(/^ghcr\.io\//i, "");
  const imageRef = `ghcr.io/${barePackage}:${tag}`;

  // First try to get README from image labels (base64 encoded)
  const inspectScript = `
set -euo pipefail
IMAGE_REF="${imageRef}"

command -v docker >/dev/null 2>&1 || { echo "ERR: docker not installed" >&2; exit 97; }

# Try to inspect the image to get README from labels
if docker image inspect "$IMAGE_REF" >/dev/null 2>&1; then
  docker image inspect "$IMAGE_REF" --format '{{json .Config.Labels}}' 2>/dev/null || echo "{}"
else
  echo "{}"
fi
`;

  try {
    const out = await cockpit.spawn(["bash", "-lc", inspectScript], { err: "message" });
    const labels = JSON.parse(out || "{}");
    
    // Look for README in various label formats
    let readmeContent = "";
    
    if (labels["org.opencontainers.image.documentation.readme"]) {
      try {
        readmeContent = atob(labels["org.opencontainers.image.documentation.readme"]);
      } catch (e) {
        console.warn("[GHCR] Failed to decode base64 README from label:", e);
      }
    } else if (labels["versanode.readme"]) {
      try {
        readmeContent = atob(labels["versanode.readme"]);
      } catch (e) {
        console.warn("[GHCR] Failed to decode base64 README from versanode label:", e);
      }
    } else if (labels["readme"]) {
      // Direct README content
      readmeContent = labels["readme"];
    }

    // If no README in labels, try to fetch from container filesystem
    if (!readmeContent) {
      const containerScript = `
set -euo pipefail
IMAGE_REF="${imageRef}"

command -v docker >/dev/null 2>&1 || { echo "ERR: docker not installed" >&2; exit 97; }

# Try to extract README from container
CONTAINER_ID=""
cleanup() {
  if [ -n "$CONTAINER_ID" ]; then
    docker rm -f "$CONTAINER_ID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# Create container without running it
CONTAINER_ID="$(docker create "$IMAGE_REF" /bin/sh 2>/dev/null || echo "")"

if [ -n "$CONTAINER_ID" ]; then
  # Try common README locations
  for readme_path in "/README.md" "/readme.md" "/README" "/readme" "/app/README.md" "/usr/share/doc/README.md"; do
    if docker cp "$CONTAINER_ID:$readme_path" /dev/stdout 2>/dev/null; then
      exit 0
    fi
  done
fi

echo ""  # Empty README if not found
`;

      try {
        const containerOut = await cockpit.spawn(["bash", "-lc", containerScript], { err: "message" });
        readmeContent = containerOut || "";
      } catch (e) {
        console.debug("[GHCR] Container README extraction failed:", e);
      }
    }

    readmeCache[cacheKey] = { content: readmeContent, at: now() };
    console.debug(`[GHCR] README for ${packageName}:${tag} - ${readmeContent.length} chars`);
    return readmeContent;
  } catch (e) {
    console.warn(`[GHCR] fetchReadmeViaSpawn failed for ${packageName}:${tag}:`, e?.message || e);
    return "";
  }
}

export const ImageSearchModal = ({ downloadImage, users }) => {
    const [searchInProgress, setSearchInProgress] = useState(false);
    const [searchFinished, setSearchFinished] = useState(false);
    const [imageIdentifier, setImageIdentifier] = useState('');
    const [imageList, setImageList] = useState([]);
    const [imageTag, setImageTag] = useState("");
    const [user, setUser] = useState(users[0]);
    const [selectedRegistry, setSelectedRegistry] = useState("");
    const [selected, setSelected] = useState("");
    const [dialogError, setDialogError] = useState("");
    const [dialogErrorDetail, setDialogErrorDetail] = useState("");
    const [typingTimeout, setTypingTimeout] = useState(null);

    let activeConnection = null;
    const { registries } = useDockerInfo();
    const Dialogs = useDialogs();
    // Registries to use for searching
    const searchRegistries = registries?.search && registries.search.length !== 0 ? registries.search : fallbackRegistries;

    // Don't use on selectedRegistry state variable for finding out the
    // registry to search in as with useState we can only call something after a
    // state update with useEffect but as onSearchTriggered also changes state we
    // can't use that so instead we pass the selected registry.
    const onSearchTriggered = (searchRegistry = "", forceSearch = false) => {
        // When search re-triggers close any existing active connection
        activeConnection = rest.connect(user.uid);
        if (activeConnection)
            activeConnection.close();
        setSearchFinished(false);

        // Do not call the SearchImage API if the input string  is not at least 2 chars,
        // unless Enter is pressed, which should force start the search.
        // The comparison was done considering the fact that we miss always one letter due to delayed setState
        if (imageIdentifier.length < 2 && !forceSearch)
            return;

        setSearchInProgress(true);

        let queryRegistries = searchRegistries;
        if (searchRegistry !== "") {
            queryRegistries = [searchRegistry];
        }
        // if a user searches for `docker.io/cockpit` let docker search in the user specified registry.
        if (imageIdentifier.includes('/')) {
            queryRegistries = [""];
        }

        const searches = queryRegistries.map(rr => {
            const registry = rr.length < 1 || rr[rr.length - 1] === "/" ? rr : rr + "/";
            return activeConnection.call({
                method: "GET",
                path: client.VERSION + "libpod/images/search",
                body: "",
                params: {
                    term: registry + imageIdentifier
                }
            });
        });

        Promise.allSettled(searches)
                .then(async reply => {
                    if (reply) {
                        let results = [];

                        for (const result of reply) {
                            if (result.status === "fulfilled") {
                                results = results.concat(JSON.parse(result.value));
                            } else {
                                setDialogError(_("Failed to search for new images"));
                                setDialogErrorDetail(result.reason ? cockpit.format(_("Failed to search for images: $0"), result.reason.message) : _("Failed to search for images."));
                            }
                        }

                        // Add GHCR versa-node packages if searching broadly or specifically for ghcr.io
                        const shouldIncludeGhcr = imageIdentifier.trim().length > 0 && (
                            queryRegistries.includes("ghcr.io") ||
                            queryRegistries.includes("") ||
                            imageIdentifier.toLowerCase().includes("versa-node") ||
                            imageIdentifier.toLowerCase().includes("ghcr")
                        );

                        if (shouldIncludeGhcr) {
                            try {
                                const ghcrPackages = await fetchGhcrOrgPackagesViaSpawn();
                                const searchTerm = imageIdentifier.toLowerCase().trim();
                                
                                // Filter GHCR packages by search term
                                const matchingPackages = ghcrPackages.filter(pkg => {
                                    const name = pkg.name.toLowerCase();
                                    const description = (pkg.description || "").toLowerCase();
                                    return name.includes(searchTerm) || description.includes(searchTerm);
                                });

                                // Convert to Docker API format
                                const ghcrResults = matchingPackages.map(pkg => ({
                                    Name: pkg.name,
                                    Description: pkg.description || "",
                                    Stars: 0,
                                    Official: false,
                                    Automated: false,
                                    _isGhcrVersa: true // Mark as GHCR versa-node package
                                }));

                                results = results.concat(ghcrResults);
                                console.debug(`[GHCR] Added ${ghcrResults.length} versa-node packages to search results`);
                            } catch (e) {
                                console.warn("[GHCR] Failed to fetch org packages during search:", e);
                            }
                        }

                        setImageList(results || []);
                        setSearchInProgress(false);
                        setSearchFinished(true);
                    }
                });
    };

    const onKeyDown = (e) => {
        if (e.key != ' ') { // Space should not trigger search
            const forceSearch = e.key == 'Enter';
            if (forceSearch) {
                e.preventDefault();
            }

            // Reset the timer, to make the http call after 250MS
            clearTimeout(typingTimeout);
            setTypingTimeout(setTimeout(() => onSearchTriggered(selectedRegistry, forceSearch), 250));
        }
    };

    const onToggleUser = ev => setUser(users.find(u => u.name === ev.currentTarget.value));
    const onDownloadClicked = () => {
        const selectedImageName = imageList[selected].Name;
        if (activeConnection)
            activeConnection.close();
        Dialogs.close();
        downloadImage(selectedImageName, imageTag, user.con);
    };

    const handleClose = () => {
        if (activeConnection)
            activeConnection.close();
        Dialogs.close();
    };

    return (
        <Modal isOpen className="docker-search"
               position="top" variant="large"
               onClose={handleClose}
        >
            <ModalHeader title={_("Search for an image")} />
            <ModalBody>
                <Form isHorizontal>
                    {dialogError && <ErrorNotification errorMessage={dialogError} errorDetail={dialogErrorDetail} />}
                    { users.length > 1 &&
                    <FormGroup id="as-user" label={_("Owner")} isInline>
                        { users.map(u => (
                            <Radio key={u.name}
                                   value={u.name}
                                   label={u.name}
                                   id={"image-search-modal-owner-" + u.name}
                                   onChange={onToggleUser}
                                   isChecked={u === user} />))
                        }
                    </FormGroup>}
                    <Flex spaceItems={{ default: 'inlineFlex', modifier: 'spaceItemsXl' }}>
                        <FormGroup fieldId="search-image-dialog-name" label={_("Search for")}>
                            <TextInput id='search-image-dialog-name'
                                       type='text'
                                       placeholder={_("Search by name or description")}
                                       value={imageIdentifier}
                                       onKeyDown={onKeyDown}
                                       onChange={(_event, value) => setImageIdentifier(value)} />
                        </FormGroup>
                        <FormGroup fieldId="registry-select" label={_("in")}>
                            <FormSelect id='registry-select'
                                value={selectedRegistry}
                                onChange={(_ev, value) => { setSelectedRegistry(value); clearTimeout(typingTimeout); onSearchTriggered(value, false) }}>
                                <FormSelectOption value="" key="all" label={_("All registries")} />
                                {(searchRegistries || []).map(r => <FormSelectOption value={r} key={r} label={r} />)}
                            </FormSelect>
                        </FormGroup>
                    </Flex>
                </Form>

                {searchInProgress && <EmptyStatePanel loading title={_("Searching...")} /> }

                {((!searchInProgress && !searchFinished) || imageIdentifier == "") && <EmptyStatePanel title={_("No images found")} paragraph={_("Start typing to look for images.")} /> }

                {searchFinished && imageIdentifier !== '' && <>
                    {imageList.length == 0 && <EmptyStatePanel icon={ExclamationCircleIcon}
                                                                          title={cockpit.format(_("No results for $0"), imageIdentifier)}
                                                                          paragraph={_("Retry another term.")}
                    />}
                    {imageList.length > 0 &&
                    <DataList isCompact
                              selectedDataListItemId={"image-list-item-" + selected}
                              onSelectDataListItem={(_, key) => setSelected(key.split('-').slice(-1)[0])}>
                        {imageList.map((image, iter) => {
                            return (
                                <DataListItem id={"image-list-item-" + iter} key={iter}>
                                    <DataListItemRow>
                                        <DataListItemCells
                                                  dataListCells={[
                                                      <DataListCell key="primary content">
                                                          <span className='image-name'>{image.Name}</span>
                                                      </DataListCell>,
                                                      <DataListCell key="secondary content" wrapModifier="truncate">
                                                          <span className='image-description'>{image.Description}</span>
                                                      </DataListCell>
                                                  ]}
                                        />
                                    </DataListItemRow>
                                </DataListItem>
                            );
                        })}
                    </DataList>}
                </>}
            </ModalBody>
            <ModalFooter>
                <Form isHorizontal className="image-search-tag-form">
                    <FormGroup fieldId="image-search-tag" label={_("Tag")}>
                        <TextInput className="image-tag-entry"
                               id="image-search-tag"
                               type='text'
                               placeholder="latest"
                               value={imageTag || ''}
                               onChange={(_event, value) => setImageTag(value)} />
                    </FormGroup>
                </Form>
                <Button variant='primary' isDisabled={selected === ""} onClick={onDownloadClicked}>
                    {_("Download")}
                </Button>
                <Button variant='link' className='btn-cancel' onClick={handleClose}>
                    {_("Cancel")}
                </Button>
            </ModalFooter>
        </Modal>
    );
};
