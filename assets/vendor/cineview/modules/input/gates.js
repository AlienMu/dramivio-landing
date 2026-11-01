const EYE = 0.45;
export function gates(g) {
    const height = Math.max(g.bottom - g.top, 0);
    const above = g.bottom <= 0;
    const onScreen = g.bottom > 0 && g.top < g.vh;
    if (g.eye) {
        const line = g.vh * EYE;
        const at = g.top <= line && g.bottom >= line;
        return {
            enter: at,
            exit: !at,
            above,
            onScreen,
            oversized: false
        };
    }
    if (g.partial) {
        const inView = height > 0 && g.vh > 0 && g.bottom > 0 && g.top < g.vh;
        return {
            enter: inView,
            exit: !inView,
            above,
            onScreen,
            oversized: false
        };
    }
    const oversized = height > g.vh - g.enterMargin;
    if (oversized) {
        const exit = g.bottom <= g.vh * 0.7;
        return {
            enter: g.top <= g.vh / 2 && !exit,
            exit,
            above,
            onScreen,
            oversized
        };
    }
    return {
        enter: g.top >= 0 && g.bottom <= g.vh - g.enterMargin,
        exit: g.top <= g.exitMargin || g.bottom >= g.vh - g.exitMargin,
        above,
        onScreen,
        oversized
    };
}
export function gateAction(phase, enter, exit, options) {
    switch(phase){
        case 'idle':
            return enter && !exit ? 'enter' : null;
        case 'entering':
        case 'entered':
            return exit && !enter && options.hasExit ? 'exit' : null;
        case 'exiting':
        case 'exited':
            return enter && !exit && options.replay ? 'enter' : null;
        default:
            return null;
    }
}
