// Tests the serial RX framing path that the BLE firmware left unexercised.
// Feeds synthetic device frames through SerialConnection.onDataReceived() and
// checks the right events come out, under realistic USB CDC chunking.

import SerialConnection from "../node_modules/@liamcottle/meshcore.js/src/connection/serial_connection.js";

const FRAME_INCOMING = 0x3e; // ">"
const CODE_CHANNEL_INFO = 18;
const CODE_CHANNEL_MSG_RECV = 8;

let failures = 0;
function check(name, condition, detail = "") {
    if (condition) console.log(`  PASS  ${name}`);
    else { failures++; console.log(`  FAIL  ${name} ${detail}`); }
}

class FakeSerialConnection extends SerialConnection {
    constructor() {
        super();
        this.written = [];
    }
    async write(bytes) { this.written.push(Array.from(bytes)); }
}

// wraps payload bytes in the 3 byte serial frame header the firmware uses
function frame(payload) {
    const len = payload.length;
    return [FRAME_INCOMING, len & 0xff, (len >> 8) & 0xff, ...payload];
}

// ChannelInfo: code, idx(u8), name(cstring 32), secret(16 bytes)
function channelInfoPayload(idx, name, secretByte) {
    const nameBytes = new Array(32).fill(0);
    [...Buffer.from(name, "utf8")].forEach((b, i) => nameBytes[i] = b);
    return [CODE_CHANNEL_INFO, idx, ...nameBytes, ...new Array(16).fill(secretByte)];
}

// ChannelMsgRecv: code, channelIdx(i8), pathLen(u8), txtType(u8), senderTimestamp(u32le), text
function channelMsgPayload(channelIdx, text) {
    const ts = 1758300000;
    return [
        CODE_CHANNEL_MSG_RECV, channelIdx, 0xff, 0,
        ts & 0xff, (ts >> 8) & 0xff, (ts >> 16) & 0xff, (ts >> 24) & 0xff,
        ...Buffer.from(text, "utf8"),
    ];
}

// the library's emit() dispatches callbacks via setTimeout, so let them run
const flush = () => new Promise((r) => setTimeout(r, 10));

function collect(conn) {
    const events = { channelInfo: [], channelMsg: [] };
    conn.on(CODE_CHANNEL_INFO, (r) => events.channelInfo.push(r));
    conn.on(CODE_CHANNEL_MSG_RECV, (r) => events.channelMsg.push(r));
    return events;
}

console.log("=== 1. single frame arriving in one chunk ===");
{
    const c = new FakeSerialConnection();
    const ev = collect(c);
    await c.onDataReceived(frame(channelInfoPayload(5, "#test", 0xab)));
    await flush();
    check("ChannelInfo decoded", ev.channelInfo.length === 1, `got ${ev.channelInfo.length}`);
    check("channelIdx correct", ev.channelInfo[0]?.channelIdx === 5, `got ${ev.channelInfo[0]?.channelIdx}`);
    check("name correct", ev.channelInfo[0]?.name === "#test", `got "${ev.channelInfo[0]?.name}"`);
    check("secret is 16 bytes", ev.channelInfo[0]?.secret?.length === 16);
}

console.log("\n=== 2. frame split byte by byte (worst case USB CDC chunking) ===");
{
    const c = new FakeSerialConnection();
    const ev = collect(c);
    const bytes = frame(channelInfoPayload(8, "#dac-ares", 0x11));
    for (const b of bytes) await c.onDataReceived([b]);
    await flush();
    check("still decodes exactly once", ev.channelInfo.length === 1, `got ${ev.channelInfo.length}`);
    check("name intact across chunks", ev.channelInfo[0]?.name === "#dac-ares", `got "${ev.channelInfo[0]?.name}"`);
}

console.log("\n=== 3. frame split at the header boundary ===");
{
    const c = new FakeSerialConnection();
    const ev = collect(c);
    const bytes = frame(channelInfoPayload(1, "Family Channel", 0x22));
    await c.onDataReceived(bytes.slice(0, 2));   // partial header
    await flush();
    check("nothing emitted on partial header", ev.channelInfo.length === 0);
    await c.onDataReceived(bytes.slice(2));
    await flush();
    check("completes once the rest arrives", ev.channelInfo.length === 1);
    check("name correct", ev.channelInfo[0]?.name === "Family Channel", `got "${ev.channelInfo[0]?.name}"`);
}

console.log("\n=== 4. several frames coalesced into one chunk ===");
{
    const c = new FakeSerialConnection();
    const ev = collect(c);
    await c.onDataReceived([
        ...frame(channelInfoPayload(0, "Public", 0x01)),
        ...frame(channelInfoPayload(1, "Family Channel", 0x02)),
        ...frame(channelInfoPayload(2, "#alert", 0x03)),
    ]);
    await flush();
    check("all three decoded", ev.channelInfo.length === 3, `got ${ev.channelInfo.length}`);
    check("in order", ev.channelInfo.map((c) => c.name).join(",") === "Public,Family Channel,#alert",
        ev.channelInfo.map((c) => c.name).join(","));
}

console.log("\n=== 5. a real report round trips over serial framing ===");
{
    const c = new FakeSerialConnection();
    const ev = collect(c);
    const report = "KJ5HBN: CHECK-IN\nCALL: KJ5HBN\nLOC: TEST\nSTA: PORTABLE\nPWR: BATTERY\nTFC: NO";
    await c.onDataReceived(frame(channelMsgPayload(5, report)));
    await flush();
    check("channel message decoded", ev.channelMsg.length === 1);
    check("text survives byte for byte", ev.channelMsg[0]?.text === report,
        JSON.stringify(ev.channelMsg[0]?.text));
    check("newlines preserved", (ev.channelMsg[0]?.text.match(/\n/g) || []).length === 5);
}

console.log("\n=== 6. resync after leading noise (ESP32 boot output) ===");
{
    const c = new FakeSerialConnection();
    const ev = collect(c);
    const boot = [...Buffer.from("rst:0x1 (POWERON),boot:0x8\r\nload:0x3fce3808\r\n", "utf8")];
    await c.onDataReceived([...boot, ...frame(channelInfoPayload(6, "#weather", 0x44))]);
    await flush();
    check("recovers and decodes the real frame", ev.channelInfo.length === 1, `got ${ev.channelInfo.length}`);
    check("name correct after resync", ev.channelInfo[0]?.name === "#weather", `got "${ev.channelInfo[0]?.name}"`);
}

console.log("\n=== 7. noise containing a stray '>' before a real frame ===");
{
    const c = new FakeSerialConnection();
    const ev = collect(c);
    // 0x3e is ">" which is also the frame start byte, so boot text containing ">"
    // can look like a frame header. this is the realistic desync hazard.
    const noise = [...Buffer.from("boot> ready\r\n", "utf8")];
    await c.onDataReceived([...noise, ...frame(channelInfoPayload(9, "#las-cruces", 0x55))]);
    await flush();
    console.log(`       decoded ${ev.channelInfo.length} frame(s): ${ev.channelInfo.map((c) => c.name).join(",") || "none"}`);
    check("does not crash on ambiguous noise", true);
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
