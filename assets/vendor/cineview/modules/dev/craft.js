import { warn } from './warn.js';
const UNSAFE_ON_TARGETS = [
    [
        'blur',
        '--cv-filter'
    ],
    [
        'clip',
        '--cv-clip-path'
    ],
    [
        'rx',
        '--cv-transform'
    ],
    [
        'ry',
        '--cv-transform'
    ],
    [
        'skx',
        '--cv-transform'
    ],
    [
        'sky',
        '--cv-transform'
    ]
];
export function warnUnsafeStagger(el, plan) {
    const used = new Set([
        ...plan.effects,
        ...plan.exitEffects
    ].flatMap((e)=>e.entries.map(([p])=>p)));
    const vars = [
        ...new Set(UNSAFE_ON_TARGETS.filter(([p])=>used.has(p)).map(([, v])=>v))
    ];
    if (vars.length) {
        warn(el, `stagger writes only translate, rotate, scale and opacity on your elements; the rest arrives as ${vars.join(', ')}. Use them in your CSS, e.g. filter: var(--cv-filter).`);
    }
}
export const WIDE_VARS = 1000;
export function warnWideVars(el, names) {
    if (!names.length) return;
    const count = el.getElementsByTagName('*').length;
    if (count <= WIDE_VARS) return;
    const list = [
        ...new Set(names)
    ].join(', ');
    warn(el, `${list} restyles all ${count} elements inside this <cv-animate> every frame. Wrap only the elements that use it, so fewer inherit it.`);
}
export function warnScopedPositioning(el) {
    const nested = el.querySelector('cv-fixed, cv-stack');
    if (nested) {
        warn(el, `<${nested.localName}> inside <cv-animate> cannot stick to the viewport: the animation layers scope it. Move it outside.`);
        return;
    }
    for (const child of el.children){
        const position = getComputedStyle(child).position;
        if (position === 'sticky' || position === 'fixed') {
            warn(el, `position: ${position} inside <cv-animate> is scoped by the animation layers and will not stick to the viewport.`);
            return;
        }
    }
}
export function checkDragScene(scene) {
    if (scene.style.contentVisibility === 'hidden') return;
    if (scene.scrollHeight > scene.clientHeight + 1) {
        warn(scene, `content is ${scene.scrollHeight - scene.clientHeight}px taller than the screen; drag scenes are one screen high and cut off the rest.`);
    }
}
function checkStacks(stage) {
    stage.ordered.forEach((scene, i)=>{
        if (!scene.hasAttribute('stack')) {
            if (scene.hasAttribute('covered')) {
                warn(scene, 'covered is how a stacked scene looks while the next one covers it; add stack.');
            }
            return;
        }
        const next = stage.ordered[i + 1];
        if (!next) {
            warn(scene, 'stack holds a scene until the next one covers it; the last scene has none.');
        } else if (stage.input === 'scroll' && scene.nextElementSibling !== next) {
            warn(scene, 'content between a stacked scene and the next scene scrolls underneath the held scene. Put it inside a scene.');
        }
    });
}
export function checkStage(stage) {
    for (const el of document.querySelectorAll('cv-animate, cv-video')){
        if (!el.parentElement?.closest('cv-scene')) {
            warn(el, `<${el.localName}> outside a <cv-scene> has no timeline and never animates.`);
        }
    }
    for (const el of document.querySelectorAll('cv-fixed')){
        if (!el.parentElement?.closest('cv-scene')) {
            warn(el, '<cv-fixed> holds content within its scene; outside a <cv-scene> it has none.');
        }
    }
    for (const el of document.querySelectorAll('cv-scene')){
        if (!el.parentElement?.closest('cv-stage')) {
            warn(el, '<cv-scene> outside a <cv-stage> is not part of any stage.');
        }
    }
    if (stage.input === 'drag') for (const scene of stage.ordered)checkDragScene(scene);
    checkStacks(stage);
    for (const scene of stage.ordered){
        if (scene.getAttribute('track') === 'x' && (scene.travel ?? 0) < 1) {
            warn(scene, 'track="x" moves the row until its end meets the scene\'s; this row is no wider than the scene, so nothing moves.');
        }
    }
    for (const a of stage.querySelectorAll('a[href^="#"]')){
        const id = decodeURIComponent(a.getAttribute('href').slice(1));
        if (id && !document.getElementById(id)) warn(a, `href="#${id}" points to no element.`);
    }
}
