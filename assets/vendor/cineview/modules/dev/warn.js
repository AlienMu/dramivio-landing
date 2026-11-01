const said = new WeakMap();
export function warn(element, message) {
    let seen = said.get(element);
    if (!seen) said.set(element, seen = new Set());
    if (seen.has(message)) return;
    seen.add(message);
    console.warn(`[cineview] ${message}`, element);
}
