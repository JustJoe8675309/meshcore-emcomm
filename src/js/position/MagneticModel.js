/**
 * Magnetic declination from the World Magnetic Model, worked out on the device.
 *
 * A bearing an operator can walk needs to be magnetic: that is what a hand
 * compass reads. The difference from true north is the declination, which
 * varies from place to place and year to year. Working it out here, from the
 * published coefficients, means it needs no network, which matters in exactly
 * the conditions this app is for.
 *
 * This is the standard WMM synthesis: the spherical harmonic sum to degree 12
 * with Schmidt semi-normalised Legendre functions, evaluated at the geocentric
 * position and rotated back to geodetic. It is checked against NOAA's own test
 * values for WMM2025.
 */

import { WMM_COEFFICIENTS, WMM_EPOCH, WMM_NAME, WMM_VALID_UNTIL } from "./wmm2025.js";

// WGS 84, which is what radios and GPS report positions in
const WGS84_A = 6378.137;
const WGS84_F = 1 / 298.257223563;
const WGS84_E2 = WGS84_F * (2 - WGS84_F);

// the geomagnetic reference radius the coefficients are scaled to, in km
const REFERENCE_RADIUS = 6371.2;

const MAX_DEGREE = 12;

const DEG = Math.PI / 180;

class MagneticModel {

    static NAME = WMM_NAME;
    static EPOCH = WMM_EPOCH;
    static VALID_UNTIL = WMM_VALID_UNTIL;

    /** A date as a decimal year, e.g. 21 September 2026 is about 2026.72. */
    static decimalYear(date) {
        const year = date.getUTCFullYear();
        const start = Date.UTC(year, 0, 1);
        const end = Date.UTC(year + 1, 0, 1);
        return year + (date.getTime() - start) / (end - start);
    }

    /** Whether the model covers this date. Outside it the answer drifts, and should say so. */
    static isValidOn(date) {
        const year = this.decimalYear(date);
        return year >= WMM_EPOCH && year < WMM_VALID_UNTIL;
    }

    /**
     * The magnetic field at a place and time: north, east and down components in
     * nanotesla, and the declination in degrees, east positive.
     *
     * latitude and longitude in degrees (geodetic, WGS 84), heightKm above the
     * ellipsoid, year a decimal year.
     */
    static field(latitude, longitude, heightKm, year) {

        const dt = year - WMM_EPOCH;

        // coefficients carried forward to the date
        const g = [];
        const h = [];
        for(let n = 0; n <= MAX_DEGREE; n++){
            g.push(new Array(n + 1).fill(0));
            h.push(new Array(n + 1).fill(0));
        }
        for(const [n, m, gnm, hnm, dg, dh] of WMM_COEFFICIENTS){
            g[n][m] = gnm + dt * dg;
            h[n][m] = hnm + dt * dh;
        }

        // geodetic to geocentric
        const phi = latitude * DEG;
        const lambda = longitude * DEG;
        const sinPhi = Math.sin(phi);
        const cosPhi = Math.cos(phi);
        const rc = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinPhi * sinPhi);
        const p = (rc + heightKm) * cosPhi;
        const z = (rc * (1 - WGS84_E2) + heightKm) * sinPhi;
        const r = Math.sqrt(p * p + z * z);
        const phiC = Math.asin(z / r);

        // colatitude terms for the Legendre functions
        const ct = Math.sin(phiC);
        const st = Math.cos(phiC);

        // Gauss normalised associated Legendre functions and their derivatives in
        // colatitude, then Schmidt factors to bring them to the model's normalisation
        const P = [];
        const dP = [];
        const S = [];
        for(let n = 0; n <= MAX_DEGREE; n++){
            P.push(new Array(n + 1).fill(0));
            dP.push(new Array(n + 1).fill(0));
            S.push(new Array(n + 1).fill(0));
        }
        P[0][0] = 1;
        S[0][0] = 1;
        for(let n = 1; n <= MAX_DEGREE; n++){
            for(let m = 0; m <= n; m++){
                if(n === m){
                    P[n][m] = st * P[n - 1][m - 1];
                    dP[n][m] = st * dP[n - 1][m - 1] + ct * P[n - 1][m - 1];
                } else {
                    const k = n > 1 ? ((n - 1) * (n - 1) - m * m) / ((2 * n - 1) * (2 * n - 3)) : 0;
                    const p2 = n > 1 && m <= n - 2 ? P[n - 2][m] : 0;
                    const dp2 = n > 1 && m <= n - 2 ? dP[n - 2][m] : 0;
                    P[n][m] = ct * P[n - 1][m] - k * p2;
                    dP[n][m] = ct * dP[n - 1][m] - st * P[n - 1][m] - k * dp2;
                }
            }
            S[n][0] = S[n - 1][0] * (2 * n - 1) / n;
            for(let m = 1; m <= n; m++){
                S[n][m] = S[n][m - 1] * Math.sqrt((n - m + 1) * (m === 1 ? 2 : 1) / (n + m));
            }
        }

        // the harmonic sums, in the geocentric frame
        let bRadial = 0;
        let bTheta = 0;
        let bPhi = 0;
        for(let n = 1; n <= MAX_DEGREE; n++){
            const ratio = Math.pow(REFERENCE_RADIUS / r, n + 2);
            for(let m = 0; m <= n; m++){
                const cosM = Math.cos(m * lambda);
                const sinM = Math.sin(m * lambda);
                const gs = g[n][m] * S[n][m];
                const hs = h[n][m] * S[n][m];
                const term = gs * cosM + hs * sinM;
                bRadial += (n + 1) * ratio * term * P[n][m];
                bTheta -= ratio * term * dP[n][m];
                bPhi += ratio * m * (gs * sinM - hs * cosM) * P[n][m];
            }
        }
        // the east component divides by the sine of the colatitude, which is zero
        // only at the geocentric poles, where declination has no meaning anyway
        bPhi = st === 0 ? 0 : bPhi / st;

        const xC = -bTheta;
        const yC = bPhi;
        const zC = -bRadial;

        // back to the geodetic frame the position was given in
        const psi = phiC - phi;
        const north = xC * Math.cos(psi) - zC * Math.sin(psi);
        const east = yC;
        const down = xC * Math.sin(psi) + zC * Math.cos(psi);

        return {
            north,
            east,
            down,
            declination: Math.atan2(east, north) / DEG,
        };

    }

    /**
     * Declination in degrees, east positive, at a place on a date, at sea level.
     * A handheld's height makes no difference worth showing.
     */
    static declination(latitude, longitude, date = new Date()) {
        return this.field(latitude, longitude, 0, this.decimalYear(date)).declination;
    }

}

export default MagneticModel;
