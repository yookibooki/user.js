// ==UserScript==
// @name         GitHub Repository Size Checker
// @namespace	 https://github.com/yookibooki
// @version      1.0
// @description  Displays the repo size without .git
// @match        *://github.com/*/*
// @exclude      *://github.com/*/issues*
// @exclude      *://github.com/*/pulls*
// @exclude      *://github.com/*/actions*
// @exclude      *://github.com/*/projects*
// @exclude      *://github.com/*/wiki*
// @exclude      *://github.com/*/security*
// @exclude      *://github.com/*/pulse*
// @exclude      *://github.com/*/settings*
// @exclude      *://github.com/*/branches*
// @exclude      *://github.com/*/tags*
// @exclude      *://github.com/*/*/commit*
// @exclude      *://github.com/*/*/tree*
// @exclude      *://github.com/*/*/blob*
// @exclude      *://github.com/settings*
// @exclude      *://github.com/notifications*
// @exclude      *://github.com/marketplace*
// @exclude      *://github.com/explore*
// @exclude      *://github.com/topics*
// @exclude      *://github.com/sponsors*
// @exclude      *://github.com/dashboard*
// @exclude      *://github.com/new*
// @exclude      *://github.com/codespaces*
// @exclude      *://github.com/account*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @connect      api.github.com
// ==/UserScript==

(function() {
    'use strict';

    const CACHE_KEY = 'repoSizeCache';
    const PAT_KEY = 'github_pat_repo_size';
    const CACHE_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

    // --- Configuration ---
    const GITHUB_API_BASE = 'https://api.github.com';
    // Target element selector (this might change if GitHub updates its layout)
    const TARGET_ELEMENT_SELECTOR = '#repo-title-component > span.Label.Label--secondary'; // The 'Public'/'Private' label
    const DISPLAY_ELEMENT_ID = 'repo-size-checker-display';

    // --- Styles ---
    const STYLE_LOADING = 'color: orange; margin-left: 6px; font-size: 12px; font-weight: 600;';
    const STYLE_ERROR = 'color: red; margin-left: 6px; font-size: 12px; font-weight: 600;';
    const STYLE_SIZE = 'color: #6a737d; margin-left: 6px; font-size: 12px; font-weight: 600;'; // Use GitHub's secondary text color

    let currentRepoInfo = null; // { owner, repo, key: 'owner/repo' }
    let pat = null;
    let displayElement = null;
    let observer = null; // MutationObserver to watch for page changes

    // --- Helper Functions ---

    function log(...args) {
        console.log('[RepoSizeChecker]', ...args);
    }

    function getRepoInfoFromUrl() {
        const match = window.location.pathname.match(/^\/([^/]+)\/([^/]+)(?:\/?$|\/tree\/|\/find\/|\/graphs\/|\/network\/|\/releases\/)/);
        if (match && match[1] && match[2]) {
            // Basic check to avoid non-code pages that might match the pattern
            if (document.querySelector('#repository-container-header')) {
                 return { owner: match[1], repo: match[2], key: `${match[1]}/${match[2]}` };
            }
        }
        return null;
    }

    function formatBytes(bytes, decimals = 1) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }

    function getPAT() {
        if (pat) return pat;
        pat = GM_getValue(PAT_KEY, null);
        return pat;
    }

    function setPAT(newPat) {
        if (newPat && typeof newPat === 'string' && newPat.trim().length > 0) {
            pat = newPat.trim();
            GM_setValue(PAT_KEY, pat);
            log('GitHub PAT saved.');
            // Clear current error message if any
            if (displayElement && displayElement.textContent?.includes('PAT Required')) {
                updateDisplay('', STYLE_LOADING); // Reset display
            }
            // Re-run the main logic if PAT was missing
            main();
            return true;
        } else {
             GM_setValue(PAT_KEY, ''); // Clear stored PAT if input is invalid/empty
             pat = null;
             log('Invalid PAT input. PAT cleared.');
             updateDisplay('Invalid PAT', STYLE_ERROR);
             return false;
        }
    }

    function promptForPAT() {
        const newPat = prompt('GitHub Personal Access Token (PAT) required for API access. Please enter your PAT (needs repo scope):\n\nIt will be stored locally by Tampermonkey.', '');
        if (newPat === null) { // User cancelled
            updateDisplay('PAT Required', STYLE_ERROR);
            return false;
        }
        return setPAT(newPat);
    }

    function getCache() {
        const cacheStr = GM_getValue(CACHE_KEY, '{}');
        try {
            return JSON.parse(cacheStr);
        } catch (e) {
            log('Error parsing cache, resetting.', e);
            GM_setValue(CACHE_KEY, '{}');
            return {};
        }
    }

    function setCache(repoKey, data) {
        try {
            const cache = getCache();
            cache[repoKey] = data;
            GM_setValue(CACHE_KEY, JSON.stringify(cache));
        } catch (e) {
             log('Error writing cache', e);
        }
    }

    function updateDisplay(text, style = STYLE_SIZE, isLoading = false) {
        if (!displayElement) {
            const targetElement = document.querySelector(TARGET_ELEMENT_SELECTOR);
            if (!targetElement) {
                log('Target element not found.');
                return; // Target element isn't on the page yet or selector is wrong
            }
            displayElement = document.createElement('span');
            displayElement.id = DISPLAY_ELEMENT_ID;
            targetElement.insertAdjacentElement('afterend', displayElement);
            log('Display element injected.');
        }

        displayElement.textContent = isLoading ? `(${text}...)` : text;
        displayElement.style.cssText = style;
    }

    function makeApiRequest(url, method = 'GET') {
        return new Promise((resolve, reject) => {
            const currentPat = getPAT();
            if (!currentPat) {
                reject(new Error('PAT Required'));
                return;
            }

            GM_xmlhttpRequest({
                method: method,
                url: url,
                headers: {
                    "Authorization": `token ${currentPat}`,
                    "Accept": "application/vnd.github.v3+json"
                },
                onload: function(response) {
                    if (response.status >= 200 && response.status < 300) {
                        try {
                            resolve(JSON.parse(response.responseText));
                        } catch (e) {
                            reject(new Error(`Failed to parse API response: ${e.message}`));
                        }
                    } else if (response.status === 401) {
                        reject(new Error('Invalid PAT'));
                    } else if (response.status === 403) {
                        const rateLimitRemaining = response.responseHeaders.match(/x-ratelimit-remaining:\s*(\d+)/i);
                        const rateLimitReset = response.responseHeaders.match(/x-ratelimit-reset:\s*(\d+)/i);
                        let errorMsg = 'API rate limit exceeded or insufficient permissions.';
                        if (rateLimitRemaining && rateLimitRemaining[1] === '0' && rateLimitReset) {
                             const resetTime = new Date(parseInt(rateLimitReset[1], 10) * 1000);
                             errorMsg += ` Limit resets at ${resetTime.toLocaleTimeString()}.`;
                        } else {
                            errorMsg += ' Check PAT permissions (needs `repo` scope).';
                        }
                         reject(new Error(errorMsg));
                    } else if (response.status === 404) {
                         reject(new Error('Repository not found or PAT lacks access.'));
                    }
                    else {
                        reject(new Error(`API request failed with status ${response.status}: ${response.statusText}`));
                    }
                },
                onerror: function(response) {
                    reject(new Error(`Network error during API request: ${response.error || 'Unknown error'}`));
                },
                ontimeout: function() {
                    reject(new Error('API request timed out.'));
                }
            });
        });
    }

    async function fetchLatestDefaultBranchSha(owner, repo) {
        log(`Fetching repo info for ${owner}/${repo}`);
        const repoUrl = `${GITHUB_API_BASE}/repos/${owner}/${repo}`;
        try {
            const repoData = await makeApiRequest(repoUrl);
            const defaultBranch = repoData.default_branch;
            if (!defaultBranch) {
                throw new Error('Could not determine default branch.');
            }
            log(`Default branch: ${defaultBranch}. Fetching its latest SHA.`);
            const branchUrl = `${GITHUB_API_BASE}/repos/${owner}/${repo}/branches/${defaultBranch}`;
            const branchData = await makeApiRequest(branchUrl);
            return branchData.commit.sha;
        } catch (error) {
            log(`Error fetching latest SHA for ${owner}/${repo}:`, error);
            throw error; // Re-throw to be caught by the main logic
        }
    }

    async function fetchRepoTreeSize(owner, repo, sha) {
        log(`Fetching tree size for ${owner}/${repo} at SHA ${sha}`);
        const treeUrl = `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`;
        try {
            const treeData = await makeApiRequest(treeUrl);

            if (treeData.truncated && (!treeData.tree || treeData.tree.length === 0)) {
                // Handle extremely large repos where even the first page is truncated without file list
                 throw new Error('Repo likely too large for basic tree API. Size unavailable.');
            }

            let totalSize = 0;
            if (treeData.tree) {
                treeData.tree.forEach(item => {
                    if (item.type === 'blob' && item.size !== undefined && item.size !== null) {
                        totalSize += item.size;
                    }
                });
            }

            log(`Calculated size for ${owner}/${repo} (SHA: ${sha}): ${totalSize} bytes. Truncated: ${treeData.truncated}`);
            return {
                size: totalSize,
                truncated: treeData.truncated === true // Ensure boolean
            };
        } catch (error) {
            log(`Error fetching tree size for ${owner}/${repo}:`, error);
            // Special handling for empty repos which return 404 for the tree SHA
            if (error.message && error.message.includes('404') && error.message.includes('Not Found')) {
                 log(`Assuming empty repository for ${owner}/${repo} based on 404 for tree SHA ${sha}.`);
                 return { size: 0, truncated: false };
            }
            throw error; // Re-throw other errors
        }
    }

    async function main() {
        const repoInfo = getRepoInfoFromUrl();

        // Exit if not on a repo page or already processed this exact URL path
        if (!repoInfo || (currentRepoInfo && currentRepoInfo.key === repoInfo.key && currentRepoInfo.path === window.location.pathname)) {
            // log('Not a repo page or already processed:', window.location.pathname);
            return;
        }

        currentRepoInfo = { ...repoInfo, path: window.location.pathname }; // Store owner, repo, key, and full path
        log('Detected repository:', currentRepoInfo.key);

        // Ensure display element exists or create it
        updateDisplay('loading', STYLE_LOADING, true);

        // Check for PAT
        if (!getPAT()) {
            log('PAT not found.');
            updateDisplay('PAT Required', STYLE_ERROR);
            promptForPAT(); // Ask user for PAT
            // If promptForPAT fails or is cancelled, the display remains 'PAT Required'
            return; // Stop processing until PAT is provided
        }

        // --- Caching Logic ---
        const cache = getCache();
        const cachedData = cache[currentRepoInfo.key];
        const now = Date.now();

        if (cachedData) {
            const cacheAge = now - (cachedData.timestamp || 0);
            log(`Cache found for ${currentRepoInfo.key}: Age ${Math.round(cacheAge / 1000)}s, SHA ${cachedData.sha}`);

            // 1. Check if cache is fresh (less than 24 hours)
            if (cacheAge < CACHE_EXPIRY_MS) {
                log('Cache is fresh (<24h). Using cached size.');
                updateDisplay(
                    `${cachedData.truncated ? '~' : ''}${formatBytes(cachedData.size)}`,
                    STYLE_SIZE
                );
                return; // Use fresh cache
            }

            // 2. Cache is older than 24 hours, check if SHA matches current default branch head
            log('Cache is stale (>24h). Checking latest SHA...');
            updateDisplay('validating', STYLE_LOADING, true);
            try {
                const latestSha = await fetchLatestDefaultBranchSha(currentRepoInfo.owner, currentRepoInfo.repo);
                log(`Latest SHA: ${latestSha}, Cached SHA: ${cachedData.sha}`);

                if (latestSha === cachedData.sha) {
                    log('SHA matches. Reusing cached size and updating timestamp.');
                    // Update timestamp in cache
                    cachedData.timestamp = now;
                    setCache(currentRepoInfo.key, cachedData);
                    updateDisplay(
                        `${cachedData.truncated ? '~' : ''}${formatBytes(cachedData.size)}`,
                        STYLE_SIZE
                    );
                    return; // Use validated cache
                } else {
                    log('SHA mismatch. Cache invalid. Fetching new size.');
                }
            } catch (error) {
                log('Error validating SHA:', error);
                updateDisplay(`Error: ${error.message}`, STYLE_ERROR);
                // Optionally clear the stale cache entry if validation fails badly?
                // delete cache[currentRepoInfo.key];
                // GM_setValue(CACHE_KEY, JSON.stringify(cache));
                return; // Stop if we can't validate
            }
        } else {
            log(`No cache found for ${currentRepoInfo.key}.`);
        }

        // --- Fetching New Data ---
        updateDisplay('loading', STYLE_LOADING, true);
        try {
            // We might have already fetched the SHA during cache validation
            let latestSha = cachedData?.latestShaChecked; // Reuse if available from failed validation
             if (!latestSha) {
                 latestSha = await fetchLatestDefaultBranchSha(currentRepoInfo.owner, currentRepoInfo.repo);
            }

            const { size, truncated } = await fetchRepoTreeSize(currentRepoInfo.owner, currentRepoInfo.repo, latestSha);

            // Save to cache
            const newData = {
                size: size,
                sha: latestSha,
                timestamp: Date.now(),
                truncated: truncated
            };
            setCache(currentRepoInfo.key, newData);

            // Display result
            updateDisplay(
                `${truncated ? '~' : ''}${formatBytes(size)}`,
                STYLE_SIZE
            );

        } catch (error) {
            log('Error during main fetch process:', error);
            let errorMsg = `Error: ${error.message}`;
             if (error.message === 'Invalid PAT') {
                 errorMsg = 'Invalid PAT';
                 setPAT(''); // Clear invalid PAT
                 promptForPAT(); // Ask again
             } else if (error.message === 'PAT Required') {
                  errorMsg = 'PAT Required';
                  promptForPAT();
             }
            updateDisplay(errorMsg, STYLE_ERROR);
        }
    }

    // --- Initialization ---

    function init() {
        log("Script initializing...");

        // Register menu command to update PAT
        GM_registerMenuCommand('Set/Update GitHub PAT for Repo Size', () => {
             const currentPatValue = GM_getValue(PAT_KEY, '');
             const newPat = prompt('Enter your GitHub Personal Access Token (PAT) for Repo Size Checker (needs repo scope):', currentPatValue);
              if (newPat !== null) { // Handle cancel vs empty string
                  setPAT(newPat); // Validate and save
              }
        });

        // Use MutationObserver to detect navigation changes within GitHub (SPA behavior)
        // and when the target element appears after load.
        observer = new MutationObserver((mutationsList, observer) => {
            // Check if the repo title area is present, indicating a potential repo page load/update
            if (document.querySelector(TARGET_ELEMENT_SELECTOR) && !document.getElementById(DISPLAY_ELEMENT_ID)) {
                 // If the display element isn't there but the target is, try running main
                 log("Target element detected, running main logic.");
                 main();
            } else {
                // Also check if the URL path changed significantly enough to warrant a re-check
                const newRepoInfo = getRepoInfoFromUrl();
                if (newRepoInfo && (!currentRepoInfo || newRepoInfo.key !== currentRepoInfo.key)) {
                    log("Detected navigation to a new repository page.", newRepoInfo.key);
                    main();
                } else if (!newRepoInfo && currentRepoInfo) {
                     // Navigated away from a repo page where we were showing info
                     log("Navigated away from repo page.");
                     currentRepoInfo = null; // Reset state
                     if (displayElement) {
                         displayElement.remove(); // Clean up old display element
                         displayElement = null;
                     }
                }
            }
        });

        // Start observing the body for changes in subtree and child list
        observer.observe(document.body, { childList: true, subtree: true });

        // Initial run in case the page is already loaded
         main();
    }


    // Make sure the DOM is ready before trying to find elements
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();