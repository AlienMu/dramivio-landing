import { VideoDriver } from '../media/driver.js';
import { CvAnimate } from './animate.js';
const VIDEO_ATTRIBUTES = [
    'src',
    'range',
    'preload',
    'poster',
    'playback-rate',
    'aria-label'
];
export function parseRange(text) {
    if (text === null) return undefined;
    const parts = text.trim().split(/[\s,]+/).map(Number);
    if (parts.length !== 2 || !parts.every((n)=>Number.isFinite(n) && n >= 0)) return undefined;
    return [
        parts[0],
        parts[1]
    ];
}
export class CvVideo extends CvAnimate {
    static observedAttributes = [
        ...CvAnimate.observedAttributes,
        ...VIDEO_ATTRIBUTES
    ];
    driver = null;
    unsubscribe = null;
    connectedCallback() {
        super.connectedCallback();
        if (!this.driver) {
            this.driver = new VideoDriver(this);
            this.driver.sceneActive = ()=>this.dragActive;
            this.driver.failed = (url)=>this.scene?.stage?.report(`<cv-video> failed to load ${url}`, this, 'asset-failed');
            this.unsubscribe = this.timeline.subscribe((frame)=>this.driver?.frame(frame));
            this.driver.frame(this.timeline.frame);
        }
        this.place();
        this.configure();
    }
    attributeChangedCallback(name, before, after) {
        if (VIDEO_ATTRIBUTES.includes(name)) {
            if (before !== after) this.configure();
            return;
        }
        super.attributeChangedCallback(name, before, after);
    }
    disconnectedCallback() {
        super.disconnectedCallback();
        this.unsubscribe?.();
        this.unsubscribe = null;
        this.driver?.destroy();
        this.driver = null;
    }
    plan(context, report) {
        const range = this.getAttribute('range');
        if (range !== null && !parseRange(range)) {
            report(`range="${range}": expected two times in seconds, such as range="0 3.2"`);
        }
        return super.plan(context, report);
    }
    build(plan) {
        const rejected = this.sourceRejected;
        super.build(plan);
        if (rejected) this.driver?.warmUp();
        this.place();
    }
    rejectSource() {
        super.rejectSource();
        this.driver?.release();
        this.place();
    }
    activated(on) {
        if (on) this.driver?.warmUp();
        else if (this.driver?.scrubbed) this.driver.release();
    }
    get video() {
        return this.driver?.video ?? null;
    }
    place() {
        const root = this.shadowRoot ?? this.attachShadow({
            mode: 'open'
        });
        const slot = root.querySelector('slot');
        this.driver?.place(slot?.parentNode ?? root);
    }
    configure() {
        const rate = Number(this.getAttribute('playback-rate') ?? 1);
        const preload = this.getAttribute('preload');
        this.driver?.configure({
            src: this.getAttribute('src') ?? '',
            preload: preload !== 'none' && preload !== 'false',
            poster: this.getAttribute('poster'),
            playbackRate: Number.isFinite(rate) && rate > 0 ? rate : 1,
            label: this.getAttribute('aria-label'),
            range: parseRange(this.getAttribute('range'))
        });
    }
}
