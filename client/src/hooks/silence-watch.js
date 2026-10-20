// client/src/hooks/silence-watch.js
// 超过 limitMs 一个字节都没收到（后端每 5 秒会发一次心跳），就认为连接已经断了。
export function watchSilence(onSilent, { limitMs = 15000, checkMs = 5000 } = {}) {
    let lastReceived = Date.now();
    const timer = setInterval(() => {
        if (Date.now() - lastReceived > limitMs) {
            clearInterval(timer);
            onSilent();
        }
    }, checkMs);
    return {
        touch: () => { lastReceived = Date.now(); },
        stop: () => clearInterval(timer)
    };
}