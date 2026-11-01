import { cubicBezier, easeInOut, linear, pan, parseEase, settle } from './ease.js';
import { applyTrack, AXIS, isColor, parseDeclarations, parseVars, resetFrame, tracksBetween, varsBetween, varValue } from './props.js';
export function makeEffect(init) {
    const entries = Object.keys(init.tracks).map((p)=>[
            p,
            init.tracks[p][0],
            init.tracks[p][1]
        ]);
    return {
        tracks: init.tracks,
        entries,
        vars: init.vars ?? [],
        range: init.range ?? [
            0,
            1
        ],
        viewRange: null,
        ease: init.ease ?? settle,
        own: init.own ?? null,
        origin: init.origin ?? null,
        duration: init.duration ?? null,
        reducible: init.reducible ?? false,
        asset: null,
        flow: false,
        inks: null,
        keyframes: null
    };
}
export function asExit(e) {
    const tracks = {};
    for (const [p, from, to] of e.entries)tracks[p] = [
        to,
        from
    ];
    const vars = e.vars.map((v)=>({
            ...v,
            from: v.to,
            to: v.from
        }));
    const ease = e.ease;
    return {
        ...makeEffect({
            tracks,
            vars,
            ease: (t)=>1 - ease(1 - t),
            own: e.own,
            origin: e.origin,
            reducible: e.reducible
        }),
        range: [
            1 - e.range[1],
            1 - e.range[0]
        ],
        flow: e.flow,
        inks: e.inks
    };
}
export function turned(e) {
    const tracks = {};
    for (const [p, from, to] of e.entries)tracks[p] = [
        to,
        from
    ];
    return {
        ...e,
        tracks,
        entries: e.entries.map(([p, from, to])=>[
                p,
                to,
                from
            ]),
        vars: e.vars.map((v)=>({
                ...v,
                from: v.to,
                to: v.from
            }))
    };
}
const selects = (select, prop)=>select === 'all' || prop === 'clip' === (select === 'clip');
export function evaluate(effects, p, frame, select, before = false) {
    resetFrame(frame);
    for (const e of effects){
        const [a, b] = e.range;
        const q = b <= a ? p > b || !before && p === b ? 1 : 0 : p <= a ? 0 : p >= b ? 1 : (p - a) / (b - a);
        const t = e.ease(q);
        for (const [prop, from, to] of e.entries){
            if (selects(select, prop)) applyTrack(frame, prop, from, to, t);
        }
        if (select !== 'clip') for (const v of e.vars)frame.vars.set(v.name, varValue(v, t));
    }
}
export function usedVars(effects, select) {
    const names = new Set();
    if (select !== 'clip') for (const e of effects)for (const v of e.vars)names.add(v.name);
    return names;
}
export function usedProps(effects, select) {
    const used = new Set();
    for (const e of effects){
        for (const [p] of e.entries)if (selects(select, p)) used.add(p);
    }
    return used;
}
const presets = new Map();
function amount(arg, levels, report, preset, units = [
    ''
]) {
    if (arg === undefined || arg === '') return {
        value: levels.normal,
        unit: units[0]
    };
    if (arg === 'soft' || arg === 'strong') return {
        value: levels[arg],
        unit: units[0]
    };
    const m = /^(-?\d*\.?\d+)([a-z%]*)$/.exec(arg);
    if (m && units.includes(m[2])) return {
        value: Number(m[1]),
        unit: m[2]
    };
    const accepted = units.map((u)=>u ? `n${u}` : 'n').join(', ');
    report(`${preset}(${arg}): expected soft, strong or ${accepted}`);
    return {
        value: levels.normal,
        unit: units[0]
    };
}
const WIPE = {
    left: [
        0,
        100,
        0,
        0
    ],
    right: [
        0,
        0,
        0,
        100
    ],
    top: [
        0,
        0,
        100,
        0
    ],
    bottom: [
        100,
        0,
        0,
        0
    ],
    up: [
        100,
        0,
        0,
        0
    ],
    down: [
        0,
        0,
        100,
        0
    ],
    center: [
        0,
        50,
        0,
        50
    ]
};
const CLEAR = [
    0,
    0,
    0,
    0
];
function wipeTrack(side, report) {
    const from = WIPE[side ?? 'left'];
    if (!from) report(`wipe(${side}): expected ${Object.keys(WIPE).join(', ')}`);
    return {
        clip: [
            from ?? WIPE.left,
            CLEAR
        ]
    };
}
function focusTracks(arg, report) {
    const blur = amount(arg, {
        soft: 2.5,
        normal: 4.5,
        strong: 9
    }, report, 'focus', [
        '',
        'px'
    ]).value;
    return {
        blur: [
            Math.max(0, blur),
            0
        ],
        opacity: [
            0.34,
            1
        ]
    };
}
function scaleArg(arg, fallback, report, preset) {
    if (arg === undefined || arg === '') return fallback;
    const n = Number(arg);
    if (Number.isFinite(n) && n >= 0) return n;
    report(`${preset}(${arg}): expected a scale such as 1.06`);
    return fallback;
}
presets.set('fade', ()=>makeEffect({
        tracks: {
            opacity: [
                0,
                1
            ]
        },
        duration: 600
    }));
const LINE_EASE = cubicBezier(0.19, 0.8, 0.22, 1);
presets.set('rise', (args, report)=>{
    if (args[0] === 'line') {
        return makeEffect({
            tracks: {
                yp: [
                    105,
                    0
                ],
                rotate: [
                    2.5,
                    0
                ]
            },
            ease: LINE_EASE,
            origin: 'left bottom',
            duration: 950
        });
    }
    const a = amount(args[0], {
        soft: 20,
        normal: 40,
        strong: 80
    }, report, 'rise', [
        '',
        'px',
        '%'
    ]);
    const track = a.unit === '%' ? 'yp' : 'y';
    return makeEffect({
        tracks: {
            opacity: [
                0,
                1
            ],
            [track]: [
                a.value,
                0
            ]
        },
        duration: 950
    });
});
presets.set('grow', (args, report)=>{
    const from = args[0] === undefined || args[0] === 'soft' || args[0] === 'strong' ? ({
        soft: 0.96,
        normal: 0.9,
        strong: 0.8
    })[args[0] ?? 'normal'] : scaleArg(args[0], 0.9, report, 'grow');
    return makeEffect({
        tracks: {
            opacity: [
                0,
                1
            ],
            scale: [
                from,
                1
            ]
        },
        duration: 800
    });
});
presets.set('focus', (args, report)=>{
    if (args[0] === 'band') {
        const tracks = focusTracks(args[1], report);
        const into = makeEffect({
            tracks,
            ease: linear,
            own: 'view',
            range: [
                0,
                0.46
            ]
        });
        const out = asExit(makeEffect({
            tracks,
            ease: linear,
            own: 'view'
        }));
        return [
            into,
            {
                ...out,
                range: [
                    0.54,
                    1
                ]
            }
        ];
    }
    return makeEffect({
        tracks: focusTracks(args[0], report),
        duration: 900
    });
});
presets.set('wipe', (args, report)=>makeEffect({
        tracks: wipeTrack(args[0], report),
        ease: pan,
        duration: 1100
    }));
presets.set('push', (args, report)=>{
    const word = args[0] === 'in' || args[0] === 'out' ? args[0] : null;
    const [from, to] = word ? word === 'in' ? [
        1,
        1.16
    ] : [
        1.16,
        1
    ] : [
        scaleArg(args[0], 1.06, report, 'push'),
        scaleArg(args[1], 1, report, 'push')
    ];
    const origin = args[word ? 1 : 2] ?? null;
    if (origin !== null && !/^[\w\s.%-]+$/.test(origin)) report(`push focus "${origin}" is not a position`);
    return makeEffect({
        tracks: {
            scale: [
                from,
                to
            ]
        },
        ease: pan,
        origin,
        duration: 1200
    });
});
presets.set('develop', ()=>({
        ...makeEffect({
            tracks: {}
        }),
        asset: 'develop'
    }));
const INKS = {
    blue: [
        '#0f1d45',
        '#a9cfea'
    ],
    orange: [
        '#1a120e',
        '#f08a2c'
    ],
    terracotta: [
        '#1d1814',
        '#d4673f'
    ],
    mono: [
        '#000',
        '#fff'
    ]
};
presets.set('duotone', (args, report)=>{
    const [dark, light] = INKS.blue;
    let inks = [
        `var(--cv-duotone-dark,${dark})`,
        `var(--cv-duotone-light,${light})`
    ];
    if (args.length === 1 && INKS[args[0]]) inks = INKS[args[0]];
    else if (args.length === 2 && args.every(isColor)) inks = [
        args[0],
        args[1]
    ];
    else if (args.length) {
        report(`duotone(${args.join(', ')}): expected ${Object.keys(INKS).join(', ')}, or a dark and a light colour`);
    }
    return {
        ...makeEffect({
            tracks: {
                opacity: [
                    0,
                    1
                ]
            },
            duration: 900
        }),
        inks
    };
});
presets.set('unroll', ()=>({
        ...makeEffect({
            tracks: {
                xw: [
                    100,
                    0
                ],
                xp: [
                    -100,
                    0
                ]
            },
            ease: linear,
            own: 'view'
        }),
        flow: true
    }));
presets.set('invert', ()=>({
        ...makeEffect({
            tracks: {}
        }),
        asset: 'invert'
    }));
const IDENT = /^-?[_a-zA-Z][\w-]*$/;
presets.set('keyframes', (args, report)=>{
    const arg = args[0] ?? '';
    const quoted = /^(["'])(.+)\1$/.exec(arg);
    if (args.length !== 1 || !(quoted || IDENT.test(arg))) {
        report(`keyframes(${args.join(', ')}): expected the name of an @keyframes rule`);
        return [];
    }
    return {
        ...makeEffect({
            tracks: {},
            ease: linear
        }),
        keyframes: quoted ? quoted[2] : arg
    };
});
presets.set('draw', ()=>makeEffect({
        tracks: {
            draw: [
                0,
                1
            ]
        },
        ease: pan,
        duration: 1400
    }));
presets.set('count', ()=>makeEffect({
        tracks: {
            count: [
                0,
                1
            ]
        },
        ease: linear,
        reducible: true
    }));
const SWEEP = cubicBezier(0.45, 0, 0.2, 1);
const OWN_AXES = new Set([
    'wght',
    'wdth',
    'opsz'
]);
presets.set('axis', (args, report)=>{
    const vars = [];
    for (const arg of args.length ? args : [
        'wght 200'
    ]){
        const [tag = '', ...values] = arg.split(/\s+/);
        const numbers = values.map(Number);
        const [from = 0, to = Number.NaN] = numbers;
        if (!/^[a-zA-Z\d]{4}$/.test(tag) || !numbers.length || numbers.length > 2 || !numbers.every(Number.isFinite)) {
            report(`axis(${arg}): expected an axis and one or two numbers, such as wght 300 800`);
        } else if (numbers.length === 1 && !OWN_AXES.has(tag)) {
            report(`axis(${arg}): ${tag} needs a start and an end value`);
        } else {
            vars.push({
                name: `${AXIS}${tag}`,
                from,
                to,
                unit: ''
            });
        }
    }
    return makeEffect({
        tracks: {},
        vars,
        ease: SWEEP,
        duration: 1100
    });
});
export function withOwnAxes(e, own) {
    const left = (v)=>v.unit !== null && (Number.isNaN(v.from) || Number.isNaN(v.to));
    if (!e.vars.some(left)) return e;
    const value = (name, n)=>Number.isNaN(n) ? own(name.slice(AXIS.length)) : n;
    const vars = e.vars.map((v)=>v.unit === null ? v : {
            ...v,
            from: value(v.name, v.from),
            to: value(v.name, v.to)
        });
    return {
        ...e,
        vars
    };
}
presets.set('reveal', (args, report)=>[
        makeEffect({
            tracks: focusTracks(args[1], report),
            duration: 1200
        }),
        makeEffect({
            tracks: wipeTrack(args[0], report),
            ease: pan,
            duration: 1200
        }),
        makeEffect({
            tracks: {
                scale: [
                    1.06,
                    1
                ]
            },
            ease: pan,
            duration: 1200
        })
    ]);
presets.set('drift', (args, report)=>{
    const a = amount(args[0], {
        soft: 3.5,
        normal: 10,
        strong: 16
    }, report, 'drift', [
        '%',
        '',
        'px'
    ]);
    const track = a.unit === '%' ? 'yp' : 'y';
    return makeEffect({
        tracks: {
            [track]: [
                -a.value,
                a.value
            ]
        },
        ease: linear,
        own: 'view',
        reducible: true
    });
});
presets.set('skew', (args, report)=>{
    const a = amount(args[0], {
        soft: 2,
        normal: 4,
        strong: 8
    }, report, 'skew', [
        '',
        'deg'
    ]);
    return makeEffect({
        tracks: {
            sky: [
                0,
                -a.value
            ],
            sy: [
                1,
                1 + a.value * 0.025
            ]
        },
        ease: linear,
        own: 'velocity',
        reducible: true
    });
});
const angle = (arg, fallback, report)=>{
    if (arg === undefined || arg === '') return fallback;
    const m = /^(-?\d*\.?\d+)(deg|turn|rad)?$/.exec(arg);
    if (m) return Number(m[1]) * (m[2] === 'turn' ? 360 : m[2] === 'rad' ? 180 / Math.PI : 1);
    report(`hue(${arg}): expected an angle such as 180deg or .5turn`);
    return fallback;
};
presets.set('hue', (args, report)=>{
    const [from, to] = args.length > 1 ? [
        angle(args[0], 0, report),
        angle(args[1], 360, report)
    ] : [
        0,
        angle(args[0], 360, report)
    ];
    return makeEffect({
        tracks: {},
        vars: [
            {
                name: '--cv-hue',
                from,
                to,
                unit: 'deg'
            }
        ],
        ease: linear,
        own: 'view'
    });
});
const legacy = (tracks)=>()=>makeEffect({
            tracks,
            ease: easeInOut,
            duration: 600
        });
presets.set('fade-in', legacy({
    opacity: [
        0,
        1
    ]
}));
presets.set('slide-up', legacy({
    yp: [
        100,
        0
    ],
    opacity: [
        0,
        1
    ]
}));
presets.set('zoom-in', legacy({
    scale: [
        0,
        1
    ],
    opacity: [
        0,
        1
    ]
}));
presets.set('rotate-in', legacy({
    rotate: [
        -180,
        0
    ],
    scale: [
        0,
        1
    ],
    opacity: [
        0,
        1
    ]
}));
presets.set('blur-in', legacy({
    blur: [
        10,
        0
    ],
    opacity: [
        0,
        1
    ]
}));
export const presetNames = ()=>[
        ...presets.keys()
    ];
const declarationText = (d)=>d === undefined ? null : typeof d === 'string' ? d : Object.entries(d).map(([k, v])=>`${k}:${v}`).join(';');
function fromDefinition(def, report) {
    const fromText = declarationText(def.from);
    const toText = declarationText(def.to);
    const from = parseDeclarations(fromText, report);
    const to = parseDeclarations(toText, report);
    const ease = def.ease === undefined ? settle : parseEase(def.ease);
    if (!ease) report(`Unknown ease "${def.ease}"`);
    return makeEffect({
        tracks: tracksBetween(from, to),
        vars: varsBetween(parseVars(fromText, report), parseVars(toText, report), report),
        ease: ease ?? settle,
        own: def.on ?? null,
        origin: def.origin ?? null,
        duration: def.duration ?? null,
        ...def.range ? {
            range: def.range
        } : {}
    });
}
export const NAME = /^[a-z][a-z0-9-]*$/;
const custom = new Set();
const definedListeners = new Set();
export const onEffectDefined = (listener)=>{
    definedListeners.add(listener);
    return ()=>definedListeners.delete(listener);
};
export function defineEffect(name, definition) {
    if (!NAME.test(name)) throw new TypeError(`defineEffect: "${name}" is not a valid name (a-z, 0-9, -)`);
    if (presets.has(name) && !custom.has(name)) {
        throw new TypeError(`defineEffect: "${name}" is a built-in preset`);
    }
    custom.add(name);
    presets.set(name, (args, report)=>{
        const result = typeof definition === 'function' ? definition(args) : definition;
        const list = Array.isArray(result) ? result : [
            result
        ];
        return list.map((d)=>fromDefinition(d, report));
    });
    definedListeners.forEach((listener)=>listener(name));
}
const VIEW_NAMES = new Set([
    'cover',
    'contain',
    'entry',
    'exit',
    'entry-crossing',
    'exit-crossing'
]);
export function splitTop(text) {
    const parts = [];
    let depth = 0;
    let start = 0;
    for(let i = 0; i < text.length; i++){
        const c = text[i];
        if (c === '(') depth++;
        else if (c === ')') depth = Math.max(0, depth - 1);
        else if (c === ',' && depth === 0) {
            parts.push(text.slice(start, i));
            start = i + 1;
        }
    }
    parts.push(text.slice(start));
    return parts;
}
function parseRange(text) {
    const tokens = text.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return {
        range: [
            0,
            1
        ],
        view: null
    };
    const pct = (t)=>{
        const m = t === undefined ? null : /^(-?\d*\.?\d+)%$/.exec(t);
        return m ? Number(m[1]) / 100 : null;
    };
    const edges = [];
    let i = 0;
    while(i < tokens.length && edges.length < 2){
        const t = tokens[i];
        if (VIEW_NAMES.has(t)) {
            const offset = pct(tokens[i + 1]);
            edges.push({
                name: t,
                offset
            });
            i += offset === null ? 1 : 2;
        } else {
            const offset = pct(t);
            if (offset === null) return null;
            edges.push({
                name: null,
                offset
            });
            i += 1;
        }
    }
    if (i < tokens.length || !edges.length) return null;
    const [a, b] = edges;
    const named = a.name !== null || b !== undefined && b.name !== null;
    if (!named) {
        const start = a.offset ?? 0;
        const end = b?.offset ?? 1;
        return {
            range: [
                start,
                end
            ],
            view: null
        };
    }
    const startName = a.name ?? 'cover';
    const start = {
        name: startName,
        offset: a.offset ?? 0
    };
    const end = b ? {
        name: b.name ?? startName,
        offset: b.offset ?? 1
    } : {
        name: startName,
        offset: 1
    };
    return {
        range: [
            0,
            1
        ],
        view: [
            start,
            end
        ]
    };
}
export function parseItem(item) {
    const m = /^([a-z][a-z0-9-]*)\s*(?:\(((?:[^()]|\([^()]*\))*)\))?\s*(.*)$/.exec(item);
    const range = m ? parseRange(m[3]) : null;
    if (!m || !range) return null;
    const parts = m[2] === undefined ? [] : splitTop(m[2]).map((s)=>s.trim());
    const args = parts.length === 1 && parts[0] === '' ? [] : parts;
    return {
        name: m[1],
        args,
        range
    };
}
export function parseItems(text, report) {
    const out = [];
    for (const raw of splitTop(text ?? '')){
        const item = raw.trim();
        if (!item) continue;
        const parsed = parseItem(item);
        if (parsed) out.push(parsed);
        else report(`Cannot parse fx item "${item}"`);
    }
    return out;
}
export function parseFx(text, report) {
    const out = [];
    for (const raw of splitTop(text ?? '')){
        if (!raw.trim()) continue;
        const item = parseItem(raw.trim());
        if (!item) {
            report(`Cannot parse fx item "${raw.trim()}"`);
            continue;
        }
        const factory = presets.get(item.name);
        if (!factory) {
            report(`Unknown preset "${item.name}"`, 'unknown-effect');
            continue;
        }
        const made = factory(item.args, (m)=>report(m));
        for (const e of Array.isArray(made) ? made : [
            made
        ]){
            out.push(applyRange(e, item.range));
        }
    }
    return out;
}
function applyRange(e, r) {
    const [a, b] = r.range;
    const [x, y] = e.range;
    return {
        ...e,
        range: [
            a + (b - a) * x,
            a + (b - a) * y
        ],
        viewRange: r.view ?? e.viewRange
    };
}
export function withoutKeyframes(effects, list, report) {
    return effects.filter((e)=>{
        if (e.keyframes) report(`keyframes(${e.keyframes}) plays in fx, not ${list}`);
        return !e.keyframes;
    });
}
export function parseExit(text, ease, report) {
    if (!text) return [];
    if (text.includes(':')) {
        const target = parseDeclarations(text, report);
        return [
            makeEffect({
                tracks: tracksBetween({}, target),
                vars: varsBetween({}, parseVars(text, report), report),
                ease: ease ?? easeInOut
            })
        ];
    }
    return withoutKeyframes(parseFx(text, report), 'exit', report).map((e)=>asExit(ease ? {
            ...e,
            ease
        } : e));
}
export function parseFromTo(from, to, ease, report) {
    if (from === null && to === null) return null;
    const tracks = tracksBetween(parseDeclarations(from, report), parseDeclarations(to, report));
    const vars = varsBetween(parseVars(from, report), parseVars(to, report), report);
    if (!Object.keys(tracks).length && !vars.length) return null;
    return makeEffect({
        tracks,
        vars,
        ease: ease ?? easeInOut
    });
}
export function samplePoints(effects, samples = 12) {
    const points = new Set();
    const steps = new Set();
    const add = (p)=>{
        if (p >= 0 && p <= 1) points.add(p);
    };
    for(let i = 0; i <= samples; i++)add(i / samples);
    for (const { range: [a, b] } of effects){
        if (b <= a) {
            if (b >= 0 && b <= 1) {
                points.add(b);
                steps.add(b);
            }
        } else {
            for(let i = 0; i <= samples; i++)add(i === samples ? b : a + (b - a) * i / samples);
        }
    }
    return [
        ...points
    ].sort((a, b)=>a - b).flatMap((offset)=>steps.has(offset) ? [
            {
                offset,
                before: true
            },
            {
                offset,
                before: false
            }
        ] : [
            {
                offset,
                before: false
            }
        ]);
}
export function sampleKeyframes(effects, select, css, frame, samples = 12) {
    return samplePoints(effects, samples).map(({ offset, before })=>{
        evaluate(effects, offset, frame, select, before);
        return {
            offset,
            ...css(frame)
        };
    });
}
