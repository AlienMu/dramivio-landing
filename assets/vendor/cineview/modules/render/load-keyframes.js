let loaded = null;
let loading = null;
export function loadKeyframes() {
    return loading ??= import('./keyframes.js').then((m)=>loaded = m);
}
export const keyframesModule = ()=>loaded;
export const usesKeyframes = (el)=>/\bkeyframes\s*\(/.test(el.getAttribute('fx') ?? '');
