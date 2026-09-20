/**
 * The station's own position, as the radio reports it.
 *
 * MeshCore carries position as two signed 32 bit integers in millionths of a
 * degree. On a node with GPS the firmware keeps them updated from the fix; on a
 * node without, they are whatever was set in Settings. Either way they are what
 * the rest of the mesh sees, which is the number worth putting in a report.
 */
class Position {

    // the device stores degrees as millionths, so 32.312345 arrives as 32312345
    static SCALE = 1000000;

    /**
     * Decimal places kept when a position goes into a report.
     *
     * Four is about 11 metres, which is finer than any of these reports needs and
     * good enough for a helicopter landing point. Five would cost two more bytes
     * per report to describe a metre nobody can stand on accurately anyway.
     */
    static DECIMAL_PLACES = 4;

    /**
     * Turns the device's raw integers into degrees, or null when there is no
     * usable position.
     *
     * An unset position reads as exactly zero, which is a real place in the Gulf
     * of Guinea. Putting that in an emergency report would be worse than leaving
     * the field empty, so it is rejected rather than formatted.
     */
    static fromDevice(advLat, advLon) {

        if(!Number.isFinite(advLat) || !Number.isFinite(advLon)){
            return null;
        }

        const latitude = advLat / this.SCALE;
        const longitude = advLon / this.SCALE;

        // never set, or cleared
        if(advLat === 0 && advLon === 0){
            return null;
        }

        // out of range means the field holds something that is not a position
        if(latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180){
            return null;
        }

        return {
            latitude: latitude,
            longitude: longitude,
        };

    }

    /**
     * How a position is written into a report field.
     *
     * Decimal degrees rather than a grid square: a six character grid is around
     * eight kilometres by five at these latitudes, which is fine for a net check
     * in and useless for a pickup point or a damage location. Degrees also read
     * correctly to someone at an emergency operations centre who does not know
     * what Maidenhead is.
     */
    static format(latitude, longitude) {
        return `${latitude.toFixed(this.DECIMAL_PLACES)}, ${longitude.toFixed(this.DECIMAL_PLACES)}`;
    }

    /**
     * Convenience: device integers straight to the text that goes in the field,
     * or null when there is nothing worth writing.
     */
    static formatFromDevice(advLat, advLon) {
        const position = this.fromDevice(advLat, advLon);
        return position === null ? null : this.format(position.latitude, position.longitude);
    }

}

export default Position;
