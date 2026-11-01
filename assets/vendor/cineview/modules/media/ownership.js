const PROGRESS_EPSILON = 0.001;
const TAKEOVER_HYSTERESIS = 0.02;
const SEEK_EPSILON_SECONDS = 0.0001;
function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
function isValidDuration(duration) {
    return Number.isFinite(duration) && duration > 0;
}
function normalizedRange(duration, scrubRange) {
    if (!isValidDuration(duration)) return null;
    if (!scrubRange) return [
        0,
        duration
    ];
    const from = Number.isFinite(scrubRange[0]) ? clamp(scrubRange[0], 0, duration) : 0;
    const to = Number.isFinite(scrubRange[1]) ? clamp(scrubRange[1], 0, duration) : duration;
    return [
        from,
        to
    ];
}
export function mapVideoScrubProgress(progress, duration, scrubRange) {
    const range = normalizedRange(duration, scrubRange);
    if (!range) return null;
    const normalizedProgress = clamp(Number.isFinite(progress) ? progress : 0, 0, 1);
    return range[0] + normalizedProgress * (range[1] - range[0]);
}
export function createVideoPlaybackOwnershipState(activationId) {
    return {
        activationId,
        status: 'framework-scrub',
        activePlayRequestId: null,
        settledPlayRequestId: null,
        nextPlayRequestId: 1,
        lastSeekTime: null,
        endpointLatched: false,
        outgoing: null,
        frameworkPlayBlocked: false,
        frameworkPausePending: false
    };
}
function result(state, commands = []) {
    return {
        state,
        commands
    };
}
function resetState(state, activationId) {
    return {
        ...createVideoPlaybackOwnershipState(activationId),
        nextPlayRequestId: state.nextPlayRequestId
    };
}
function isNativeOwner(status) {
    return status === 'native-playback' || status === 'native-paused' || status === 'play-pending';
}
function isScrubSource(source) {
    return source === 'gesture' || source === 'continuation' || source === 'programmatic' || source === 'scroll' || source === 'visibility' || source === 'clock';
}
function shouldTakeOverNativeOwner(state, frame) {
    if (state.endpointLatched && frame.progress >= 1 - TAKEOVER_HYSTERESIS) return false;
    if (frame.source === 'scroll' || frame.source === 'visibility') return true;
    if (frame.source !== 'gesture') return false;
    return frame.progress < 1 - TAKEOVER_HYSTERESIS;
}
function canReclaimTerminalState(state, frame) {
    if (state.status !== 'ended' && state.status !== 'play-rejected') return true;
    const canDriveReverse = frame.source === 'gesture' || frame.source === 'scroll' || frame.source === 'visibility';
    return canDriveReverse && frame.progress < 1 - TAKEOVER_HYSTERESIS;
}
function shouldAutoPlay(event, endpointLatched) {
    if (!event.scrubRange || endpointLatched || event.frame.progress < 1 - PROGRESS_EPSILON) {
        return false;
    }
    const range = normalizedRange(event.duration, event.scrubRange);
    if (!range) return false;
    return range[1] < event.duration - SEEK_EPSILON_SECONDS;
}
function reduceOutgoingFrame(state, event) {
    const { frame } = event;
    const playing = state.status === 'native-playback' || state.status === 'play-pending';
    const outgoing = state.outgoing ?? {
        time: event.currentTime !== undefined && Number.isFinite(event.currentTime) ? clamp(event.currentTime, 0, event.duration) : state.lastSeekTime ?? mapVideoScrubProgress(1, event.duration, event.scrubRange),
        reverse: false,
        resumePlayback: playing
    };
    const reverse = frame.source !== 'scroll' && frame.source !== 'visibility' && (frame.signedProgress < 0 || frame.progress === 0 && outgoing.reverse);
    const startTime = mapVideoScrubProgress(0, event.duration, event.scrubRange);
    const targetTime = reverse && outgoing.time !== null && startTime !== null ? outgoing.time + clamp(frame.progress, 0, 1) * (startTime - outgoing.time) : outgoing.reverse ? outgoing.time : null;
    const commands = [];
    if (!state.outgoing && playing) commands.push({
        type: 'pause'
    });
    if (targetTime !== null && (state.lastSeekTime === null || Math.abs(state.lastSeekTime - targetTime) > SEEK_EPSILON_SECONDS)) {
        commands.push({
            type: 'seek',
            time: targetTime
        });
    }
    if (state.outgoing && !reverse && !outgoing.reverse) return result(state);
    return result({
        ...state,
        status: 'framework-scrub',
        activePlayRequestId: null,
        lastSeekTime: targetTime,
        outgoing: outgoing.reverse || !reverse ? outgoing : {
            ...outgoing,
            reverse: true
        },
        frameworkPlayBlocked: state.frameworkPlayBlocked || playing || state.settledPlayRequestId !== null,
        frameworkPausePending: state.frameworkPausePending || !state.outgoing && playing
    }, commands);
}
function restoreDeparture(state) {
    const outgoing = state.outgoing;
    if (!outgoing) return result(state);
    const commands = [];
    if (outgoing.time !== null && (state.lastSeekTime === null || Math.abs(state.lastSeekTime - outgoing.time) > SEEK_EPSILON_SECONDS)) {
        commands.push({
            type: 'seek',
            time: outgoing.time
        });
    }
    const requestId = outgoing.resumePlayback ? state.nextPlayRequestId : null;
    if (requestId !== null) commands.push({
        type: 'play',
        requestId
    });
    return result({
        ...state,
        status: requestId === null ? 'framework-scrub' : 'play-pending',
        activePlayRequestId: requestId,
        settledPlayRequestId: null,
        nextPlayRequestId: requestId === null ? state.nextPlayRequestId : requestId + 1,
        lastSeekTime: outgoing.time,
        endpointLatched: true,
        outgoing: null
    }, commands);
}
function reduceTimelineFrame(state, event) {
    const { frame } = event;
    if (frame.phase === 'exiting' || frame.phase === 'exited') {
        return reduceOutgoingFrame(state, event);
    }
    if (state.outgoing && (frame.phase === 'entered' || frame.phase === 'entering' && event.dragSceneActive !== undefined)) {
        if (event.dragSceneActive === false) return result(state);
        return restoreDeparture(state);
    }
    if (!state.outgoing && state.endpointLatched && frame.phase === 'entered' && frame.progress >= 1 - PROGRESS_EPSILON) {
        return result(state);
    }
    const needsInitialFrame = (frame.phase === 'entering' || frame.phase === 'entered') && state.status === 'framework-scrub' && state.lastSeekTime === null && event.dragSceneActive !== false;
    if (!state.outgoing && !isScrubSource(frame.source) && !needsInitialFrame) {
        return result(state);
    }
    if (!canReclaimTerminalState(state, frame)) return result(state);
    const targetTime = mapVideoScrubProgress(frame.progress, event.duration, event.scrubRange);
    if (targetTime === null) return result(state);
    if (isNativeOwner(state.status)) {
        if (!shouldTakeOverNativeOwner(state, frame)) return result(state);
        const commands = [];
        const shouldPause = state.status === 'native-playback' || state.status === 'play-pending';
        if (shouldPause) {
            commands.push({
                type: 'pause'
            });
        }
        if (state.lastSeekTime === null || Math.abs(state.lastSeekTime - targetTime) > SEEK_EPSILON_SECONDS) {
            commands.push({
                type: 'seek',
                time: targetTime
            });
        }
        return result({
            ...state,
            status: 'framework-scrub',
            activePlayRequestId: null,
            lastSeekTime: targetTime,
            endpointLatched: false,
            outgoing: null,
            frameworkPlayBlocked: true,
            frameworkPausePending: shouldPause
        }, commands);
    }
    const commands = [];
    if (state.lastSeekTime === null || Math.abs(state.lastSeekTime - targetTime) > SEEK_EPSILON_SECONDS) {
        commands.push({
            type: 'seek',
            time: targetTime
        });
    }
    if (shouldAutoPlay(event, state.endpointLatched)) {
        const requestId = state.nextPlayRequestId;
        commands.push({
            type: 'play',
            requestId
        });
        return result({
            ...state,
            status: 'play-pending',
            activePlayRequestId: requestId,
            settledPlayRequestId: null,
            nextPlayRequestId: requestId + 1,
            lastSeekTime: targetTime,
            endpointLatched: true,
            outgoing: null,
            frameworkPlayBlocked: false
        }, commands);
    }
    const atEndpoint = Boolean(event.scrubRange && frame.progress >= 1 - PROGRESS_EPSILON);
    const leftEndpoint = frame.progress < 1 - TAKEOVER_HYSTERESIS;
    return result({
        ...state,
        status: 'framework-scrub',
        activePlayRequestId: null,
        lastSeekTime: targetTime,
        endpointLatched: atEndpoint ? true : leftEndpoint ? false : state.endpointLatched,
        outgoing: null
    }, commands);
}
export function reduceVideoPlaybackOwnership(state, event) {
    switch(event.type){
        case 'restore-native':
            {
                const requestId = event.playing ? state.nextPlayRequestId : null;
                return result({
                    ...state,
                    status: requestId !== null ? 'play-pending' : event.ended ? 'ended' : 'native-paused',
                    lastSeekTime: event.time,
                    endpointLatched: true,
                    activePlayRequestId: requestId,
                    nextPlayRequestId: requestId === null ? state.nextPlayRequestId : requestId + 1
                }, requestId === null ? [
                    {
                        type: 'seek',
                        time: event.time
                    }
                ] : [
                    {
                        type: 'seek',
                        time: event.time
                    },
                    {
                        type: 'play',
                        requestId
                    }
                ]);
            }
        case 'timeline-frame':
            return reduceTimelineFrame(state, event);
        case 'media-play':
            if (event.activationId !== state.activationId) return result(state);
            if (event.requestId !== undefined) {
                const activeRequestMatches = state.activePlayRequestId === event.requestId;
                const settledRequestMatches = state.status === 'native-playback' && !state.frameworkPlayBlocked && state.settledPlayRequestId === event.requestId;
                if (!activeRequestMatches && !settledRequestMatches) {
                    return result({
                        ...state,
                        frameworkPausePending: true,
                        frameworkPlayBlocked: true
                    }, [
                        {
                            type: 'pause'
                        }
                    ]);
                }
                return result({
                    ...state,
                    status: 'native-playback',
                    activePlayRequestId: null,
                    settledPlayRequestId: event.requestId,
                    frameworkPausePending: false,
                    frameworkPlayBlocked: false
                });
            }
            if (state.frameworkPlayBlocked) {
                return result({
                    ...state,
                    frameworkPausePending: true
                }, [
                    {
                        type: 'pause'
                    }
                ]);
            }
            return result({
                ...state,
                status: 'native-playback',
                activePlayRequestId: null,
                settledPlayRequestId: null,
                frameworkPausePending: false,
                frameworkPlayBlocked: false
            });
        case 'media-pause':
            if (event.activationId !== state.activationId) return result(state);
            if (state.frameworkPausePending) {
                return result({
                    ...state,
                    frameworkPausePending: false
                });
            }
            return result({
                ...state,
                status: state.status === 'ended' ? 'ended' : 'native-paused',
                activePlayRequestId: null,
                settledPlayRequestId: state.status === 'ended' ? state.settledPlayRequestId : null,
                frameworkPlayBlocked: state.status === 'ended' ? state.frameworkPlayBlocked : false
            });
        case 'media-ended':
            if (event.activationId !== state.activationId) return result(state);
            return result({
                ...state,
                status: 'ended',
                activePlayRequestId: null,
                endpointLatched: true,
                frameworkPausePending: false
            });
        case 'play-resolved':
            if (state.activePlayRequestId !== event.requestId) return result(state);
            return result({
                ...state,
                status: 'native-playback',
                activePlayRequestId: null,
                settledPlayRequestId: event.requestId,
                frameworkPlayBlocked: false,
                frameworkPausePending: false
            });
        case 'play-rejected':
            if (state.activePlayRequestId !== event.requestId) return result(state);
            return result({
                ...state,
                status: 'play-rejected',
                activePlayRequestId: null,
                settledPlayRequestId: null,
                frameworkPlayBlocked: false,
                frameworkPausePending: false
            });
        case 'activate':
            if (state.activationId === event.activationId) return result(state);
            return result(resetState(state, event.activationId));
        case 'reset':
            return result(resetState(state, event.activationId));
    }
}
