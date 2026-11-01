const LOOKS = {
    dim: {
        veil: 0.5,
        scale: 1
    },
    recede: {
        veil: 0.3,
        scale: 0.92
    }
};
export const COVER_RANGE = [
    {
        name: 'entry',
        offset: 0
    },
    {
        name: 'entry',
        offset: 1
    }
];
export function parseCovered(value, reducedMotion, report) {
    if (value === null) return null;
    const look = LOOKS[value.trim()];
    if (!look) {
        report(`covered="${value}": expected dim or recede`);
        return null;
    }
    return reducedMotion ? {
        ...look,
        scale: 1
    } : look;
}
export function withVeilColour(look, colour) {
    return colour.trim() ? {
        ...look,
        veil: 1
    } : look;
}
export function writeCover(host, veil, look, p) {
    veil.style.opacity = String(look.veil * p);
    host.style.scale = look.scale === 1 || p === 0 ? '' : String(1 - (1 - look.scale) * p);
}
export function writeCardCover(card, look, p, coloured = false) {
    if (coloured) {
        if (p > 0) card.style.setProperty('--cv-cover', String(+p.toFixed(4)));
        else card.style.removeProperty('--cv-cover');
    } else card.style.filter = p > 0 ? `brightness(${1 - look.veil * p})` : '';
    card.style.scale = look.scale === 1 || p === 0 ? '' : String(1 - (1 - look.scale) * p);
}
export function clearCover(host, veil) {
    veil.style.opacity = '';
    host.style.scale = '';
}
export function coverKeyframes(look) {
    return {
        veil: [
            {
                opacity: 0
            },
            {
                opacity: look.veil
            }
        ],
        host: look.scale === 1 ? null : [
            {
                scale: '1'
            },
            {
                scale: String(look.scale)
            }
        ]
    };
}
