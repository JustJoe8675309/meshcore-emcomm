/**
 * Distance and bearing between two positions, and how they are written.
 *
 * Great circle on a sphere of the earth's mean radius. Over the tens of
 * kilometres a mesh spans, that is within about half a percent of the
 * ellipsoid, far closer than anyone paces a distance or reads a compass.
 *
 * Bearings are stated as magnetic, and always say so: a bare "047°" read by
 * one operator as true and another as magnetic is seven degrees of error here,
 * which at a few miles is the wrong ridge.
 */

import MagneticModel from "./MagneticModel.js";
import Mgrs from "./Mgrs.js";

const EARTH_MEAN_RADIUS_M = 6371008.8;
const METRES_PER_MILE = 1609.344;
const FEET_PER_METRE = 3.28084;

// Closer than this is the same place: a GPS wanders a few metres standing
// still, and on the bench two radios a few feet apart read "0.0 mi, 341°
// magnetic", a bearing that meant nothing
export const SAME_LOCATION_METRES = 10;

// under a tenth of a mile, feet and metres say more than "0.1 mi"
const SHORT_DISTANCE_METRES = METRES_PER_MILE / 10;
const DEG = Math.PI / 180;

class Geo {

    /** Whether a latitude and longitude are a real position, rather than missing or the 0, 0 of an unset one. */
    static isPosition(latitude, longitude) {
        return latitude != null && longitude != null
            && isFinite(latitude) && isFinite(longitude)
            && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
            && !(latitude === 0 && longitude === 0);
    }

    /** Great circle distance in metres. */
    static distanceMetres(fromLat, fromLon, toLat, toLon) {
        const phi1 = fromLat * DEG;
        const phi2 = toLat * DEG;
        const dPhi = (toLat - fromLat) * DEG;
        const dLambda = (toLon - fromLon) * DEG;
        const a = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
        return 2 * EARTH_MEAN_RADIUS_M * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    /** The true bearing to set off on, in degrees from 0 to 360. */
    static trueBearing(fromLat, fromLon, toLat, toLon) {
        const phi1 = fromLat * DEG;
        const phi2 = toLat * DEG;
        const dLambda = (toLon - fromLon) * DEG;
        const y = Math.sin(dLambda) * Math.cos(phi2);
        const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
        return this.normaliseDegrees(Math.atan2(y, x) / DEG);
    }

    static normaliseDegrees(degrees) {
        return ((degrees % 360) + 360) % 360;
    }

    /**
     * Everything the positions list shows about one station seen from here:
     * distance, and the bearing to it as magnetic with the declination used.
     * The declination is the one where the viewer stands, since that is where
     * the compass is. Returns null when either end has no position.
     */
    static relation(from, to, date = new Date()) {

        if(!from || !to || !this.isPosition(from.latitude, from.longitude) || !this.isPosition(to.latitude, to.longitude)){
            return null;
        }

        const metres = this.distanceMetres(from.latitude, from.longitude, to.latitude, to.longitude);
        const trueBearing = this.trueBearing(from.latitude, from.longitude, to.latitude, to.longitude);
        const declination = MagneticModel.declination(from.latitude, from.longitude, date);

        return {
            metres,
            trueBearing,
            declination,
            // true = magnetic + declination, with east declination positive
            magneticBearing: this.normaliseDegrees(trueBearing - declination),
            sameLocation: metres < SAME_LOCATION_METRES,
            modelCurrent: MagneticModel.isValidOn(date),
        };

    }

    /**
     * "3.2 mi (5.1 km)", with a decimal until ten, whole numbers after. Under a
     * tenth of a mile, feet and metres; under ten metres, "Same location".
     */
    static formatDistance(metres) {
        if(metres < SAME_LOCATION_METRES){
            return "Same location";
        }
        if(metres < SHORT_DISTANCE_METRES){
            return `${Math.round(metres * FEET_PER_METRE)} ft (${Math.round(metres)} m)`;
        }
        const miles = metres / METRES_PER_MILE;
        const km = metres / 1000;
        const format = (value) => value < 10 ? value.toFixed(1) : String(Math.round(value));
        return `${format(miles)} mi (${format(km)} km)`;
    }

    /** "047° magnetic". Three digits, and the word, always. */
    static formatMagneticBearing(degrees) {
        const whole = Math.round(degrees) % 360;
        return `${String(whole).padStart(3, "0")}° magnetic`;
    }

    /** "declination 7.4° E", the figure used to turn true into magnetic. */
    static formatDeclination(degrees) {
        const side = degrees < 0 ? "W" : "E";
        return `declination ${Math.abs(degrees).toFixed(1)}° ${side}`;
    }

    /** "31.7619° N, 106.4850° W". Four places is about eleven metres. */
    static formatDegrees(latitude, longitude) {
        const lat = `${Math.abs(latitude).toFixed(4)}° ${latitude < 0 ? "S" : "N"}`;
        const lon = `${Math.abs(longitude).toFixed(4)}° ${longitude < 0 ? "W" : "E"}`;
        return `${lat}, ${lon}`;
    }

    /** The ten digit MGRS reference, or null where MGRS does not reach. */
    static formatMgrs(latitude, longitude) {
        return Mgrs.fromLatLon(latitude, longitude, 5)?.text ?? null;
    }

}

export default Geo;
