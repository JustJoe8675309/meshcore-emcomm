// The arithmetic behind a position: magnetic declination, MGRS, distance and
// bearing, and how each is written.
//
// A bearing an operator walks has to be right, so each piece is checked against
// published reference values rather than against itself: NOAA's own test values
// for the World Magnetic Model, the MGRS references for well known points, and a
// distance and bearing any atlas gives.

import { describe, it, expect } from "vitest";
import MagneticModel from "../../src/js/position/MagneticModel.js";
import Mgrs from "../../src/js/position/Mgrs.js";
import Geo from "../../src/js/position/Geo.js";

// WMM2025_TEST_VALUES.txt, from NOAA NCEI's WMM2025COF.zip: decimal year, height
// above the ellipsoid in km, latitude, longitude, X, Y, Z in nT, declination
const NOAA_TEST_VALUES = [
    [2025.0, 0.0, 80.0, 0.0, 6521.6, 145.9, 54791.5, 1.28],
    [2025.0, 0.0, 0.0, 120.0, 39677.8, -109.6, -10580.2, -0.16],
    [2025.0, 0.0, -80.0, 240.0, 6117.5, 15751.9, -52022.5, 68.78],
    [2025.0, 100.0, 80.0, 0.0, 6216.0, 92.4, 52598.8, 0.85],
    [2025.0, 100.0, 0.0, 120.0, 37688.6, -96.2, -10152.1, -0.15],
    [2025.0, 100.0, -80.0, 240.0, 5907.6, 14780.3, -49540.7, 68.21],
    [2027.5, 0.0, 80.0, 0.0, 6500.8, 294.5, 54869.4, 2.59],
    [2027.5, 0.0, 0.0, 120.0, 39701.6, -167.4, -10381.8, -0.24],
    [2027.5, 0.0, -80.0, 240.0, 6200.7, 15730.3, -51783.7, 68.49],
    [2027.5, 100.0, 80.0, 0.0, 6196.7, 233.8, 52670.5, 2.16],
    [2027.5, 100.0, 0.0, 120.0, 37711.5, -148.7, -9969.8, -0.23],
    [2027.5, 100.0, -80.0, 240.0, 5984.0, 14760.1, -49317.7, 67.93],
];

describe("the World Magnetic Model", () => {

    for(const [year, height, lat, lon, x, y, z, declination] of NOAA_TEST_VALUES){
        it(`matches NOAA at ${lat}, ${lon}, ${height} km, ${year}`, () => {
            const field = MagneticModel.field(lat, lon, height, year);
            // the published values are to a tenth of a nanotesla and a hundredth of a degree
            expect(Math.abs(field.north - x)).toBeLessThan(0.06);
            expect(Math.abs(field.east - y)).toBeLessThan(0.06);
            expect(Math.abs(field.down - z)).toBeLessThan(0.06);
            expect(Math.abs(field.declination - declination)).toBeLessThan(0.006);
        });
    }

    it("is current from 2025 to the end of 2029, and says so after", () => {
        expect(MagneticModel.isValidOn(new Date(Date.UTC(2026, 8, 21)))).toBe(true);
        expect(MagneticModel.isValidOn(new Date(Date.UTC(2029, 11, 31)))).toBe(true);
        expect(MagneticModel.isValidOn(new Date(Date.UTC(2030, 0, 2)))).toBe(false);
        expect(MagneticModel.isValidOn(new Date(Date.UTC(2024, 11, 31)))).toBe(false);
    });

    it("gives the bench about seven and a half degrees east", () => {
        // El Paso: published charts put it a little over 7 degrees east
        const d = MagneticModel.declination(31.76, -106.49, new Date(Date.UTC(2026, 8, 21)));
        expect(d).toBeGreaterThan(6.5);
        expect(d).toBeLessThan(8.5);
    });

});

describe("MGRS", () => {

    it("names the origin as every reference does", () => {
        expect(Mgrs.fromLatLon(0, 0).text).toBe("31N AA 66021 00000");
    });

    it("names the Eiffel Tower as the published reference does", () => {
        expect(Mgrs.fromLatLon(48.8582, 2.2945).text).toBe("31U DQ 48251 11932");
    });

    it("truncates rather than rounds, so a reference names the square the point is in", () => {
        const utm = Mgrs.toUtm(48.8582, 2.2945);
        expect(utm.easting % 1).toBeGreaterThan(0.5);
        expect(Mgrs.fromLatLon(48.8582, 2.2945).easting).toBe("48251");
    });

    it("gives fewer digits when asked, down to ten metres", () => {
        expect(Mgrs.fromLatLon(0, 0, 4).text).toBe("31N AA 6602 0000");
    });

    it("widens zone 32 over south west Norway and uses the Svalbard zones", () => {
        expect(Mgrs.zone(60, 5)).toBe(32);
        expect(Mgrs.zone(78, 15)).toBe(33);
        expect(Mgrs.zone(78, 7)).toBe(31);
    });

    it("puts the southern hemisphere on the false northing", () => {
        const sydney = Mgrs.fromLatLon(-33.8568, 151.2153);
        expect(sydney.zone).toBe(56);
        expect(sydney.band).toBe("H");
    });

    it("has nothing to say beyond 84 north or 80 south, where MGRS stops", () => {
        expect(Mgrs.fromLatLon(85, 0)).toBe(null);
        expect(Mgrs.fromLatLon(-81, 0)).toBe(null);
        expect(Mgrs.fromLatLon(null, 0)).toBe(null);
    });

});

describe("distance and bearing", () => {

    it("gets London to Paris right", () => {
        const r = Geo.relation({ latitude: 51.5074, longitude: -0.1278 }, { latitude: 48.8566, longitude: 2.3522 });
        expect(r.metres / 1000).toBeCloseTo(343.6, 0);
        expect(r.trueBearing).toBeCloseTo(148.1, 0);
    });

    it("turns true into magnetic with the declination where the viewer stands", () => {
        const from = { latitude: 31.7587, longitude: -106.4869 };
        const to = { latitude: 31.7880, longitude: -106.4970 };
        const date = new Date(Date.UTC(2026, 8, 21));
        const r = Geo.relation(from, to, date);
        const declination = MagneticModel.declination(from.latitude, from.longitude, date);
        expect(r.declination).toBeCloseTo(declination, 6);
        expect(Geo.normaliseDegrees(r.magneticBearing + r.declination)).toBeCloseTo(r.trueBearing, 6);
    });

    it("has no answer when either end has no position, 0, 0 included", () => {
        expect(Geo.relation({ latitude: 0, longitude: 0 }, { latitude: 31, longitude: -106 })).toBe(null);
        expect(Geo.relation({ latitude: 31, longitude: -106 }, null)).toBe(null);
    });

});

describe("how positions are written", () => {

    it("states a bearing as three digits and the word magnetic, always", () => {
        expect(Geo.formatMagneticBearing(47.4)).toBe("047° magnetic");
        expect(Geo.formatMagneticBearing(359.6)).toBe("000° magnetic");
        expect(Geo.formatMagneticBearing(5)).toBe("005° magnetic");
    });

    it("gives distance in miles and kilometres together", () => {
        expect(Geo.formatDistance(5150)).toBe("3.2 mi (5.2 km)");
        expect(Geo.formatDistance(40000)).toBe("25 mi (40 km)");
    });

    it("gives the declination used, and which side", () => {
        expect(Geo.formatDeclination(7.41)).toBe("declination 7.4° E");
        expect(Geo.formatDeclination(-12.25)).toBe("declination 12.3° W");
    });

    it("gives degrees with hemispheres rather than signs", () => {
        expect(Geo.formatDegrees(31.7619, -106.485)).toBe("31.7619° N, 106.4850° W");
    });

    it("gives the ten digit MGRS reference", () => {
        expect(Geo.formatMgrs(31.7619, -106.485)).toBe("13R CR 59365 15004");
    });

});
