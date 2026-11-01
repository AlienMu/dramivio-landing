import { inferMediaKind, preloadMedia } from '../media/cache.js';
export class FirstScreenGate {
    stage;
    held = false;
    listeners = [];
    timer = 0;
    loaded = 0;
    total = 0;
    cancellation = new AbortController();
    constructor(stage, scene, timeoutMs){
        this.stage = stage;
        if (!scene?.hasAttribute('preload')) return;
        const waits = this.collect(scene);
        this.total = waits.length;
        if (!waits.length) return;
        this.held = true;
        for (const w of waits){
            void w.then(()=>{
                if (this.cancellation.signal.aborted) return;
                this.loaded++;
                this.stage.dispatchEvent(new CustomEvent('cv-progress', {
                    bubbles: true,
                    detail: {
                        kind: 'load',
                        progress: this.loaded / this.total,
                        loaded: this.loaded,
                        total: this.total
                    }
                }));
                if (this.loaded === this.total) this.release();
            });
        }
        this.timer = window.setTimeout(()=>this.timeout(), Math.max(0, timeoutMs));
    }
    whenReleased(fn) {
        if (!this.held) fn();
        else this.listeners.push(fn);
    }
    preempt() {
        clearTimeout(this.timer);
        this.held = false;
        this.listeners = [];
    }
    dispose() {
        this.cancellation.abort();
        this.preempt();
    }
    release() {
        if (!this.held || this.cancellation.signal.aborted) return;
        clearTimeout(this.timer);
        this.held = false;
        const listeners = this.listeners;
        this.listeners = [];
        for (const fn of listeners)fn();
    }
    timeout() {
        if (!this.held || this.cancellation.signal.aborted) return;
        const event = new CustomEvent('cv-timeout', {
            bubbles: true,
            cancelable: true,
            detail: {
                loaded: this.loaded,
                total: this.total
            }
        });
        if (this.stage.dispatchEvent(event)) this.release();
    }
    collect(scene) {
        const waits = [];
        for (const img of scene.querySelectorAll('img'))waits.push(this.image(img));
        for (const video of scene.querySelectorAll('video'))waits.push(this.video(video));
        const scrub = [
            ...scene.querySelectorAll('cv-video')
        ].map((v)=>v.getAttribute('src')).filter((src)=>!!src);
        const urls = (scene.getAttribute('preload') ?? '').split(/[\s,]+/).filter(Boolean);
        for (const url of new Set([
            ...scrub,
            ...urls.filter((u)=>inferMediaKind(u))
        ])){
            waits.push(preloadMedia(url, 'video').catch(()=>{
                if (!this.cancellation.signal.aborted) this.stage.report(`preload: video failed to load: ${url}`, undefined, 'asset-failed');
            }));
        }
        for (const url of urls){
            if (inferMediaKind(url)) continue;
            const img = new Image();
            img.src = url;
            waits.push(this.image(img));
        }
        return waits;
    }
    image(img) {
        if (img.loading === 'lazy') img.loading = 'eager';
        return img.decode().then(()=>undefined, ()=>{
            if (this.cancellation.signal.aborted || img.complete && img.naturalWidth > 0) return;
            this.stage.report(`preload: image failed to load: ${img.currentSrc || img.src}`, img, 'asset-failed');
        });
    }
    video(video) {
        if (video.readyState >= 2) return Promise.resolve();
        return new Promise((resolve)=>{
            const done = (failed)=>{
                video.removeEventListener('loadeddata', ok);
                video.removeEventListener('error', fail);
                this.cancellation.signal.removeEventListener('abort', ok);
                if (failed && !this.cancellation.signal.aborted) this.stage.report(`preload: video failed to load: ${video.currentSrc || video.src}`, video, 'asset-failed');
                resolve();
            };
            const ok = ()=>done(false);
            const fail = ()=>done(true);
            video.addEventListener('loadeddata', ok);
            video.addEventListener('error', fail);
            this.cancellation.signal.addEventListener('abort', ok, {
                once: true
            });
            if (video.preload === 'none') video.preload = 'auto';
            if (video.networkState === HTMLMediaElement.NETWORK_EMPTY) video.load();
        });
    }
}
