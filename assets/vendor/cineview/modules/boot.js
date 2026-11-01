import { parseFx, presetNames, sampleKeyframes, usedProps } from './core/fx.js';
import { frameCss, identityFrame } from './core/props.js';
export const FAILSAFE_DELAY = 4000;
export const BOOT_PREFIX = 'cv-boot-';
const SAMPLES = 24;
const DISQUALIFY = [
    'delay',
    'after',
    'at',
    'stagger',
    'split',
    'from',
    'to',
    'on',
    'duration',
    'ease',
    'display',
    'target'
];
const SCENE_DISQUALIFY = [
    'preload',
    'zone',
    'track',
    'sequence'
];
const FIRST = 'cv-stage>cv-scene:first-of-type';
const TIMED = ':is(:not([on]),[on=enter],[on^="enter("],[on=eye],[on=clock],[on=scene])';
const not = (attrs)=>`:not(${attrs.map((a)=>`[${a}]`).join(',')})`;
function bootPresets() {
    const out = [];
    for (const name of presetNames()){
        if (!/^[a-z][a-z-]*$/.test(name)) continue;
        let failed = false;
        const effects = parseFx(name, ()=>failed = true);
        if (failed || !effects.length) continue;
        if (effects.some((e)=>e.own !== null || e.duration === null || e.viewRange)) continue;
        const duration = Math.max(...effects.map((e)=>e.duration ?? 0));
        const used = usedProps(effects, 'all');
        const frames = sampleKeyframes(effects, 'all', (f)=>frameCss(f, used), identityFrame(), SAMPLES);
        const body = frames.map(({ offset, ...css })=>{
            const decl = Object.entries(css).map(([k, v])=>`${k.replace(/[A-Z]/g, (c)=>`-${c.toLowerCase()}`)}:${String(v)}`).join(';');
            return `${Math.round(offset * 1e4) / 100}%{${decl}}`;
        }).join('');
        out.push({
            name,
            duration,
            css: `@keyframes ${BOOT_PREFIX}${name}{${body}}`
        });
    }
    return out;
}
let cached = null;
export function bootCss() {
    if (cached !== null) return cached;
    const presets = bootPresets();
    const eligible = presets.map((p)=>`[fx="${p.name}" i]`).join(',');
    const qualifies = `:is(${eligible})${not(DISQUALIFY)}`;
    const animated = 'cv-animate:is([fx],[from])';
    const bootScene = `.cv-js ${FIRST}${not(SCENE_DISQUALIFY)}:not(:has(${animated}:not(${qualifies})))`;
    let css = '@property --cv-unit{syntax:"<length>";inherits:true;initial-value:1px}' + ':root{--cv-boot:1}' + 'cv-stage,cv-scene,cv-animate{display:block}' + 'cv-scene{position:relative}' + 'cv-fixed{display:block;position:absolute;inset:0;overflow:clip;pointer-events:none}' + 'cv-fixed>*{pointer-events:auto}' + 'cv-stage{--cv-dw:750}' + 'cv-scene{--cv-unit:calc(min(100cqi,var(--cv-dw) * 1px) / var(--cv-dw))}' + 'cv-pause{cursor:pointer}' + 'cv-stage[input=drag]{position:fixed;inset:0;overflow:hidden}' + 'cv-stage[input=drag]>cv-scene{position:absolute;inset:0}' + 'cv-stage[input=drag]>cv-scene:nth-of-type(2){translate:0 100%}' + 'cv-stage[input=drag]>cv-scene:nth-of-type(n+3){content-visibility:hidden;translate:0 200%}' + `@keyframes cv-failsafe{from{opacity:0}to{opacity:1}}` + `.cv-js ${FIRST} ${animated}${TIMED}:not([data-cv-live]){animation:cv-failsafe 1ms ${FAILSAFE_DELAY}ms both}`;
    let rules = '';
    for (const p of presets){
        css += p.css;
        rules += `${bootScene} cv-animate[fx="${p.name}" i]${not(DISQUALIFY)}:not([data-cv-live]){animation:${BOOT_PREFIX}${p.name} ${p.duration}ms linear both}`;
    }
    css += `@media (prefers-reduced-motion:no-preference){${rules}}`;
    return cached = css;
}
export const HEAD_SNIPPET = "(function(s){if(s&&s('selector(:has(*))')&&s('width:1lh')&&s('color:color-mix(in srgb,red,red)'))document.documentElement.classList.add('cv-js')})(window.CSS&&CSS.supports);";
function bootAnimation(el) {
    for (const a of el.getAnimations?.() ?? []){
        const name = a.animationName;
        if (typeof name === 'string' && name.startsWith(BOOT_PREFIX)) return a;
    }
    return null;
}
function elapsedOf(a) {
    const t = a.currentTime;
    const local = typeof t === 'number' ? t : t === null ? 0 : Number(t.to('ms').value);
    return local - Number(a.effect?.getTiming().delay ?? 0);
}
function failsafeOf(el) {
    for (const a of el.getAnimations?.() ?? [])if (a.animationName === 'cv-failsafe') return a;
    return null;
}
export function shownBeforeRuntime(el) {
    if (el.hasAttribute('data-cv-live') || bootAnimation(el)) return false;
    const f = failsafeOf(el);
    return f === null || elapsedOf(f) >= 0;
}
let bootStart = null;
let revealed = false;
const shifted = new Set();
export function captureBoot() {
    const els = [
        ...document.querySelectorAll(`${FIRST} cv-animate:not([data-cv-live])`)
    ];
    const timeline = document.timeline.currentTime;
    const now = typeof timeline === 'number' ? timeline : performance.now();
    const running = els.map(bootAnimation);
    for (const a of running){
        if (a) bootStart = Math.min(bootStart ?? now, now - elapsedOf(a));
    }
    const failsafes = els.map(failsafeOf);
    revealed = failsafes.some((a)=>a !== null && elapsedOf(a) >= 0);
    return ()=>{
        const elapsed = bootStart === null ? 0 : performance.now() - bootStart;
        for (const [i, el] of els.entries()){
            const a = bootAnimation(el);
            if (a && a !== running[i] && bootStart !== null) {
                el.style.animationDelay = `${-elapsed}ms`;
                shifted.add(el);
                continue;
            }
            const f = failsafeOf(el);
            if (revealed && f && f !== failsafes[i]) {
                el.style.animationDelay = '-1ms';
                shifted.add(el);
            }
        }
    };
}
export function adoptBoot() {
    const shown = revealed || [
        ...document.querySelectorAll(`${FIRST} cv-animate:not([data-cv-live])`)
    ].some((el)=>{
        const a = failsafeOf(el);
        return a !== null && elapsedOf(a) >= 0;
    });
    const offset = shown ? 1e9 : bootStart === null ? 0 : performance.now() - bootStart;
    bootStart = null;
    revealed = false;
    for (const el of shifted)el.style.removeProperty('animation-delay');
    shifted.clear();
    return offset;
}
