/**
 * Keeps reading a serial radio through a line error.
 *
 * Found on the bench. Node 1 talks through a CP210x USB bridge, which keeps the
 * port open while the radio behind it reboots. The rebooting chip puts a
 * garbled byte on the line, Web Serial reports a FramingError, and the read loop
 * in meshcore.js logs it and returns. It does not emit "disconnected", so the
 * app went on showing the radio as connected while hearing nothing: every read
 * after that waited out its timeout, and a fresh reboot of the radio did not
 * bring it back. Only disconnecting and connecting again did.
 *
 * Web Serial treats line errors as recoverable. The stream that raised one is
 * finished, and `port.readable` hands out a new one to carry on with. So these
 * errors resume on the new stream, and anything else still ends the loop as
 * before. A pulled cable is a NetworkError; the port's own "disconnect" event
 * is what tells the app about it, and that path is untouched.
 */

import { WebSerialConnection } from "@liamcottle/meshcore.js";

// the errors Web Serial documents as leaving the port usable
export const RECOVERABLE_SERIAL_ERRORS = new Set([
    "BreakError",
    "BufferOverrunError",
    "FramingError",
    "ParityError",
]);

export async function resilientReadLoop() {

    while(true){

        try {

            while(true){
                const { value, done } = await this.reader.read();
                if(done){
                    return;
                }
                await this.onDataReceived(value);
            }

        } catch(error) {

            // the reader was released because the connection is closing
            if(error instanceof TypeError){
                return;
            }

            if(!RECOVERABLE_SERIAL_ERRORS.has(error?.name)){
                console.error("Error reading from serial port: ", error);
                try {
                    this.reader.releaseLock();
                } catch(e) {
                    // already released
                }
                return;
            }

            console.warn("Serial line error, reading on:", error);

            try {
                this.reader.releaseLock();
            } catch(e) {
                // already released
            }

            // whatever half frame was buffered when the line glitched is noise now,
            // and a garbled length in it would hold every later frame back
            this.readBuffer = [];

            const readable = this.serialPort?.readable;
            if(readable == null){
                return;
            }
            this.reader = readable.getReader();

            // a line error on this link is nearly always the radio rebooting behind
            // a bridge that kept the port open, and a reboot costs the radio its
            // clock. Tell the app, which is the part that can put it right
            this.emit?.("recovered", error);

        }

    }

}

/**
 * Installed on the class, not on an instance, because the constructor starts
 * the read loop before anything outside could reach the connection it builds.
 */
export function installResilientSerialReads() {
    WebSerialConnection.prototype.readLoop = resilientReadLoop;
}
