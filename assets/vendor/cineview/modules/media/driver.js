import { IDLE_FRAME } from '../core/timeline.js';
import { warn } from '../dev/warn.js';
import { acquireVideoObjectUrl, isMediaPreloaded, preloadMedia, releaseVideoObjectUrl, subscribeToPreloadedMedia } from './cache.js';
import { createVideoPlaybackOwnershipState, reduceVideoPlaybackOwnership } from './ownership.js';
const SLOW_SCRUB_SEEK_MS = 50;
const SCRUB_SAMPLE_MIN = 6;
const warnedSrcs = new Set();
const FORWARDED = [
    'play',
    'pause',
    'ended'
];
export class VideoDriver {
    host;
    video = null;
    options = {
        src: '',
        preload: true,
        poster: null,
        playbackRate: 1,
        label: null,
        range: undefined
    };
    objectUrl = null;
    leasedSrc = null;
    unsubscribe = ()=>undefined;
    generation = 0;
    activationId = 0;
    readyGeneration = null;
    ownership = createVideoPlaybackOwnershipState(0);
    pending;
    latest = IDLE_FRAME;
    pendingRestore = null;
    released = false;
    seekSamples = [];
    unbind = ()=>undefined;
    accepted = new WeakSet();
    sceneActive = null;
    failed = null;
    container = null;
    constructor(host){
        this.host = host;
    }
    place(container) {
        this.container = container;
        if (this.video && this.video.parentNode !== container) container.prepend(this.video);
    }
    configure(options) {
        const previous = this.options;
        this.options = options;
        if (options.src !== previous.src || !this.video) {
            this.setSource(options.src);
            return;
        }
        const video = this.video;
        video.playbackRate = options.playbackRate;
        if (options.poster) video.poster = options.poster;
        else video.removeAttribute('poster');
        if (options.label) video.setAttribute('aria-label', options.label);
        else video.removeAttribute('aria-label');
        if (options.preload && !previous.preload) this.warmCache();
        if (options.range?.[0] !== previous.range?.[0] || options.range?.[1] !== previous.range?.[1]) {
            this.publish(this.latest);
        }
    }
    frame(frame) {
        this.publish(frame);
    }
    get scrubbed() {
        return this.ownership.lastSeekTime !== null;
    }
    release() {
        if (this.released) return;
        const video = this.video;
        if (video) {
            video.pause();
            video.removeAttribute('src');
            video.load();
        }
        this.released = true;
        this.resetOwnership(false);
        this.mount();
    }
    warmUp() {
        if (!this.released) return;
        this.released = false;
        this.resetOwnership(false);
        this.mount();
    }
    destroy() {
        this.unbind();
        this.unsubscribe();
        if (this.leasedSrc) releaseVideoObjectUrl(this.leasedSrc);
        this.leasedSrc = null;
        this.video?.pause();
        this.video?.remove();
        this.video = null;
    }
    setSource(src) {
        this.unsubscribe();
        this.unsubscribe = ()=>undefined;
        if (this.leasedSrc) releaseVideoObjectUrl(this.leasedSrc);
        this.leasedSrc = null;
        this.released = false;
        this.objectUrl = null;
        if (src && typeof window !== 'undefined') {
            if (!this.lease(src)) {
                this.unsubscribe = subscribeToPreloadedMedia((ready)=>{
                    if (ready !== src || this.options.src !== src || this.leasedSrc) return;
                    const snapshot = this.snapshot();
                    if (this.lease(src)) this.identityChanged(snapshot);
                });
            }
            this.warmCache();
        }
        this.identityChanged(null);
    }
    lease(src) {
        const url = acquireVideoObjectUrl(src);
        if (!url) return false;
        this.leasedSrc = src;
        this.objectUrl = url;
        return true;
    }
    warmCache() {
        const src = this.options.src;
        if (!src || !this.options.preload || isMediaPreloaded(src)) return;
        preloadMedia(src, 'video').catch(()=>undefined);
    }
    snapshot() {
        const video = this.video;
        const status = this.ownership.status;
        const nativeOwned = status === 'native-playback' || status === 'native-paused' || status === 'play-pending' || status === 'ended';
        return video && video.readyState >= 2 && nativeOwned ? {
            generation: this.generation,
            time: video.currentTime,
            playing: !video.paused,
            ended: video.ended
        } : null;
    }
    identityChanged(snapshot) {
        this.pendingRestore = snapshot?.generation === this.generation ? snapshot : null;
        this.generation++;
        this.readyGeneration = null;
        this.resetOwnership(false);
        this.mount();
    }
    mount() {
        this.unbind();
        const old = this.video;
        const video = document.createElement('video');
        const { src, preload, poster, playbackRate, label } = this.options;
        video.setAttribute('part', 'video');
        video.muted = true;
        video.defaultMuted = true;
        video.playsInline = true;
        video.setAttribute('playsinline', '');
        video.preload = this.released ? 'none' : preload ? 'auto' : 'metadata';
        if (poster) video.poster = poster;
        if (label) video.setAttribute('aria-label', label);
        if (!this.released && (this.objectUrl ?? src)) video.src = this.objectUrl ?? src;
        video.playbackRate = playbackRate;
        if (old?.parentNode) old.replaceWith(video);
        else this.container?.prepend(video);
        if (old) {
            old.pause();
            old.removeAttribute('src');
            old.load();
        }
        this.video = video;
        this.bind(video);
    }
    resetOwnership(rebind) {
        this.activationId++;
        this.ownership = reduceVideoPlaybackOwnership(this.ownership, {
            type: 'reset',
            activationId: this.activationId
        }).state;
        this.pending = undefined;
        this.seekSamples = [];
        if (rebind && this.video) {
            this.unbind();
            this.bind(this.video);
        }
    }
    bind(video) {
        const generation = this.generation;
        const activationId = this.activationId;
        const isCurrent = ()=>this.video === video && this.activationId === activationId && this.generation === generation;
        const isReady = ()=>isCurrent() && this.readyGeneration === generation;
        if (video.readyState >= 1) this.readyGeneration = generation;
        const loadStart = ()=>{
            if (isCurrent()) this.readyGeneration = generation;
        };
        const play = (event)=>{
            if (!isReady()) return;
            const pending = this.pending;
            const requestId = pending?.generation === generation && pending.activationId === activationId ? pending.requestId : undefined;
            const o = this.ownership;
            const taggedAccepted = requestId !== undefined && (!o.frameworkPlayBlocked && o.activePlayRequestId === requestId || o.status === 'native-playback' && !o.frameworkPlayBlocked && o.settledPlayRequestId === requestId);
            const untaggedAccepted = requestId === undefined && !o.frameworkPlayBlocked;
            if (requestId !== undefined) this.pending = undefined;
            if (taggedAccepted || untaggedAccepted) this.accepted.add(event);
            this.dispatch({
                type: 'media-play',
                requestId,
                activationId
            });
        };
        const pause = (event)=>{
            if (!isReady()) return;
            if (!this.ownership.frameworkPausePending) this.pending = undefined;
            this.accepted.add(event);
            this.dispatch({
                type: 'media-pause',
                activationId
            });
        };
        const ended = (event)=>{
            if (!isReady()) return;
            this.accepted.add(event);
            this.dispatch({
                type: 'media-ended',
                activationId
            });
        };
        const forward = (event)=>{
            if (!this.accepted.has(event)) return;
            this.accepted.delete(event);
            if (!isCurrent()) return;
            this.host.dispatchEvent(new Event(event.type));
        };
        const metadata = ()=>{
            if (isCurrent()) this.publishLatest();
        };
        const error = ()=>{
            if (this.video !== video || this.generation !== generation || !video.error) return;
            this.host.dispatchEvent(new Event('error'));
            this.failed?.(video.currentSrc || video.src);
        };
        video.addEventListener('loadstart', loadStart, true);
        video.addEventListener('play', play, true);
        video.addEventListener('pause', pause, true);
        video.addEventListener('ended', ended, true);
        for (const type of FORWARDED)video.addEventListener(type, forward);
        video.addEventListener('loadedmetadata', metadata);
        video.addEventListener('error', error);
        if (video.readyState >= 1) queueMicrotask(metadata);
        this.unbind = ()=>{
            video.removeEventListener('loadstart', loadStart, true);
            video.removeEventListener('play', play, true);
            video.removeEventListener('pause', pause, true);
            video.removeEventListener('ended', ended, true);
            for (const type of FORWARDED)video.removeEventListener(type, forward);
            video.removeEventListener('loadedmetadata', metadata);
            video.removeEventListener('error', error);
            this.unbind = ()=>undefined;
        };
    }
    publishLatest() {
        const video = this.video;
        if (!video) return;
        const restore = this.pendingRestore;
        if (restore) {
            this.pendingRestore = null;
            const phase = this.latest.phase;
            this.dispatch({
                type: 'restore-native',
                time: Math.min(restore.time, video.duration),
                playing: restore.playing && this.sceneActive?.() !== false && phase !== 'exiting' && phase !== 'exited',
                ended: restore.ended
            });
        }
        this.publish(this.latest);
    }
    publish(frame) {
        const previous = this.latest;
        this.latest = frame;
        const video = this.video;
        if (!video) return;
        const o = this.ownership;
        const dragSceneActive = this.sceneActive?.();
        const cancelledDeparture = dragSceneActive === true && previous.phase === 'exiting' && o.outgoing !== null;
        if (frame.phase === 'entering' && (o.status === 'ended' || o.outgoing) && !cancelledDeparture) {
            this.activationId++;
            this.ownership = reduceVideoPlaybackOwnership(this.ownership, {
                type: 'activate',
                activationId: this.activationId
            }).state;
            this.pending = undefined;
            this.mount();
            return;
        }
        if (!Number.isFinite(video.duration) || video.duration <= 0) return;
        this.dispatch({
            type: 'timeline-frame',
            frame,
            duration: video.duration,
            currentTime: video.currentTime,
            dragSceneActive,
            scrubRange: this.options.range
        });
    }
    dispatch(event) {
        const video = this.video;
        if (!video) return;
        const next = reduceVideoPlaybackOwnership(this.ownership, event);
        this.ownership = next.state;
        for (const command of next.commands)this.execute(video, command);
    }
    execute(video, command) {
        switch(command.type){
            case 'pause':
                video.pause();
                return;
            case 'seek':
                this.seek(video, command.time);
                return;
            case 'play':
                {
                    const request = {
                        requestId: command.requestId,
                        generation: this.generation,
                        activationId: this.ownership.activationId,
                        settled: false
                    };
                    this.pending = request;
                    const settle = (type)=>{
                        if (this.pending !== request || request.settled) return;
                        request.settled = true;
                        if (type === 'play-rejected') this.pending = undefined;
                        if (this.generation !== request.generation || this.ownership.activationId !== request.activationId) {
                            this.pending = undefined;
                            return;
                        }
                        this.dispatch({
                            type,
                            requestId: command.requestId
                        });
                    };
                    let result;
                    try {
                        result = video.play();
                    } catch  {
                        settle('play-rejected');
                        return;
                    }
                    void Promise.resolve(result).then(()=>settle('play-resolved'), ()=>settle('play-rejected'));
                    return;
                }
        }
    }
    seek(video, time) {
        const src = this.options.src;
        if (false && !warnedSrcs.has(src)) {
            const startedAt = performance.now();
            video.addEventListener('seeked', ()=>{
                const samples = this.seekSamples;
                samples.push(performance.now() - startedAt);
                if (samples.length < SCRUB_SAMPLE_MIN || warnedSrcs.has(src)) return;
                const median = [
                    ...samples
                ].sort((a, b)=>a - b)[samples.length >> 1];
                if (median > SLOW_SCRUB_SEEK_MS) {
                    warnedSrcs.add(src);
                    warn(this.host, `scrub seeks are slow (median ${median.toFixed(0)} ms) for "${src}": the video has sparse keyframes. Re-encode it as all-keyframe, e.g. ffmpeg -i in.mp4 -g 1 -keyint_min 1 -c:v libx264 out.mp4`);
                }
            }, {
                once: true
            });
        }
        video.currentTime = time;
    }
}
