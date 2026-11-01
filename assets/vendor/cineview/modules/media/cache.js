const DEFAULT_BYTE_BUDGET = 128 * 1024 * 1024;
const cache = new Map();
const readyUrls = new Set();
const inflight = new Map();
const listeners = new Set();
const activeLeases = new Map();
let byteBudget = DEFAULT_BYTE_BUDGET;
let totalBytes = 0;
const VIDEO_EXT = /\.(mp4|webm|mov|m4v|ogv|ogg)(\?|#|$)/i;
export function inferMediaKind(src) {
    return VIDEO_EXT.test(src) ? 'video' : null;
}
export function isMediaPreloaded(src) {
    return src.length > 0 && readyUrls.has(src);
}
export function getVideoObjectUrl(src) {
    const entry = cache.get(src);
    if (entry) {
        touch(src);
        return entry.objectUrl;
    }
    return undefined;
}
export function subscribeToPreloadedMedia(listener) {
    listeners.add(listener);
    return ()=>{
        listeners.delete(listener);
    };
}
function notify(src) {
    const hadUrl = readyUrls.has(src);
    readyUrls.add(src);
    if (!hadUrl) {
        listeners.forEach((listener)=>listener(src));
    }
}
function touch(src) {
    const entry = cache.get(src);
    if (entry) {
        cache.delete(src);
        cache.set(src, entry);
    }
}
function revoke(objectUrl) {
    if (typeof URL !== 'undefined' && URL.revokeObjectURL) {
        URL.revokeObjectURL(objectUrl);
    }
}
function evictToBudget(protect) {
    for (const [src, entry] of cache){
        if (totalBytes <= byteBudget) {
            break;
        }
        if (src === protect || (activeLeases.get(src) ?? 0) > 0) {
            continue;
        }
        cache.delete(src);
        readyUrls.delete(src);
        totalBytes -= entry.bytes;
        revoke(entry.objectUrl);
    }
}
export function acquireVideoObjectUrl(src) {
    const entry = cache.get(src);
    if (!entry) {
        return undefined;
    }
    touch(src);
    activeLeases.set(src, (activeLeases.get(src) ?? 0) + 1);
    return entry.objectUrl;
}
export function releaseVideoObjectUrl(src) {
    const count = activeLeases.get(src) ?? 0;
    if (count <= 1) {
        activeLeases.delete(src);
    } else {
        activeLeases.set(src, count - 1);
    }
    evictToBudget('');
}
function insert(src, entry) {
    const existing = cache.get(src);
    if (existing) {
        totalBytes -= existing.bytes;
        revoke(existing.objectUrl);
    }
    cache.set(src, entry);
    totalBytes += entry.bytes;
    evictToBudget(src);
}
const VIDEO_FETCH_TIMEOUT_MS = 30_000;
async function runVideoPreload(src) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutTimer = controller ? setTimeout(()=>controller.abort(), VIDEO_FETCH_TIMEOUT_MS) : null;
    try {
        const response = await fetch(src, controller ? {
            signal: controller.signal
        } : undefined);
        if (!response.ok) {
            throw new Error(`Failed to preload media: ${src} (HTTP ${response.status})`);
        }
        const blob = await response.blob();
        if (!blob) {
            throw new Error(`Invalid blob response for media: ${src}`);
        }
        const objectUrl = URL.createObjectURL(blob);
        insert(src, {
            kind: 'video',
            objectUrl,
            bytes: blob.size
        });
        notify(src);
    } catch (error) {
        if (controller?.signal.aborted) {
            const timeoutError = new Error(`Media preload timed out after ${VIDEO_FETCH_TIMEOUT_MS}ms: ${src}`);
            timeoutError.cause = error;
            throw timeoutError;
        }
        throw error;
    } finally{
        if (timeoutTimer !== null) {
            clearTimeout(timeoutTimer);
        }
    }
}
export function preloadMedia(src, kind) {
    if (!src) {
        return Promise.resolve();
    }
    if (readyUrls.has(src)) {
        return Promise.resolve();
    }
    const existing = inflight.get(src);
    if (existing) {
        return existing;
    }
    if (typeof fetch === 'undefined') {
        return Promise.reject(new Error('preloadMedia requires fetch (client-side only)'));
    }
    const resolvedKind = kind ?? inferMediaKind(src);
    if (!resolvedKind) {
        return Promise.reject(new Error(`Cannot determine media type: ${src} (pass explicit kind)`));
    }
    const tracked = runVideoPreload(src).finally(()=>{
        inflight.delete(src);
    });
    inflight.set(src, tracked);
    return tracked;
}
export function setMediaByteBudget(bytes) {
    byteBudget = Math.max(0, bytes);
    evictToBudget('');
}
export function resetMediaPreloadCache() {
    for (const entry of cache.values()){
        revoke(entry.objectUrl);
    }
    cache.clear();
    readyUrls.clear();
    inflight.clear();
    listeners.clear();
    activeLeases.clear();
    totalBytes = 0;
    byteBudget = DEFAULT_BYTE_BUDGET;
}
