import { watchText } from './watch.js';
const ON = '--cv-count-on';
const WHEEL = '--cv-count-';
const NUMBER = /\d(?:[\d.,'\s]*\d)?/g;
const COPIED = [
    'font-family',
    'font-size',
    'font-weight',
    'font-style',
    'font-stretch',
    'font-variant',
    'font-feature-settings',
    'font-variation-settings',
    'font-kerning',
    'letter-spacing',
    'word-spacing',
    'text-transform',
    'color',
    '-webkit-text-fill-color',
    'text-shadow'
];
const FADE = 'linear-gradient(transparent,#000 .16em,#000 calc(100% - .16em),transparent)';
const WHEEL_CSS = `display:inline-block;vertical-align:top;height:1lh;overflow:clip;margin:-.16em 0;padding:.16em 0;-webkit-mask-image:${FADE};mask-image:${FADE}`;
export function planCounts(layers) {
    const counts = [];
    const parts = (list)=>{
        const rest = [];
        const count = [];
        for (const e of list){
            const track = e.tracks.count;
            if (!track) {
                rest.push(e);
                continue;
            }
            const tracks = {
                ...e.tracks
            };
            delete tracks.count;
            const entries = e.entries.filter(([p])=>p !== 'count');
            if (entries.length || e.vars.length) rest.push({
                ...e,
                tracks,
                entries
            });
            count.push({
                ...e,
                tracks: {
                    count: track
                },
                entries: [
                    [
                        'count',
                        ...track
                    ]
                ],
                vars: []
            });
        }
        return [
            rest,
            count
        ];
    };
    layers.forEach((l, i)=>{
        if (l.select !== 'rest' || ![
            ...l.effects,
            ...l.exitEffects
        ].some((e)=>e.tracks.count)) {
            return;
        }
        const [effects, countEffects] = parts(l.effects);
        const [exitEffects, countExits] = parts(l.exitEffects);
        layers[i] = {
            ...l,
            effects,
            exitEffects
        };
        counts.push({
            ...l,
            effects: countEffects,
            exitEffects: countExits
        });
    });
    return counts;
}
function find(host) {
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    let node = null;
    for(let n = walker.nextNode(); n; n = walker.nextNode()){
        if (!n.data.trim()) continue;
        if (node) return 'the number needs to be its only run of text';
        node = n;
    }
    const data = node?.data ?? '';
    const numbers = [
        ...data.matchAll(NUMBER)
    ];
    if (!node || !numbers.length) return 'there is no number in its text';
    if (numbers.length > 1) return 'its text holds more than one number';
    const m = numbers[0];
    const digits = m[0].replace(/\D/g, '');
    if (digits.length > 15) return 'the number has more than 15 digits';
    const start = data.length - data.trimStart().length;
    return {
        node,
        start,
        end: data.trimEnd().length,
        from: m.index,
        to: m.index + m[0].length,
        digits
    };
}
export class Counter {
    host;
    slot;
    rebuild;
    el;
    source;
    copy;
    line;
    found = null;
    unwatch = null;
    raf = 0;
    constructor(host, slot, rebuild){
        this.host = host;
        this.slot = slot;
        this.rebuild = rebuild;
        this.el = document.createElement('div');
        this.el.setAttribute('part', 'count');
        this.el.style.cssText = 'position:relative;font-variant-numeric:tabular-nums';
        this.source = document.createElement('div');
        this.source.setAttribute('part', 'count-source');
        this.source.style.opacity = `calc(1 - var(${ON}, 0))`;
        this.copy = document.createElement('div');
        this.copy.setAttribute('aria-hidden', 'true');
        this.copy.style.cssText = `position:absolute;inset:0;pointer-events:none;opacity:var(${ON}, 0)`;
        this.line = document.createElement('span');
        this.copy.append(this.line);
        this.el.append(this.source, this.copy);
    }
    get vars() {
        return [
            ON,
            ...[
                ...this.found?.digits ?? ''
            ].map((_, i)=>`${WHEEL}${i}`)
        ];
    }
    mount() {
        this.unwatch = watchText(this.host, ()=>this.schedule());
        const found = find(this.host);
        if (typeof found === 'string') return found;
        this.found = found;
        this.slot.replaceWith(this.el);
        this.source.append(this.slot);
        this.draw();
        return null;
    }
    adapt = (frame)=>{
        const digits = this.found?.digits ?? '';
        const d = digits.length;
        const t = Math.min(1, Math.max(0, frame.count));
        const to = Number(digits);
        const n = to * (1 - 10 ** (-d * t)) / (1 - 10 ** -d);
        frame.vars.set(ON, t < 1 ? '1' : '0');
        let right = 0;
        for(let i = d - 1; i >= 0; i--){
            const q = n / 10 ** (d - 1 - i);
            const pos = i === d - 1 ? q % 10 : Math.floor(q) % 10 + Math.max(0, right - 9);
            right = pos;
            frame.vars.set(`${WHEEL}${i}`, String(Math.round(pos * 1e3) / 1e3));
        }
    };
    destroy() {
        cancelAnimationFrame(this.raf);
        this.unwatch?.();
        this.unwatch = null;
    }
    draw() {
        const { node, start, end, from, to } = this.found;
        const data = node.data;
        const line = this.line;
        line.textContent = '';
        line.append(data.slice(start, from));
        let wheel = 0;
        for (const c of data.slice(from, to)){
            if (!/\d/.test(c)) {
                line.append(c);
                continue;
            }
            const box = document.createElement('span');
            box.style.cssText = WHEEL_CSS;
            const strip = document.createElement('span');
            strip.style.cssText = `display:block;white-space:pre;translate:0 calc(var(${WHEEL}${wheel++}, 0) * -100% / 11)`;
            strip.textContent = [
                ...'01234567890'
            ].join('\n');
            box.append(strip);
            line.append(box);
        }
        line.append(data.slice(to, end));
        this.measure();
    }
    measure() {
        const { node, start, end } = this.found;
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, end);
        const r = range.getBoundingClientRect();
        const c = this.el.getBoundingClientRect();
        const sx = this.el.offsetWidth ? c.width / this.el.offsetWidth : 1;
        const sy = this.el.offsetHeight ? c.height / this.el.offsetHeight : 1;
        const style = getComputedStyle(node.parentElement);
        let css = 'position:absolute;white-space:pre;';
        for (const prop of COPIED)css += `${prop}:${style.getPropertyValue(prop)};`;
        const height = r.height / sy;
        const line = Math.round(height);
        this.line.style.cssText = css + `font-variant-numeric:tabular-nums;line-height:${line}px;` + `left:${(r.left - c.left) / sx}px;top:${(r.top - c.top) / sy - (line - height) / 2}px`;
    }
    schedule() {
        if (this.raf) return;
        this.raf = requestAnimationFrame(()=>{
            this.raf = 0;
            if (!this.host.isConnected) return;
            const found = find(this.host);
            if (typeof found === 'string') {
                if (this.found) this.rebuild();
                return;
            }
            if (found.digits !== this.found?.digits) {
                this.rebuild();
                return;
            }
            this.found = found;
            this.draw();
        });
    }
}
