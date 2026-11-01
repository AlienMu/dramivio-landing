const STYLE_RULE = 1;
const IMPORT_RULE = 3;
const MEDIA_RULE = 4;
const KEYFRAMES_RULE = 7;
const SUPPORTS_RULE = 12;
const matches = (media)=>!media?.mediaText || typeof matchMedia !== 'function' || matchMedia(media.mediaText).matches;
function scanSheet(sheet, search) {
    if (sheet.disabled || !matches(sheet.media)) return;
    let rules;
    try {
        rules = sheet.cssRules;
    } catch  {
        search.unreadable++;
        return;
    }
    scan(rules, search);
}
function scan(rules, search) {
    for (const rule of Array.from(rules)){
        if (rule.type === KEYFRAMES_RULE) {
            if (rule.name === search.name) search.rule = rule;
        } else if (rule.type === IMPORT_RULE) {
            const { styleSheet, media } = rule;
            if (styleSheet && matches(media)) scanSheet(styleSheet, search);
        } else if (rule.type === MEDIA_RULE) {
            if (matches(rule.media)) scan(rule.cssRules, search);
        } else if (rule.type === SUPPORTS_RULE) {
            const { conditionText, cssRules } = rule;
            if (typeof CSS === 'undefined' || CSS.supports(conditionText)) scan(cssRules, search);
        } else if (rule.type !== STYLE_RULE && 'cssRules' in rule) {
            scan(rule.cssRules, search);
        }
    }
}
const keyOf = (property)=>property.startsWith('--') ? property : property === 'float' ? 'cssFloat' : property === 'offset' ? 'cssOffset' : property.replace(/^-webkit-/, 'webkit-').replace(/-([a-z])/g, (_, c)=>c.toUpperCase());
function offsetOf(selector) {
    if (selector === 'from') return 0;
    if (selector === 'to') return 1;
    const m = /^(\d*\.?\d+)%$/.exec(selector);
    return m ? Number(m[1]) / 100 : null;
}
export function toKeyframes(rule, easing, report) {
    const at = new Map();
    for (const frame of Array.from(rule.cssRules)){
        const style = frame.style;
        const values = {};
        for(let i = 0; i < style.length; i++){
            const property = style[i];
            const value = style.getPropertyValue(property);
            if (!value || style.getPropertyPriority(property)) continue;
            if (property === 'animation-timing-function') values.easing = value;
            else if (property === 'animation-composition') {
                values.composite = value;
            } else if (!property.startsWith('animation')) values[keyOf(property)] = value;
        }
        for (const selector of frame.keyText.split(',')){
            const offset = offsetOf(selector.trim());
            if (offset === null) {
                report(`keyframes(${rule.name}): "${selector.trim()}" names a timeline range; give the fx item a range instead`);
                continue;
            }
            at.set(offset, {
                ...at.get(offset),
                ...values
            });
        }
    }
    return [
        ...at
    ].sort(([a], [b])=>a - b).map(([offset, values])=>({
            easing,
            ...values,
            offset
        }));
}
export function readKeyframes(el, name, easing, report) {
    const search = {
        name,
        rule: null,
        unreadable: 0
    };
    const scopes = [
        document
    ];
    const root = el.getRootNode();
    if (root instanceof ShadowRoot) scopes.push(root);
    for (const scope of scopes){
        for (const sheet of Array.from(scope.styleSheets))scanSheet(sheet, search);
        const adopted = scope.adoptedStyleSheets;
        for (const sheet of adopted ?? [])scanSheet(sheet, search);
    }
    if (!search.rule) {
        const n = search.unreadable;
        const unread = n ? `; ${n} stylesheet${n > 1 ? 's' : ''} from another origin could not be read: load ${n > 1 ? 'them' : 'it'} with crossorigin (and CORS), or move the rule` : '';
        report(`keyframes(${name}): no @keyframes ${name} in the page's stylesheets${unread}`, 'unknown-keyframes');
        return null;
    }
    return toKeyframes(search.rule, easing, report);
}
