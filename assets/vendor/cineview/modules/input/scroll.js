import { rangeCss, viewProgress } from '../core/view.js';
import { blink, platform, whenIdle } from '../platform.js';
import { clearCover, COVER_RANGE, coverKeyframes, writeCover } from '../render/covered.js';
import { clearLayer, compositorLayer, layerKeyframes, progressIn, sceneKeyframes, writeLayer } from '../render/layers.js';
const GESTURE_QUIET_MS = 250;
import { EnterController, parseMargins } from './enter.js';
import { isSignal, Signals, writeSignal } from './signals.js';
const ATTACH_CHUNK = 96;
export const NATIVE_BUDGET = 256;
export class ScrollInput {
    scenes;
    stage;
    clock;
    native;
    vh = 0;
    vw = 0;
    unit = 1;
    docHeight = 0;
    raf = 0;
    destroyed = false;
    nativeIo = null;
    activeIo;
    centerIo;
    atCenter = new Set();
    ro;
    enter;
    pageTimeline = null;
    lastScroll = 0;
    deferred = 0;
    jsWork = null;
    live = 0;
    budget = blink ? NATIVE_BUDGET : Infinity;
    inView = new Set();
    inNative = new Set();
    stacks = [];
    held = new Set();
    covers = [];
    decks = [];
    tracks = [];
    signals = new Signals();
    signalWork = [];
    fullFrame = false;
    constructor(stage){
        this.stage = stage;
        this.scenes = stage.ordered;
        this.clock = stage.clock;
        this.native = !stage.hasAttribute('fallback') && typeof platform.ViewTimeline === 'function';
        const gate = stage.firstScreen;
        this.enter = new EnterController(this.clock, {
            held: ()=>gate?.held ?? false,
            offset: stage.bootOffset,
            shown: stage.shown
        });
        if (gate?.held) {
            gate.whenReleased(()=>{
                if (!this.destroyed) this.queueFrame();
            });
        }
        for (const s of this.scenes)s.frameTime = Number.NaN;
        this.scenes.forEach((s, i)=>{
            const next = this.scenes[i + 1];
            if (!s.isStacked || !next) return;
            this.stacks.push({
                s,
                next
            });
            this.held.add(s);
        });
        for (const { s, next } of this.stacks){
            if (s.cover) this.covers.push({
                s,
                next,
                look: s.cover,
                natives: []
            });
        }
        for (const s of this.scenes){
            for (const a of s.ordered)if (isDeck(a)) this.decks.push({
                s,
                k: a
            });
            if (s.isTrack && s.travel > 0) this.tracks.push({
                s,
                native: null
            });
        }
        this.refresh();
        if (this.native) this.startNative();
        this.bindEnter();
        window.addEventListener('scroll', this.onScroll, {
            passive: true
        });
        window.addEventListener('resize', this.onResize, {
            passive: true
        });
        window.addEventListener('load', this.onLoad);
        document.fonts?.ready.then(this.onLoad, ()=>undefined);
        this.ro = new ResizeObserver(()=>this.onResize());
        for (const s of this.scenes)this.ro.observe(s);
        this.activeIo = new IntersectionObserver((entries)=>{
            if (this.destroyed) return;
            for (const entry of entries){
                const s = entry.target;
                if (entry.isIntersecting) this.inView.add(s);
                else this.inView.delete(s);
                this.activate(s);
            }
        }, {
            rootMargin: '100% 0px 100% 0px'
        });
        for (const s of this.scenes)this.activeIo.observe(s);
        this.centerIo = new IntersectionObserver((entries)=>{
            if (this.destroyed) return;
            for (const entry of entries){
                const i = this.scenes.indexOf(entry.target);
                if (entry.isIntersecting) this.atCenter.add(i);
                else this.atCenter.delete(i);
            }
            if (this.atCenter.size) this.stage.setCurrent(Math.max(...this.atCenter));
            else if (this.stage.current < 0) this.stage.setCurrent(this.currentIndex());
        }, {
            rootMargin: '-50% 0px -50% 0px'
        });
        for (const s of this.scenes)this.centerIo.observe(s);
        this.frame();
    }
    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        cancelAnimationFrame(this.raf);
        this.raf = 0;
        this.fullFrame = false;
        window.removeEventListener('scroll', this.onScroll);
        window.removeEventListener('resize', this.onResize);
        window.removeEventListener('load', this.onLoad);
        clearTimeout(this.deferred);
        this.nativeIo?.disconnect();
        this.activeIo.disconnect();
        this.centerIo.disconnect();
        this.ro.disconnect();
        this.enter.destroy();
        for (const s of this.scenes){
            this.detachNative(s);
            s.timeline = null;
            s.active = false;
            s.covered = false;
            s.removeAttribute('data-cv-covered');
            s.removeAttribute('data-cv-stuck');
            s.style.visibility = '';
        }
        for (const { s } of this.stacks){
            s.style.position = '';
            s.style.top = '';
        }
        for (const c of this.covers){
            for (const n of c.natives)n.cancel();
            c.s.coverProgress = Number.NaN;
            clearCover(c.s, c.s.veil);
        }
        for (const { k } of this.decks)k.clearWrites();
        for (const track of this.tracks){
            track.native?.cancel();
            track.s.clearTrack();
        }
    }
    refresh() {
        this.stage.sizeFrame();
        this.vh = window.innerHeight;
        this.vw = window.innerWidth;
        const design = Number(this.stage.getAttribute('design-width')) || 750;
        this.unit = (this.stage.clientWidth || this.vw) / design;
        this.docHeight = document.documentElement.scrollHeight;
        const y = window.scrollY;
        for (const { s } of this.stacks){
            s.style.position = '';
            s.style.top = '';
        }
        for (const { s, look } of this.covers){
            if (look.scale !== 1) s.style.setProperty('scale', 'none', 'important');
        }
        for (const s of this.scenes){
            const r = s.getBoundingClientRect();
            s.docTop = r.top + y;
            s.height = r.height;
        }
        for (const { s, k } of this.decks){
            if (k.dealt) k.measureDealt(s.shell.getBoundingClientRect().top, this.vh);
            else k.measureFlow(y);
        }
        for (const { s, look } of this.covers){
            if (look.scale === 1) continue;
            s.style.removeProperty('scale');
            s.coverProgress = Number.NaN;
        }
        this.jsWork = null;
        for (const { s } of this.stacks){
            s.style.position = 'sticky';
            s.style.top = s.isZone ? `${-s.solution.total}px` : `min(0px, calc(100svh - ${s.height}px))`;
        }
    }
    goTo(index, options = {}) {
        if (this.destroyed) return;
        const scene = this.scenes[Math.max(0, Math.min(this.scenes.length - 1, Math.round(index)))];
        if (scene) window.scrollTo({
            top: scene.docTop,
            behavior: options.animated === false ? 'instant' : 'smooth'
        });
    }
    currentIndex() {
        const y = window.scrollY + this.vh / 2;
        let index = 0;
        this.scenes.forEach((s, i)=>{
            if (s.docTop <= y) index = i;
        });
        return index;
    }
    onResize = ()=>{
        if (this.destroyed) return;
        if (window.innerWidth === this.vw && performance.now() - this.lastScroll < GESTURE_QUIET_MS) {
            clearTimeout(this.deferred);
            this.deferred = window.setTimeout(this.onResize, GESTURE_QUIET_MS);
            return;
        }
        this.refresh();
        this.queueFrame();
    };
    onLoad = ()=>{
        if (this.destroyed) return;
        this.refresh();
        this.queueFrame();
    };
    onScroll = ()=>{
        if (this.destroyed) return;
        const now = performance.now();
        this.lastScroll = now;
        const y = window.scrollY;
        if (this.signals.sample(y, now)) {
            this.stage.setHeading(this.signals.heading > 0 ? 'forward' : 'backward');
        }
        this.zoneWork(y);
        this.stackWork(y);
        if (this.native && !this.hasJsWork()) return;
        this.queueFrame();
    };
    hasJsWork() {
        if (this.jsWork !== null) return this.jsWork;
        this.jsWork = this.enter.size > 0 || this.covers.some((c)=>!c.natives.length) || this.decks.some(({ k })=>k.dealt || k.followsScroll) || this.tracks.some((track)=>!track.native) || this.scenes.some((s)=>s.ordered.some((a)=>s.isZone && a.loopItems.length > 0 || a.layers.some((l)=>!l.native && (l.source === 'scene' || l.source === 'view' || l.source === 'page' || isSignal(l.source)))));
        return this.jsWork;
    }
    queueFrame(settle = false) {
        if (this.destroyed) return;
        if (!settle) this.fullFrame = true;
        if (this.raf) return;
        this.raf = requestAnimationFrame(()=>{
            this.raf = 0;
            if (this.destroyed) return;
            const full = this.fullFrame;
            this.fullFrame = false;
            if (full) this.frame();
            else this.settle();
        });
    }
    settle() {
        this.signals.step(performance.now());
        for (const layer of this.signalWork)writeSignal(layer, this.signals);
        if (this.signalWork.length && !this.signals.resting) this.queueFrame(true);
    }
    frame() {
        const y = window.scrollY;
        const vh = this.vh;
        const work = [];
        const signalWork = [];
        const loops = [];
        const rects = new Map();
        const isNear = (s)=>s.docTop < y + vh * 2 && s.docTop + s.height > y - vh;
        const gated = this.enter.measure((a)=>a.scene !== null && isNear(a.scene) && !a.scene.covered);
        const page = Math.min(Math.max(y / Math.max(1, this.docHeight - vh), 0), 1);
        const lenses = new Map();
        const lens = (s)=>{
            if (!s.cover || s.cover.scale === 1) return null;
            let l = lenses.get(s);
            if (l === undefined) {
                const k = parseFloat(getComputedStyle(s).scale) || 1;
                let r = rects.get(s);
                if (!r) rects.set(s, r = s.getBoundingClientRect());
                const o = Math.max(s.height / 2, s.height - vh / 2);
                l = k === 1 ? null : {
                    origin: r.top + o * k,
                    k
                };
                lenses.set(s, l);
            }
            return l;
        };
        for (const s of this.scenes){
            if (!isNear(s) || s.covered) {
                if (s.isZone) {
                    for (const a of s.ordered)if (a.looping) loops.push({
                        a,
                        on: false
                    });
                }
                continue;
            }
            const zone = s.isZone;
            const t = zone ? Math.min(Math.max(y - s.docTop, 0), s.solution.total) : 0;
            for (const a of s.ordered){
                if (zone && a.loopItems.length && (!a.clocked || a.timed)) loops.push({
                    a,
                    on: (!a.solved || t >= a.solved.end) && (!a.clocked || a.clockComplete)
                });
                for (const layer of a.layers){
                    if (layer.native) continue;
                    if (layer.source === 'scene') {
                        const w = layer.window;
                        if (!w) continue;
                        work.push({
                            layer,
                            p: progressIn(t, w.start, w.end),
                            px: layer.exitEffects.length ? progressIn(t, w.exitStart, w.exitEnd) : 0
                        });
                    } else if (layer.source === 'view') {
                        const subject = a.viewSubject(layer);
                        let top = s.docTop - y;
                        let height = s.height;
                        if (subject !== s || this.held.has(s)) {
                            let r = rects.get(subject);
                            if (!r) rects.set(subject, r = subject.getBoundingClientRect());
                            const l = this.held.has(s) ? lens(s) : null;
                            top = l ? l.origin + (r.top - l.origin) / l.k : r.top;
                            height = l ? r.height / l.k : r.height;
                        }
                        work.push({
                            layer,
                            p: viewProgress(top, height, vh, layer.range),
                            px: 0
                        });
                    } else if (layer.source === 'page') {
                        work.push({
                            layer,
                            p: page,
                            px: 0
                        });
                    } else if (isSignal(layer.source)) {
                        signalWork.push(layer);
                    }
                }
            }
        }
        const covers = [];
        for (const { s, next, look, natives } of this.covers){
            if (natives.length || s.covered) continue;
            const p = viewProgress(next.docTop - y, next.height, vh, COVER_RANGE);
            if (p !== s.coverProgress) covers.push({
                s,
                look,
                p
            });
        }
        const decks = [];
        for (const { s, k } of this.decks){
            if (!isNear(s) || s.covered || !(k.dealt || k.followsScroll)) continue;
            decks.push({
                k,
                at: k.dealt ? Math.min(Math.max(y - s.docTop, 0), s.solution.total) : y
            });
        }
        const rows = [];
        for (const { s, native } of this.tracks){
            if (native || !isNear(s) || s.covered) continue;
            rows.push({
                s,
                t: Math.min(Math.max(y - s.docTop, 0), s.solution.total)
            });
        }
        for (const w of work)writeLayer(w.layer, w.p, w.px);
        this.signalWork = signalWork;
        this.signals.step(performance.now());
        for (const layer of signalWork)writeSignal(layer, this.signals);
        for (const { s, t } of rows)s.writeTrack(t);
        for (const { k, at } of decks){
            if (k.dealt) k.writeTime(at);
            else k.writeScroll(at);
        }
        for (const { s, look, p } of covers){
            s.coverProgress = p;
            writeCover(s, s.veil, look, p);
        }
        this.enter.apply(gated, vh, this.unit);
        for (const { a, on } of loops){
            if (on) a.startLoops(this.clock);
            else a.stopLoops();
        }
        this.zoneWork(y);
        this.stackWork(y);
        if (signalWork.length && !this.signals.resting) this.queueFrame(true);
    }
    stackWork(y = window.scrollY) {
        for (const { s, next } of this.stacks){
            const held = s.docTop + (s.isZone ? 0 : Math.max(0, s.height - this.vh));
            s.toggleAttribute('data-cv-stuck', y > held + 0.5 && y < next.docTop - 0.5);
            const covered = y >= next.docTop - 0.5;
            if (covered === s.covered) continue;
            s.covered = covered;
            s.toggleAttribute('data-cv-covered', covered);
            s.style.visibility = covered ? 'hidden' : '';
            if (covered) for (const a of s.ordered)a.stopLoops();
            this.activate(s);
            if (this.native) {
                if (!covered && this.inNative.has(s)) this.attachNative(s);
                else this.detachNative(s);
                this.refill();
            }
            this.queueFrame();
        }
    }
    activate(s) {
        const on = this.inView.has(s) && !s.covered;
        s.toggleAttribute('data-cv-active', on);
        if (on === s.active) return;
        s.active = on;
        if (!on) for (const a of s.ordered)a.stopLoops();
        for (const a of s.ordered)a.activated(on);
        s.dispatchEvent(new CustomEvent(on ? 'cv-activate' : 'cv-deactivate', {
            bubbles: true
        }));
    }
    zoneWork(y = window.scrollY) {
        this.scenes.forEach((s, index)=>{
            if (!s.isZone) return;
            const t = Math.min(Math.max(y - s.docTop, 0), s.solution.total);
            if (t !== s.frameTime) {
                s.frameTime = t;
                for (const a of s.ordered){
                    if (!a.timed) continue;
                    if (a.subscribed) a.sendFrame(zoneFrame(a, t));
                    else a.showPhase(zonePhase(a, t));
                }
            }
            reportZone(s, index, t);
        });
    }
    frameOf(a) {
        const s = a.scene;
        if (!s?.isZone || this.destroyed || !a.timed) return null;
        return zoneFrame(a, Math.min(Math.max(window.scrollY - s.docTop, 0), s.solution.total));
    }
    startNative() {
        const VT = platform.ViewTimeline;
        for (const s of this.scenes)s.timeline = new VT({
            subject: s,
            axis: 'block'
        });
        const ST = platform.ScrollTimeline;
        if (ST) this.pageTimeline = new ST({
            source: document.documentElement,
            axis: 'block'
        });
        for (const c of this.covers){
            if (this.held.has(c.next)) continue;
            const frames = coverKeyframes(c.look);
            const options = {
                timeline: c.next.timeline,
                ...rangeCss(COVER_RANGE),
                fill: 'both',
                easing: 'linear'
            };
            c.natives.push(c.s.veil.animate(frames.veil, options));
            if (frames.host) c.natives.push(c.s.animate(frames.host, options));
        }
        const y = window.scrollY;
        for (const track of this.tracks){
            const { s } = track;
            const total = s.solution.total;
            const end = `${-s.travel}px 0px`;
            const frames = [
                {
                    offset: 0,
                    translate: '0px 0px'
                }
            ];
            if (s.travel < total) frames.push({
                offset: s.travel / total,
                translate: end
            });
            frames.push({
                offset: 1,
                translate: end
            });
            s.writeTrack(Math.min(Math.max(y - s.docTop, 0), total));
            track.native = s.track.animate(frames, {
                timeline: s.timeline,
                rangeStart: 'contain 0%',
                rangeEnd: 'contain 100%',
                fill: 'both',
                easing: 'linear'
            });
        }
        this.nativeIo = new IntersectionObserver((entries)=>{
            if (this.destroyed) return;
            for (const entry of entries){
                const s = entry.target;
                if (entry.isIntersecting) this.inNative.add(s);
                else this.inNative.delete(s);
                if (entry.isIntersecting && !s.covered) this.attachNative(s);
                else if (s.nativeAttached) this.detachNative(s);
            }
            this.refill();
        }, {
            rootMargin: '200% 0px 200% 0px'
        });
        for (const s of this.scenes)this.nativeIo.observe(s);
    }
    nativeView(s, layer) {
        if (this.held.has(s)) return false;
        return !s.isZone || layer.subject === 'scene';
    }
    pendingNative(s) {
        const out = [];
        for (const a of s.ordered){
            for (const layer of a.layers){
                if (layer.native || !compositorLayer(layer)) continue;
                if (layer.source === 'scene' && s.isZone && layer.window || layer.source === 'view' && this.nativeView(s, layer) || layer.source === 'page' && this.pageTimeline) {
                    out.push({
                        a,
                        layer
                    });
                }
            }
        }
        return out;
    }
    attachNative(s) {
        if (this.destroyed || s.nativeAttached && !s.nativePending) return;
        s.nativeAttached = true;
        s.nativePending = false;
        const generation = ++s.nativeGeneration;
        const VT = platform.ViewTimeline;
        const jobs = this.pendingNative(s);
        const step = (deadline)=>{
            if (this.destroyed || !s.nativeAttached || s.nativeGeneration !== generation) return;
            let made = 0;
            while(jobs.length && (deadline ? deadline.timeRemaining() > 2 : made < ATTACH_CHUNK)){
                if (this.live >= this.budget) {
                    s.nativePending = true;
                    break;
                }
                const { a, layer } = jobs.shift();
                if (layer.native) continue;
                const w = layer.window;
                const zone = layer.source === 'scene' && w !== null;
                const page = layer.source === 'page';
                const subject = zone || page ? s : a.viewSubject(layer);
                const timeline = zone ? s.timeline : page ? this.pageTimeline : subject === s ? s.timeline : new VT({
                    subject,
                    axis: 'block'
                });
                const keyframes = zone ? sceneKeyframes(layer, w, s.solution.total) : layerKeyframes(layer);
                const native = layer.el.animate(keyframes, {
                    timeline,
                    ...page ? {} : zone ? {
                        rangeStart: 'contain 0%',
                        rangeEnd: 'contain 100%'
                    } : rangeCss(layer.range),
                    fill: 'both',
                    easing: 'linear'
                });
                layer.native = native;
                void native.ready.then(()=>layer.native === native && clearLayer(layer), ()=>undefined);
                a.natives.push(native);
                this.live++;
                made++;
            }
            this.jsWork = null;
            if (jobs.length && !s.nativePending) whenIdle(step);
        };
        whenIdle(step);
    }
    detachNative(s) {
        s.nativeAttached = false;
        s.nativePending = false;
        s.nativeGeneration++;
        this.jsWork = null;
        for (const a of s.ordered){
            for (const layer of a.layers){
                if (!layer.native) continue;
                layer.native.cancel();
                layer.native = null;
                this.live--;
            }
            a.natives = a.natives.filter((n)=>n.playState !== 'idle');
        }
        this.queueFrame();
    }
    refill() {
        if (this.live >= this.budget) return;
        const y = window.scrollY;
        const waiting = this.scenes.filter((s)=>s.nativeAttached && s.nativePending).sort((p, q)=>Math.abs(p.docTop - y) - Math.abs(q.docTop - y));
        for (const s of waiting)this.attachNative(s);
    }
    bindEnter() {
        const margins = parseMargins(this.stage.getAttribute('margin'), [
            50,
            50
        ]);
        this.scenes.forEach((s, i)=>{
            if (s.isZone) return;
            for (const a of s.ordered)this.enter.add(a, {
                first: i === 0,
                margins
            });
        });
        this.enter.link();
    }
}
const isDeck = (a)=>a.localName === 'cv-stack';
function reportZone(s, index, t) {
    const total = s.solution.total;
    if (!s.isStacked) s.toggleAttribute('data-cv-stuck', t > 0.5 && t < total - 0.5);
    const last = s.zoneTime;
    const atEnd = t === 0 || t === total;
    if (!Number.isNaN(last) && Math.abs(t - last) <= 0.5 && !(atEnd && t !== last)) return;
    s.zoneTime = t;
    s.dispatchEvent(new CustomEvent('cv-progress', {
        bubbles: true,
        detail: {
            kind: 'zone',
            index,
            progress: total > 0 ? t / total : 0
        }
    }));
}
function zonePhase(a, t) {
    const w = a.solved;
    if (!w) return 'idle';
    if (w.exitDuration > 0 && t > w.exitStart) {
        return progressIn(t, w.exitStart, w.exitEnd) >= 1 ? 'exited' : 'exiting';
    }
    return progressIn(t, w.start, w.end) >= 1 ? 'entered' : 'entering';
}
function zoneFrame(a, t) {
    const w = a.solved;
    if (!w) return {
        progress: 0,
        signedProgress: 0,
        phase: 'idle',
        source: 'scroll'
    };
    if (w.exitDuration > 0 && t > w.exitStart) {
        const px = progressIn(t, w.exitStart, w.exitEnd);
        return {
            progress: px,
            signedProgress: px,
            phase: px >= 1 ? 'exited' : 'exiting',
            source: 'scroll'
        };
    }
    const p = progressIn(t, w.start, w.end);
    return {
        progress: p,
        signedProgress: p,
        phase: p >= 1 ? 'entered' : 'entering',
        source: 'scroll'
    };
}
