export function coverProgress(card, nextRest, nextTop) {
    const from = card.rest + card.height;
    if (from <= nextRest) return nextTop <= nextRest ? 1 : 0;
    return Math.min(1, Math.max(0, (from - nextTop) / (from - nextRest)));
}
export function hides(card, next) {
    return next.rest <= card.rest + 0.5 && next.rest + next.height >= card.rest + card.height - 0.5 && next.left <= card.left + 0.5 && next.left + next.width >= card.left + card.width - 0.5;
}
