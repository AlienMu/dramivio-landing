export function rangeSpan(name, height, viewport) {
    const low = Math.min(height, viewport);
    const high = Math.max(height, viewport);
    switch(name){
        case 'cover':
            return [
                0,
                viewport + height
            ];
        case 'contain':
            return [
                low,
                high
            ];
        case 'entry':
            return [
                0,
                low
            ];
        case 'exit':
            return [
                high,
                viewport + height
            ];
        case 'entry-crossing':
            return [
                0,
                height
            ];
        case 'exit-crossing':
            return [
                viewport,
                viewport + height
            ];
    }
}
const edgeAt = (edge, height, viewport)=>{
    const [a, b] = rangeSpan(edge.name, height, viewport);
    return a + (b - a) * edge.offset;
};
export function viewProgress(top, height, viewport, range) {
    const at = viewport - top;
    const start = range ? edgeAt(range[0], height, viewport) : 0;
    const end = range ? edgeAt(range[1], height, viewport) : viewport + height;
    if (end <= start) return at >= end ? 1 : 0;
    return at <= start ? 0 : at >= end ? 1 : (at - start) / (end - start);
}
export function rangeCss(range) {
    if (!range) return {
        rangeStart: 'cover 0%',
        rangeEnd: 'cover 100%'
    };
    const css = (e)=>`${e.name} ${+(e.offset * 100).toFixed(4)}%`;
    return {
        rangeStart: css(range[0]),
        rangeEnd: css(range[1])
    };
}
export function sameRange(a, b) {
    if (!a || !b) return a === b;
    return a[0].name === b[0].name && a[0].offset === b[0].offset && a[1].name === b[1].name && a[1].offset === b[1].offset;
}
