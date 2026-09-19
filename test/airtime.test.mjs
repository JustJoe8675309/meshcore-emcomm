// Checks the airtime estimate shown on the confirmation step.
// The numbers drive an operator decision about occupying a shared channel,
// so they need to be right rather than merely plausible.

import Airtime from "../src/js/reports/Airtime.js";

const MAX_PACKET_PAYLOAD = 184; // src/MeshCore.h

let failures = 0;
function check(name, condition, detail = "") {
    if (condition) console.log(`  PASS  ${name}`);
    else { failures++; console.log(`  FAIL  ${name} ${detail}`); }
}

const node = "Joe-KJ5HBN-HTv3";           // 15 chars, so a 17 byte prefix
const radio = { sf: 7, bandwidthHz: 62500, codingRate: 5 };
const selfInfo = { radioSf: 7, radioBw: 62500, radioCr: 5 };

console.log("=== packet sizing mirrors the firmware ===");
{
    // channel: 1 channel hash + encrypted(5 + 17 prefix + 143 text) padded + MAC, plus 2 byte header
    const channelBytes = Airtime.getPacketBytes(143, "channel", node);
    check(`full channel part is ${channelBytes} bytes`, channelBytes === 181, `got ${channelBytes}`);
    check("channel packet fits MAX_PACKET_PAYLOAD", channelBytes <= MAX_PACKET_PAYLOAD);

    // contact: 2 hashes, no sender prefix, full 160 byte text
    const contactBytes = Airtime.getPacketBytes(160, "contact", node);
    check(`full direct part is ${contactBytes} bytes`, contactBytes === 182, `got ${contactBytes}`);
    check("direct packet fits MAX_PACKET_PAYLOAD", contactBytes <= MAX_PACKET_PAYLOAD);

    // the node name only costs airtime on channel messages
    const longName = "A".repeat(40);
    check("a long node name grows a channel packet",
        Airtime.getPacketBytes(100, "channel", longName) > Airtime.getPacketBytes(100, "channel", node));
    check("a long node name does not affect a direct packet",
        Airtime.getPacketBytes(100, "contact", longName) === Airtime.getPacketBytes(100, "contact", node));
}

console.log("\n=== time on air matches the LoRa calculation ===");
{
    // hand calculated for SF7 / 62.5kHz / 4:5 / 32 symbol preamble, 181 byte packet:
    //   Tsym = 2^7 / 62500 = 2.048 ms
    //   payload symbols = 8 + ceil((8*181 - 4*7 + 28 + 16) / (4*7)) * 5 = 273
    //   total = (32 + 4.25 + 273) * 2.048 = 633.3 ms
    const toa = Airtime.getTimeOnAirMillis(181, radio);
    check(`181 byte packet is ${toa.toFixed(1)} ms`, Math.abs(toa - 633.3) < 0.5, `got ${toa.toFixed(2)}`);

    // MeshCore uses a 32 symbol preamble at SF8 and below, 16 above
    check("preamble is 32 symbols at SF7", Airtime.getPreambleSymbols(7) === 32);
    check("preamble is 16 symbols at SF10", Airtime.getPreambleSymbols(10) === 16);

    // a higher spreading factor is always slower
    const bySf = [7, 8, 9, 10, 11].map((sf) => Airtime.getTimeOnAirMillis(181, { ...radio, sf }));
    check(`airtime rises with spreading factor (${bySf.map((t) => Math.round(t)).join(" -> ")} ms)`,
        bySf.every((t, i) => i === 0 || t > bySf[i - 1]));

    // a wider bandwidth is always faster
    const narrow = Airtime.getTimeOnAirMillis(181, { ...radio, bandwidthHz: 62500 });
    const wide = Airtime.getTimeOnAirMillis(181, { ...radio, bandwidthHz: 250000 });
    check("wider bandwidth is faster", wide < narrow, `${Math.round(wide)} vs ${Math.round(narrow)}`);

    // heavier coding costs more airtime
    const cr45 = Airtime.getTimeOnAirMillis(181, { ...radio, codingRate: 5 });
    const cr48 = Airtime.getTimeOnAirMillis(181, { ...radio, codingRate: 8 });
    check("4/8 coding is slower than 4/5", cr48 > cr45, `${Math.round(cr48)} vs ${Math.round(cr45)}`);
}

console.log("\n=== whole report estimates ===");
{
    const gap = 2000;
    const part = "x".repeat(143);

    const one = Airtime.estimate([part], "channel", node, selfInfo, gap);
    check("a single part has no inter part gap", Math.abs(one.totalMillis - one.transmitMillis) < 0.001);

    const three = Airtime.estimate([part, part, part], "channel", node, selfInfo, gap);
    check("three parts include two gaps",
        Math.abs(three.totalMillis - (three.transmitMillis + 2 * gap)) < 0.001);
    check("three parts transmit roughly three times as long",
        Math.abs(three.transmitMillis - 3 * one.transmitMillis) < 1);

    // the total is what the operator actually waits through
    const many = Airtime.estimate(Array(78).fill(part), "channel", node, selfInfo, gap);
    check(`78 parts totals ${Airtime.formatDuration(many.totalMillis)}`,
        many.totalMillis > 3 * 60 * 1000 && many.totalMillis < 4 * 60 * 1000,
        `${Math.round(many.totalMillis)} ms`);

    check("no estimate without radio settings",
        Airtime.estimate([part], "channel", node, { radioSf: null }, gap) === null);
    check("no estimate without parts", Airtime.estimate([], "channel", node, selfInfo, gap) === null);
}

console.log("\n=== duration formatting ===");
{
    check('0.63 s reads as "0.6 s"', Airtime.formatDuration(633) === "0.6 s", Airtime.formatDuration(633));
    check('26 s reads as "26 s"', Airtime.formatDuration(26000) === "26 s", Airtime.formatDuration(26000));
    check('64 s reads as "1 min 4 s"', Airtime.formatDuration(64000) === "1 min 4 s", Airtime.formatDuration(64000));
    check('203 s reads as "3 min 23 s"', Airtime.formatDuration(203000) === "3 min 23 s", Airtime.formatDuration(203000));
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
