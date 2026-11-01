import { warn } from '../dev/warn.js';
const STANDIN = 'filter:blur(3.5cqi);transform:scale(1.15)';
const FILL = 'position:absolute;inset:0;display:block;width:100%;height:100%;max-width:none;';
const LOADING = [
    'crossorigin',
    'referrerpolicy',
    'loading',
    'decoding'
];
const imagesOf = (host)=>[
        ...host.querySelectorAll('img')
    ];
function isLargePicture(host) {
    if (!host.querySelector('img') || host.querySelector('video, canvas, svg, iframe, object, embed')) return false;
    if (host.textContent?.trim()) return false;
    return host.offsetWidth * host.offsetHeight > innerWidth * innerHeight / 4;
}
export function splitBlur(e) {
    const blur = e.tracks.blur;
    if (!blur) return [
        e,
        null
    ];
    const tracks = {
        ...e.tracks
    };
    delete tracks.blur;
    const entries = e.entries.filter(([p])=>p !== 'blur');
    return [
        entries.length || e.vars.length ? {
            ...e,
            tracks,
            entries
        } : null,
        {
            ...e,
            tracks: {
                blur
            },
            entries: [
                [
                    'blur',
                    blur[0],
                    blur[1]
                ]
            ],
            vars: []
        }
    ];
}
export function planFades(layers, host) {
    const blurs = (l)=>l.select === 'rest' && [
            ...l.effects,
            ...l.exitEffects
        ].some((e)=>e.tracks.blur);
    if (!layers.some(blurs) || !isLargePicture(host)) return [];
    const parts = (list)=>{
        const split = list.map(splitBlur);
        return [
            split.map(([rest])=>rest).filter((e)=>e !== null),
            split.map(([, blur])=>blur).filter((e)=>e !== null)
        ];
    };
    const fades = [];
    layers.forEach((l, i)=>{
        if (!blurs(l)) return;
        const [effects, blurEffects] = parts(l.effects);
        const [exitEffects, blurExits] = parts(l.exitEffects);
        layers[i] = {
            ...l,
            effects,
            exitEffects
        };
        const blur = Math.max(...[
            ...blurEffects,
            ...blurExits
        ].flatMap((e)=>e.entries.map(([, a, b])=>Math.max(+a, +b))));
        if (blur > 0) {
            fades.push({
                layer: {
                    ...l,
                    effects: blurEffects,
                    exitEffects: blurExits
                },
                blur
            });
        }
    });
    return fades;
}
export function planInks(layers) {
    const plans = [];
    const inked = (e)=>e.inks !== null;
    layers.forEach((l, i)=>{
        const first = [
            ...l.effects,
            ...l.exitEffects
        ].find(inked);
        if (l.select !== 'rest' || !first) return;
        const without = (list)=>list.filter((e)=>!inked(e));
        layers[i] = {
            ...l,
            effects: without(l.effects),
            exitEffects: without(l.exitEffects)
        };
        plans.push({
            layer: {
                ...l,
                effects: l.effects.filter(inked),
                exitEffects: l.exitEffects.filter(inked)
            },
            inks: first.inks
        });
    });
    return plans;
}
export function copyContainer(slot, part) {
    const el = document.createElement('div');
    el.setAttribute('part', part);
    el.setAttribute('aria-hidden', 'true');
    el.style.cssText = 'position:absolute;inset:0;pointer-events:none';
    slot.parentNode.append(el);
    return el;
}
class Copies {
    host;
    container;
    items = [];
    resize = null;
    cleanups = [];
    constructor(host, container){
        this.host = host;
        this.container = container;
    }
    add(img, variant, look, blur = 0) {
        const copy = document.createElement('img');
        copy.alt = '';
        for (const name of LOADING){
            const value = img.getAttribute(name);
            if (value !== null) copy.setAttribute(name, value);
        }
        if (!source(copy, img, variant)) return null;
        const box = document.createElement('div');
        box.style.cssText = 'position:absolute;overflow:clip;container-type:inline-size';
        copy.style.cssText = FILL + look;
        const filler = blur ? copy.cloneNode() : null;
        if (filler) box.append(filler);
        box.append(copy);
        const item = {
            img,
            box,
            copy,
            variant,
            filler,
            blur
        };
        this.hold(item);
        return item;
    }
    hold(item) {
        this.container.append(item.box);
        this.items.push(item);
        this.resize?.observe(item.img);
    }
    watch() {
        this.measure();
        this.resize = new ResizeObserver(()=>this.measure());
        this.resize.observe(this.host);
        for (const { img } of this.items)this.resize.observe(img);
    }
    measure() {
        if (!this.items.length) return;
        const c = this.container.getBoundingClientRect();
        const style = getComputedStyle(this.container);
        const borderBox = style.boxSizing === 'border-box';
        const width = px(style.width) + (borderBox ? 0 : px(style.paddingLeft) + px(style.paddingRight) + px(style.borderLeftWidth) + px(style.borderRightWidth));
        const height = px(style.height) + (borderBox ? 0 : px(style.paddingTop) + px(style.paddingBottom) + px(style.borderTopWidth) + px(style.borderBottomWidth));
        const sx = width ? c.width / width : 1;
        const sy = height ? c.height / height : 1;
        const reads = this.items.map(({ img })=>({
                r: img.getBoundingClientRect(),
                s: getComputedStyle(img)
            }));
        this.items.forEach((item, i)=>{
            const { r, s } = reads[i];
            const left = px(s.borderLeftWidth) + px(s.paddingLeft);
            const top = px(s.borderTopWidth) + px(s.paddingTop);
            const width = Math.max(0, r.width / sx - left - px(s.borderRightWidth) - px(s.paddingRight));
            const height = Math.max(0, r.height / sy - top - px(s.borderBottomWidth) - px(s.paddingBottom));
            const box = item.box.style;
            box.left = `${(r.left - c.left) / sx + left}px`;
            box.top = `${(r.top - c.top) / sy + top}px`;
            box.width = `${width}px`;
            box.height = `${height}px`;
            box.borderRadius = s.borderRadius;
            this.fit(item, s, width, height);
        });
    }
    fit(item, s, width, height) {
        for (const el of [
            item.copy,
            item.filler
        ]){
            if (!el) continue;
            el.style.objectFit = s.objectFit;
            el.style.objectPosition = s.objectPosition;
        }
        const scale = 1 + 4 * item.blur / Math.max(1, Math.min(width, height));
        if (item.filler) item.filler.style.transform = `scale(${scale})`;
    }
    drop(item) {
        const i = this.items.indexOf(item);
        if (i < 0) return;
        this.items.splice(i, 1);
        item.box.remove();
        this.resize?.unobserve(item.img);
    }
    destroy() {
        this.resize?.disconnect();
        this.resize = null;
        for (const cleanup of this.cleanups)cleanup();
        this.cleanups = [];
        this.items = [];
        this.container.remove();
    }
}
function source(copy, img, variant) {
    const own = img.getAttribute('src');
    if (variant) copy.src = variant;
    else if (img.currentSrc) copy.src = img.currentSrc;
    else if (img.parentElement instanceof HTMLPictureElement || !img.srcset && !own) return false;
    else {
        if (img.srcset) {
            copy.sizes = img.sizes;
            copy.srcset = img.srcset;
        }
        if (own !== null) copy.src = own;
    }
    return true;
}
const px = (value)=>parseFloat(value) || 0;
function arrival(img, signal) {
    const decoded = ()=>img.decode().then(()=>true, ()=>img.complete && img.naturalWidth > 0);
    if (img.complete) return decoded();
    return new Promise((resolve)=>{
        const done = ()=>{
            img.removeEventListener('load', done);
            img.removeEventListener('error', done);
            signal.removeEventListener('abort', done);
            resolve();
        };
        img.addEventListener('load', done);
        img.addEventListener('error', done);
        signal.addEventListener('abort', done, {
            once: true
        });
    }).then(()=>signal.aborted ? false : decoded());
}
export class Develop extends Copies {
    cancellation = new AbortController();
    mount(duration, easing) {
        for (const img of imagesOf(this.host)){
            if (img.complete) continue;
            const item = this.add(img, img.getAttribute('data-cv-standin'), STANDIN);
            if (!item) continue;
            const signal = this.cancellation.signal;
            void Promise.all([
                arrival(img, signal),
                item.variant ? true : arrival(item.copy, signal)
            ]).then(([shown])=>{
                if (signal.aborted || !this.items.includes(item)) return;
                if (!shown) {
                    if (false) warn(img, `develop: ${img.currentSrc || img.src} did not load`);
                    if (!item.variant) this.drop(item);
                    return;
                }
                const fade = item.box.animate([
                    {
                        opacity: 1
                    },
                    {
                        opacity: 0
                    }
                ], {
                    duration,
                    easing,
                    fill: 'forwards'
                });
                void fade.finished.then(()=>this.drop(item), ()=>undefined);
                this.cleanups.push(()=>fade.cancel());
            });
        }
        if (this.items.length) this.watch();
        else this.container.remove();
    }
    destroy() {
        this.cancellation.abort();
        super.destroy();
    }
}
const MASK = 'mask-repeat:no-repeat;';
const cssUrl = (src)=>`url(${JSON.stringify(src)})`;
function maskable(img, src) {
    if (img.crossOrigin !== null || /^(data|blob):/.test(src)) return true;
    return new URL(src, location.href).origin === location.origin;
}
export class Duotone extends Copies {
    mount([dark, light]) {
        let foreign = false;
        for (const img of imagesOf(this.host)){
            let item = null;
            const print = ()=>{
                const src = img.currentSrc;
                if (!src || !img.naturalWidth) return;
                if (!maskable(img, src)) {
                    if (false && !foreign) {
                        warn(img, `duotone: ${src} is from another origin; add crossorigin to print it`);
                    }
                    foreign = true;
                    return;
                }
                if (!item) {
                    const box = document.createElement('div');
                    box.style.cssText = `position:absolute;overflow:clip;background:${dark};${MASK}mask-mode:alpha`;
                    const ink = document.createElement('div');
                    ink.style.cssText = `position:absolute;inset:0;background:${light};${MASK}mask-mode:luminance`;
                    box.append(ink);
                    item = {
                        img,
                        box,
                        copy: ink,
                        variant: null,
                        filler: null,
                        blur: 0
                    };
                    this.hold(item);
                }
                for (const el of [
                    item.box,
                    item.copy
                ])el.style.setProperty('mask-image', cssUrl(src));
                this.measure();
            };
            print();
            img.addEventListener('load', print);
            this.cleanups.push(()=>img.removeEventListener('load', print));
        }
        this.watch();
    }
    fit(item, s, width, height) {
        const { naturalWidth: w, naturalHeight: h } = item.img;
        const natural = `${w}px ${h}px`;
        const fit = s.objectFit;
        const size = fit === 'cover' || fit === 'contain' ? fit : fit === 'none' ? natural : fit === 'scale-down' ? w > width || h > height ? 'contain' : natural : '100% 100%';
        for (const el of [
            item.box,
            item.copy
        ]){
            el.style.setProperty('mask-size', size);
            el.style.setProperty('mask-position', s.objectPosition);
        }
    }
}
export class FocusCopy extends Copies {
    mount(blur) {
        for (const img of imagesOf(this.host)){
            const variant = img.getAttribute('data-cv-blurred');
            const make = ()=>variant ? this.add(img, variant, '') : this.add(img, null, `filter:blur(${blur}px)`, blur);
            make();
            const follow = ()=>{
                const item = this.items.find((c)=>c.img === img) ?? make();
                if (item && !variant && img.currentSrc && item.copy.src !== img.currentSrc) {
                    for (const el of [
                        item.copy,
                        item.filler
                    ]){
                        el?.removeAttribute('srcset');
                        if (el) el.src = img.currentSrc;
                    }
                }
                this.measure();
            };
            img.addEventListener('load', follow);
            this.cleanups.push(()=>img.removeEventListener('load', follow));
        }
        this.watch();
    }
}
