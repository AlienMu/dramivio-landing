let loaded = null;
let loading = null;
export function loadSplit() {
    return loading ??= import('./split.js').then((m)=>loaded = m);
}
export const splitModule = ()=>loaded;
