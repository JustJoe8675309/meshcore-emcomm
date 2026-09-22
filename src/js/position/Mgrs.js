/**
 * Latitude and longitude to MGRS, the grid reference search and rescue teams
 * and military maps use.
 *
 * UTM by Krüger's series in n to sixth order (the method Karney showed is good
 * to a few nanometres within a zone), then the MGRS lettering: the latitude
 * band, and the 100 km square named by a column letter and a row letter. The
 * Norway and Svalbard zone exceptions are applied, since MGRS includes them.
 *
 * MGRS proper stops at 84 N and 80 S; the polar regions use a different grid,
 * which this does not produce. Those return null.
 */

const WGS84_A = 6378137;
const WGS84_F = 1 / 298.257223563;

const K0 = 0.9996;
const FALSE_EASTING = 500000;
const FALSE_NORTHING_SOUTH = 10000000;

const BANDS = "CDEFGHJKLMNPQRSTUVWXX"; // 8 degrees each from 80 S; X runs to 84 N
const COLUMN_SETS = ["ABCDEFGH", "JKLMNPQR", "STUVWXYZ"];
const ROW_LETTERS = "ABCDEFGHJKLMNPQRSTUV";

const DEG = Math.PI / 180;

class Mgrs {

    /** The UTM zone for a position, including the Norway and Svalbard exceptions. */
    static zone(latitude, longitude) {

        let lon = ((longitude + 180) % 360 + 360) % 360 - 180;
        let zone = Math.floor((lon + 180) / 6) + 1;
        if(zone > 60){
            zone = 60;
        }

        // south west Norway is widened into zone 32
        if(latitude >= 56 && latitude < 64 && lon >= 3 && lon < 12){
            zone = 32;
        }

        // Svalbard uses 31, 33, 35 and 37 only
        if(latitude >= 72 && latitude < 84){
            if(lon >= 0 && lon < 9) zone = 31;
            else if(lon >= 9 && lon < 21) zone = 33;
            else if(lon >= 21 && lon < 33) zone = 35;
            else if(lon >= 33 && lon < 42) zone = 37;
        }

        return zone;

    }

    /** UTM easting and northing in metres, in a given zone. */
    static toUtm(latitude, longitude, zone = this.zone(latitude, longitude)) {

        const n = WGS84_F / (2 - WGS84_F);
        const n2 = n * n, n3 = n2 * n, n4 = n3 * n, n5 = n4 * n, n6 = n5 * n;
        const e = Math.sqrt(WGS84_F * (2 - WGS84_F));

        const A = WGS84_A / (1 + n) * (1 + n2 / 4 + n4 / 64 + n6 / 256);

        const alpha = [
            null,
            n / 2 - 2 * n2 / 3 + 5 * n3 / 16 + 41 * n4 / 180 - 127 * n5 / 288 + 7891 * n6 / 37800,
            13 * n2 / 48 - 3 * n3 / 5 + 557 * n4 / 1440 + 281 * n5 / 630 - 1983433 * n6 / 1935360,
            61 * n3 / 240 - 103 * n4 / 140 + 15061 * n5 / 26880 + 167603 * n6 / 181440,
            49561 * n4 / 161280 - 179 * n5 / 168 + 6601661 * n6 / 7257600,
            34729 * n5 / 80640 - 3418889 * n6 / 1995840,
            212378941 * n6 / 319334400,
        ];

        const centralMeridian = ((zone - 1) * 6 - 180 + 3) * DEG;
        const phi = latitude * DEG;
        const lambda = longitude * DEG - centralMeridian;

        const tau = Math.tan(phi);
        const sigma = Math.sinh(e * Math.atanh(e * tau / Math.sqrt(1 + tau * tau)));
        const tauP = tau * Math.sqrt(1 + sigma * sigma) - sigma * Math.sqrt(1 + tau * tau);

        const xiP = Math.atan2(tauP, Math.cos(lambda));
        const etaP = Math.asinh(Math.sin(lambda) / Math.sqrt(tauP * tauP + Math.cos(lambda) * Math.cos(lambda)));

        let xi = xiP;
        let eta = etaP;
        for(let j = 1; j <= 6; j++){
            xi += alpha[j] * Math.sin(2 * j * xiP) * Math.cosh(2 * j * etaP);
            eta += alpha[j] * Math.cos(2 * j * xiP) * Math.sinh(2 * j * etaP);
        }

        const easting = K0 * A * eta + FALSE_EASTING;
        let northing = K0 * A * xi;
        if(latitude < 0){
            northing += FALSE_NORTHING_SOUTH;
        }

        return { zone, hemisphere: latitude < 0 ? "S" : "N", easting, northing };

    }

    /** The latitude band letter, or null outside 80 S to 84 N. */
    static band(latitude) {
        if(latitude < -80 || latitude > 84){
            return null;
        }
        return BANDS[Math.min(Math.floor((latitude + 80) / 8), BANDS.length - 1)];
    }

    /**
     * The MGRS reference, as its parts and as text, e.g. "13R DR 12345 67890".
     * digits is per coordinate: 5 is one metre, 4 is ten metres. Digits are
     * truncated, not rounded, which is the MGRS convention: a reference names
     * the square the point is in.
     */
    static fromLatLon(latitude, longitude, digits = 5) {

        if(latitude == null || longitude == null || !isFinite(latitude) || !isFinite(longitude)){
            return null;
        }

        const band = this.band(latitude);
        if(band == null){
            return null;
        }

        const utm = this.toUtm(latitude, longitude);

        const column = COLUMN_SETS[(utm.zone - 1) % 3][Math.floor(utm.easting / 100000) - 1];
        let row = Math.floor(utm.northing / 100000) % 20;
        if(utm.zone % 2 === 0){
            row = (row + 5) % 20;
        }
        const square = column + ROW_LETTERS[row];

        const scale = Math.pow(10, 5 - digits);
        const pad = (value) => String(Math.floor((value % 100000) / scale)).padStart(digits, "0");
        const easting = pad(utm.easting);
        const northing = pad(utm.northing);

        return {
            zone: utm.zone,
            band,
            square,
            easting,
            northing,
            text: `${utm.zone}${band} ${square} ${easting} ${northing}`,
        };

    }

    /**
     * UTM back to latitude and longitude, by Krüger's inverse series to sixth
     * order and Newton's method for the latitude, as Karney gives it.
     */
    static fromUtm(zone, hemisphere, easting, northing) {

        const n = WGS84_F / (2 - WGS84_F);
        const n2 = n * n, n3 = n2 * n, n4 = n3 * n, n5 = n4 * n, n6 = n5 * n;
        const e = Math.sqrt(WGS84_F * (2 - WGS84_F));
        const A = WGS84_A / (1 + n) * (1 + n2 / 4 + n4 / 64 + n6 / 256);

        const beta = [
            null,
            n / 2 - 2 * n2 / 3 + 37 * n3 / 96 - n4 / 360 - 81 * n5 / 512 + 96199 * n6 / 604800,
            n2 / 48 + n3 / 15 - 437 * n4 / 1440 + 46 * n5 / 105 - 1118711 * n6 / 3870720,
            17 * n3 / 480 - 37 * n4 / 840 - 209 * n5 / 4480 + 5569 * n6 / 90720,
            4397 * n4 / 161280 - 11 * n5 / 504 - 830251 * n6 / 7257600,
            4583 * n5 / 161280 - 108847 * n6 / 3991680,
            20648693 * n6 / 638668800,
        ];

        const x = easting - FALSE_EASTING;
        const y = hemisphere === "S" ? northing - FALSE_NORTHING_SOUTH : northing;
        const eta = x / (K0 * A);
        const xi = y / (K0 * A);

        let xiP = xi;
        let etaP = eta;
        for(let j = 1; j <= 6; j++){
            xiP -= beta[j] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
            etaP -= beta[j] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
        }

        const sinhEtaP = Math.sinh(etaP);
        const sinXiP = Math.sin(xiP);
        const cosXiP = Math.cos(xiP);
        const tauP = sinXiP / Math.sqrt(sinhEtaP * sinhEtaP + cosXiP * cosXiP);

        let tau = tauP;
        for(let i = 0; i < 20; i++){
            const sigma = Math.sinh(e * Math.atanh(e * tau / Math.sqrt(1 + tau * tau)));
            const tauI = tau * Math.sqrt(1 + sigma * sigma) - sigma * Math.sqrt(1 + tau * tau);
            const delta = (tauP - tauI) / Math.sqrt(1 + tauI * tauI)
                * (1 + (1 - e * e) * tau * tau) / ((1 - e * e) * Math.sqrt(1 + tau * tau));
            tau += delta;
            if(Math.abs(delta) < 1e-12){
                break;
            }
        }

        const centralMeridian = ((zone - 1) * 6 - 180 + 3) * DEG;
        const latitude = Math.atan(tau) / DEG;
        const longitude = (Math.atan2(sinhEtaP, cosXiP) + centralMeridian) / DEG;
        return { latitude, longitude };

    }

    /**
     * An MGRS reference typed by an operator, as latitude and longitude, or null
     * if it cannot be read. Spaces are optional, letters any case, and from 2 to
     * 10 digits (an even number: half easting, half northing). A reference names a
     * square, so the position given is its centre, and the square's size is
     * returned as the precision: 1 m for ten digits, 10 m for eight, and so on.
     */
    static toLatLon(reference) {

        const text = String(reference ?? "").toUpperCase().replace(/\s+/g, "");
        const match = text.match(/^(\d{1,2})([C-HJ-NP-X])([A-HJ-NP-Z])([A-HJ-NP-V])(\d*)$/);
        if(!match){
            return null;
        }

        const zone = Number(match[1]);
        const band = match[2];
        const column = match[3];
        const row = match[4];
        const digits = match[5];
        if(zone < 1 || zone > 60 || digits.length % 2 !== 0 || digits.length > 10){
            return null;
        }

        const columnIndex = COLUMN_SETS[(zone - 1) % 3].indexOf(column);
        if(columnIndex < 0){
            return null;
        }
        let rowIndex = ROW_LETTERS.indexOf(row);
        if(zone % 2 === 0){
            rowIndex = (rowIndex - 5 + 20) % 20;
        }

        const half = digits.length / 2;
        const precision = half === 0 ? 100000 : Math.pow(10, 5 - half);
        const eastingDigits = half === 0 ? 0 : Number(digits.slice(0, half)) * precision;
        const northingDigits = half === 0 ? 0 : Number(digits.slice(half)) * precision;

        const easting = (columnIndex + 1) * 100000 + eastingDigits + precision / 2;
        let northing = rowIndex * 100000 + northingDigits + precision / 2;

        // the row letters repeat every 2000 km, so the band says which repeat:
        // the first at or above the band's southern edge, allowing for a square
        // that straddles it
        const bandIndex = BANDS.indexOf(band);
        const bandSouth = -80 + bandIndex * 8;
        const hemisphere = bandSouth < 0 ? "S" : "N";
        const bandSouthNorthing = this.toUtm(bandSouth, (zone - 1) * 6 - 180 + 3, zone).northing;
        while(northing < bandSouthNorthing - 100000){
            northing += 2000000;
        }

        const position = this.fromUtm(zone, hemisphere, easting, northing);

        // a letter pair that lands outside its own band is a mistyped reference
        const landed = this.band(position.latitude);
        if(landed !== band && !(band === "X" && landed === "X")){
            const next = BANDS[bandIndex + 1];
            const previous = BANDS[bandIndex - 1];
            if(landed !== next && landed !== previous){
                return null;
            }
        }

        return { ...position, precisionMetres: precision };

    }

}

export default Mgrs;
