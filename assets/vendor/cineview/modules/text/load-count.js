let loaded = null;
let loading = null;
export function loadCount() {
    return loading ??= import('./count.js').then((m)=>loaded = m);
}
export const countModule = ()=>loaded;
export const usesCount = (el)=>/\bcount\b/.test(`${el.getAttribute('fx') ?? ''} ${el.getAttribute('exit') ?? ''}`);
