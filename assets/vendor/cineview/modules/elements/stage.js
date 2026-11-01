import { FirstScreenGate } from '../assets/first-screen.js';
import { adoptBoot, shownBeforeRuntime } from '../boot.js';
import { onEffectDefined } from '../core/fx.js';
import { checkDragScene, checkStage } from '../dev/craft.js';
import { ScrollInput } from '../input/scroll.js';
import { loadStills, stillsModule, usesStills } from '../media/load-stills.js';
import { ElementBase, onReducedMotionChange, prefersReducedMotion } from '../platform.js';
import { EnterController, forgetRetainedRun } from '../input/enter.js';
import { Clock } from '../render/clock.js';
import { parseCovered, withVeilColour } from '../render/covered.js';
import { keyframesModule, loadKeyframes, usesKeyframes } from '../render/load-keyframes.js';
import { loadSplit, splitModule } from '../text/load.js';
import { countModule, loadCount, usesCount } from '../text/load-count.js';
export class CvStage extends ElementBase {
    static observedAttributes = [
        'input',
        'fallback',
        'paused',
        'design-width',
        'margin',
        'first-scene-timeout',
        'transition-duration',
        'threshold',
        'unit',
        'scale'
    ];
    scenes = new Set();
    ordered = [];
    readyAt = 0;
    engine = null;
    clock = new Clock();
    autonomous = null;
    firstScreen = null;
    bootOffset = 0;
    shown = new Set();
    current = -1;
    eye = -1;
    scheduled = false;
    readySent = false;
    settleReady = null;
    readyPromise = this.pendingReady();
    errorsBefore = new WeakMap();
    errorsNow = new WeakMap();
    generation = 0;
    live = null;
    frame = null;
    get ready() {
        return this.readyPromise;
    }
    pendingReady() {
        return new Promise((resolve)=>this.settleReady = resolve);
    }
    get input() {
        return this.getAttribute('input') === 'drag' ? 'drag' : 'scroll';
    }
    set input(value) {
        this.setAttribute('input', value);
    }
    stopListening = [];
    connectedCallback() {
        this.ensureShadow();
        if (!this.stopListening.length) {
            this.stopListening = [
                onEffectDefined(()=>this.invalidate()),
                onReducedMotionChange(()=>this.invalidate())
            ];
        }
        this.invalidate();
    }
    attributeChangedCallback(name, before, after) {
        if (before === after) return;
        if (name === 'paused') {
            if (after === null) this.clock.play();
            else this.clock.pause();
            this.dispatchEvent(new CustomEvent(after === null ? 'cv-play' : 'cv-pause', {
                bubbles: true
            }));
            return;
        }
        if (this.isConnected) this.invalidate();
    }
    disconnectedCallback() {
        for (const stop of this.stopListening)stop();
        this.stopListening = [];
        this.firstScreen?.dispose();
        this.firstScreen = null;
        this.booted = false;
        this.readySent = false;
        if (!this.settleReady) this.readyPromise = this.pendingReady();
        this.current = -1;
        this.teardown();
    }
    ensureShadow() {
        if (this.shadowRoot) return;
        const root = this.attachShadow({
            mode: 'open'
        });
        const style = document.createElement('style');
        style.textContent = ':host{display:block;overflow-x:clip}' + ':host([input=drag]){position:fixed;inset:0;overflow:hidden;overscroll-behavior:contain;touch-action:pan-x pinch-zoom;user-select:none}' + '.frame{position:relative;width:100%;max-width:calc(var(--cv-dw,750) * 1px);margin-inline:auto}' + '.sized{container-type:inline-size}' + ':host([input=drag]) .frame{height:100%}' + '.live{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}';
        const frame = document.createElement('div');
        frame.className = 'frame';
        frame.setAttribute('part', 'frame');
        frame.append(document.createElement('slot'));
        const live = document.createElement('div');
        live.className = 'live';
        live.setAttribute('aria-live', 'polite');
        live.setAttribute('aria-atomic', 'true');
        root.append(style, frame, live);
        this.live = live;
        this.frame = frame;
    }
    sizeFrame() {
        const frame = this.frame;
        if (!frame) return;
        frame.classList.remove('sized');
        frame.style.minHeight = '';
        void frame.offsetWidth;
        frame.classList.add('sized');
        if (this.input === 'scroll') frame.style.minHeight = `${frame.offsetHeight}px`;
    }
    pause() {
        this.setAttribute('paused', '');
    }
    play() {
        this.removeAttribute('paused');
    }
    get paused() {
        return this.hasAttribute('paused');
    }
    set paused(value) {
        if (value) this.pause();
        else this.play();
    }
    registerScene(s) {
        this.scenes.add(s);
        this.invalidate();
    }
    unregisterScene(s) {
        this.scenes.delete(s);
        this.invalidate();
    }
    invalidate() {
        if (this.scheduled) return;
        this.scheduled = true;
        queueMicrotask(()=>{
            this.scheduled = false;
            if (this.isConnected) void this.build();
        });
    }
    report(message, element = this, code = 'invalid-attribute') {
        const key = `${code} ${message}`;
        let now = this.errorsNow.get(element);
        if (!now) this.errorsNow.set(element, now = new Set());
        if (now.has(key)) return;
        now.add(key);
        if (this.errorsBefore.get(element)?.has(key)) return;
        const detail = {
            code,
            message,
            element
        };
        const event = new CustomEvent('cv-error', {
            bubbles: true,
            cancelable: true,
            detail
        });
        const target = element.isConnected ? element : this;
        if (target.dispatchEvent(event) && false) {
            console.error(`[cineview] ${code}: ${message}`, element);
        }
    }
    setCurrent(index) {
        const from = this.current;
        this.current = index;
        this.ordered.forEach((s, i)=>s.toggleAttribute('data-cv-current', i === index));
        this.markLinks();
        this.showTheme(index);
        const scene = this.ordered[index];
        this.autonomous?.activateScene(scene ?? null);
        if (false && scene && this.input === 'drag') {
            requestAnimationFrame(()=>checkDragScene(scene));
        }
        if (from < 0 || from === index) return;
        const direction = index > from ? 'forward' : 'backward';
        this.setHeading(direction);
        const detail = {
            from,
            to: index,
            direction
        };
        this.ordered[from]?.dispatchEvent(new CustomEvent('cv-leave', {
            bubbles: true,
            detail
        }));
        this.ordered[index]?.dispatchEvent(new CustomEvent('cv-enter', {
            bubbles: true,
            detail
        }));
    }
    setHeading(direction) {
        if (this.getAttribute('data-cv-direction') !== direction) {
            this.setAttribute('data-cv-direction', direction);
        }
    }
    showTheme(index) {
        this.eye = index;
        const theme = this.ordered[index]?.getAttribute('theme') ?? null;
        if (theme === this.getAttribute('data-cv-theme')) return;
        if (theme === null) this.removeAttribute('data-cv-theme');
        else this.setAttribute('data-cv-theme', theme);
    }
    themeChanged(scene) {
        if (this.eye >= 0 && this.ordered[this.eye] === scene) this.showTheme(this.eye);
    }
    markLinks() {
        for (const a of document.querySelectorAll('a[href^="#"]')){
            let i = null;
            try {
                i = this.sceneIndexOf(decodeURIComponent(a.getAttribute('href').slice(1)));
            } catch  {}
            if (i === null) continue;
            if (i === this.current) a.setAttribute('aria-current', 'true');
            else if (a.getAttribute('aria-current') === 'true') a.removeAttribute('aria-current');
            a.toggleAttribute('data-cv-before', i < this.current);
            a.toggleAttribute('data-cv-after', i > this.current);
        }
    }
    refresh() {
        this.engine?.refresh();
    }
    currentIndex() {
        return this.engine?.currentIndex() ?? 0;
    }
    goTo(target, options = {}) {
        const index = typeof target === 'number' ? target : this.sceneIndexOf(target);
        if (index === null || !this.engine) return;
        if (this.engine.goTo) {
            this.engine.goTo(index, options);
            return;
        }
        this.ordered[Math.max(0, Math.min(this.ordered.length - 1, Math.round(index)))]?.scrollIntoView({
            behavior: options.animated === false ? 'instant' : 'smooth',
            block: 'start'
        });
    }
    sceneIndexOf(id) {
        if (!id) return null;
        const scene = document.getElementById(id)?.closest('cv-scene');
        const i = scene ? this.ordered.indexOf(scene) : -1;
        return i >= 0 ? i : null;
    }
    announce(text) {
        const live = this.live;
        if (!live) return;
        live.textContent = '';
        requestAnimationFrame(()=>live.textContent = text);
    }
    announceCurrent() {
        const scene = this.ordered[this.current];
        if (!scene) return;
        const name = scene.getAttribute('aria-label') ?? scene.querySelector('h1,h2,h3')?.textContent?.trim();
        const count = `${this.current + 1} / ${this.ordered.length}`;
        this.announce(name ? `${name}, ${count}` : count);
    }
    teardown() {
        this.generation++;
        const engine = this.engine;
        this.engine = null;
        engine?.destroy();
        this.autonomous?.destroy();
        this.autonomous = null;
        for (const s of this.scenes)for (const a of s.animates)a.cancelNatives();
    }
    async build() {
        let resumeAt = this.engine && this.input === 'drag' ? this.engine.currentIndex() : undefined;
        const previous = this.ordered;
        const current = resumeAt === undefined ? null : previous[resumeAt];
        const clockResume = this.autonomous?.snapshot();
        this.teardown();
        if (!this.isConnected) return;
        this.errorsBefore = this.errorsNow;
        this.errorsNow = new WeakMap();
        const input = this.input;
        const declaredInput = this.getAttribute('input');
        if (declaredInput !== null && declaredInput !== 'drag' && declaredInput !== 'scroll') {
            this.report(`input="${declaredInput}": expected drag or scroll; using scroll`, this);
        }
        const dw = Number(this.getAttribute('design-width'));
        if (dw > 0) this.style.setProperty('--cv-dw', String(dw));
        else this.style.removeProperty('--cv-dw');
        this.ordered = [
            ...this.scenes
        ].sort((a, b)=>a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
        const retained = current ? this.ordered.indexOf(current) : -1;
        if (retained >= 0) resumeAt = retained;
        const scenesChanged = previous.length !== this.ordered.length || previous.some((s, i)=>s !== this.ordered[i]);
        if (!this.ordered.length) {
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', ()=>this.invalidate(), {
                    once: true
                });
            } else {
                this.report('<cv-stage> has no <cv-scene>', this, 'empty-stage');
            }
            return;
        }
        const animates = this.ordered.flatMap((s)=>[
                ...s.animates
            ]);
        const chunks = [];
        if (!splitModule() && animates.some((a)=>a.hasAttribute('split'))) chunks.push(loadSplit());
        if (!stillsModule() && animates.some(usesStills)) chunks.push(loadStills());
        if (!countModule() && animates.some(usesCount)) chunks.push(loadCount());
        if (!keyframesModule() && animates.some(usesKeyframes)) chunks.push(loadKeyframes());
        if (chunks.length) {
            const generation = this.generation;
            const results = await Promise.allSettled(chunks);
            if (generation !== this.generation || !this.isConnected) return;
            for (const result of results)if (result.status === 'rejected') this.report(`optional module failed to load: ${String(result.reason)}`, this, 'asset-failed');
        }
        this.sizeFrame();
        const reducedMotion = prefersReducedMotion();
        if (this.paused) this.clock.pause();
        for (const scene of this.ordered){
            const timeSource = input === 'drag' || scene.isZone ? 'scene' : 'enter';
            for (const a of scene.animates){
                const on = a.getAttribute('on')?.trim();
                const partial = on !== undefined && /^enter\(\s*partial\s*\)$/.test(on);
                if (partial && (input === 'drag' || scene.isZone || scene.isTrack)) {
                    forgetRetainedRun(a);
                    a.rejectSource();
                    this.report(`on="${on}" works in ordinary scroll only; use on="clock" for playback at Scene entry.`, a);
                    continue;
                }
                if (input === 'scroll' && (scene.isZone ? on === 'enter' || on === 'eye' : on === 'scene')) {
                    forgetRetainedRun(a);
                    a.rejectSource();
                    this.report(`on="${on}" is not supported ${scene.isZone ? 'in a scroll zone; use on="scene"' : 'in ordinary scroll; use on="enter" or on="eye"'}. Use on="clock" for playback at Scene entry.`, a);
                    continue;
                }
                a.build(a.plan({
                    timeSource,
                    reducedMotion
                }, (m, code)=>this.report(m, a, code)));
            }
            const track = scene.getAttribute('track');
            if (track !== null && !scene.isTrack) this.report(`track="${track}": expected x`, scene);
            scene.travel = scene.measureTravel();
            scene.watchTrack(scene.isTrack);
            for (const { error, element } of scene.solve(input === 'scroll', (m, el, code)=>this.report(m, el, code))){
                this.report(error.message, element, error.code);
            }
            const cover = parseCovered(scene.getAttribute('covered'), reducedMotion, (m, code)=>this.report(m, scene, code));
            scene.cover = cover && withVeilColour(cover, getComputedStyle(scene).getPropertyValue('--cv-veil'));
            scene.setZoneDuration(input === 'scroll' && scene.isZone ? scene.solution.total : null);
        }
        const first = this.firstBuild();
        if (first && input === 'scroll') this.shown = this.shownOnScreen();
        if (input === 'drag') {
            const generation = this.generation;
            const { createDragEngine } = await import('../input/drag.js');
            if (generation !== this.generation || !this.isConnected) return;
            if (first) this.startFirstScreen(resumeAt ?? this.sceneIndexOf(decodeURIComponent(location.hash.slice(1))) ?? 0);
            if (resumeAt !== undefined) this.current = -1;
            this.engine = createDragEngine(this, resumeAt);
            if (resumeAt !== undefined && scenesChanged) this.announceCurrent();
        } else {
            if (first) this.startFirstScreen(0);
            this.engine = new ScrollInput(this);
        }
        if (this.ordered.some((s)=>s.clocks.length)) {
            if (this.current < 0) this.setCurrent(this.engine.currentIndex());
            this.autonomous = new EnterController(this.clock, {
                held: ()=>this.firstScreen?.held ?? false,
                offset: this.bootOffset,
                shown: this.shown
            }, 'clock');
            this.ordered.forEach((s, i)=>{
                for (const a of s.clocks)this.autonomous.add(a, {
                    first: i === 0,
                    margins: [
                        0,
                        0
                    ]
                });
            });
            this.autonomous.link();
            const scene = this.ordered[this.current] ?? null;
            this.autonomous.activateScene(scene, clockResume?.scene === scene ? clockResume.start : undefined);
            this.firstScreen?.whenReleased(()=>this.autonomous?.activateScene(this.ordered[this.current] ?? null));
        }
        this.bootOffset = 0;
        this.shown = new Set();
        for (const s of this.ordered)for (const a of s.animates)a.setAttribute('data-cv-live', '');
        this.markReady();
    }
    shownOnScreen() {
        const shown = new Set();
        for (const s of this.ordered.slice(1))for (const a of s.animates){
            if (!shownBeforeRuntime(a)) continue;
            const r = a.getBoundingClientRect();
            if (r.bottom > 0 && r.top < innerHeight && r.height > 0) shown.add(a);
        }
        return shown;
    }
    booted = false;
    firstBuild() {
        if (this.booted) return false;
        this.booted = true;
        return true;
    }
    startFirstScreen(index) {
        const scene = this.ordered[index] ?? null;
        const timeout = Number(this.getAttribute('first-scene-timeout') ?? 3000);
        this.firstScreen = new FirstScreenGate(this, scene, Number.isFinite(timeout) ? timeout : 3000);
        const offset = adoptBoot();
        this.bootOffset = index === 0 ? offset : 0;
    }
    markReady() {
        const first = !this.readySent;
        this.readySent = true;
        const generation = this.generation;
        requestAnimationFrame(()=>requestAnimationFrame(()=>{
                if (false && generation === this.generation && this.isConnected) checkStage(this);
                if (!first || !this.isConnected) return;
                this.readyAt = performance.now();
                this.settleReady?.();
                this.settleReady = null;
                this.dispatchEvent(new CustomEvent('cv-ready', {
                    bubbles: true
                }));
            }));
    }
}
