export function parseReplay(value) {
    if (value === null) return 'default';
    const v = value.trim().toLowerCase();
    if (v === '' || v === 'true' || v === 'replay') return 'on';
    if (v === 'false') return 'once';
    return null;
}
const done = new WeakMap();
const DEFINITION = [
    'fx',
    'from',
    'to',
    'duration',
    'delay',
    'after',
    'at',
    'stagger',
    'split',
    'on',
    'ease',
    'target'
];
export function entranceDefinition(el, sceneKey) {
    return DEFINITION.map((n)=>el.getAttribute(n) ?? '').join('|') + '|' + sceneKey;
}
export const isDone = (el, key)=>done.get(el) === key;
export const markDone = (el, key)=>void done.set(el, key);
export const forgetDone = (el)=>void done.delete(el);
