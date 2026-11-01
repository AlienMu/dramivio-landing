let loaded = null;
let loading = null;
export function loadStills() {
    return loading ??= import('./stills.js').then((m)=>loaded = m);
}
export const stillsModule = ()=>loaded;
export const usesStills = (el)=>/develop|duotone|focus|reveal|blur/.test([
        'fx',
        'from',
        'to',
        'exit'
    ].map((name)=>el.getAttribute(name) ?? '').join(' ')) && el.querySelector('img') !== null;
