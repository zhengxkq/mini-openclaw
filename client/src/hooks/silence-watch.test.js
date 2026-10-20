import test from "node:test";
import assert from "node:assert/strict";
import { watchSilence } from "./silence-watch.js";

test("10.3 收到数据就重新计时，超过 15 秒一个字节都没有才判定断线", t => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"] });
    let silent = 0;
    const watch = watchSilence(() => { silent++; });

    t.mock.timers.tick(10000);
    watch.touch();
    t.mock.timers.tick(10000);
    console.log("收到心跳后又过 10 秒，判定断线次数：", silent);
    assert.equal(silent, 0);

    t.mock.timers.tick(10000);
    console.log("连续 20 秒没有数据，判定断线次数：", silent);
    assert.equal(silent, 1);

    t.mock.timers.tick(30000);
    assert.equal(silent, 1);
    watch.stop();
});