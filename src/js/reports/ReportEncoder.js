/**
 * Renders report forms to plain text and splits them across MeshCore packets.
 *
 * The companion firmware caps a channel message at MAX_TEXT_LEN (160) bytes, and
 * that budget includes a "<sender name>: " prefix that the firmware itself prepends
 * in BaseChatMesh::sendGroupMessage(). Anything over the cap is silently truncated
 * by the firmware, so the budget has to be enforced here before sending.
 */
class ReportEncoder {

    // MAX_TEXT_LEN in src/helpers/BaseChatMesh.h, which is (10 * CIPHER_BLOCK_SIZE)
    static MAX_TEXT_LEN = 160;

    // delay between parts of a multi part report, to avoid hammering the channel
    static PART_SEND_DELAY_MILLIS = 2000;

    /**
     * Length of a string in bytes, which is what the firmware actually counts.
     * A JavaScript string length would undercount anything outside ASCII.
     */
    static byteLength(text) {
        return new TextEncoder().encode(text).length;
    }

    /**
     * How many bytes of message text we can send on a channel.
     * The firmware prepends "<sender name>: " and that eats into the same budget.
     */
    static getChannelTextBudget(nodeName) {
        const prefix = `${nodeName ?? ""}: `;
        return this.MAX_TEXT_LEN - this.byteLength(prefix);
    }

    /**
     * Renders a filled in form to the plain text that goes over the air.
     * Empty optional fields are dropped entirely rather than sent as empty tags,
     * since every byte costs airtime.
     */
    static renderReport(form, values) {

        const lines = [
            form.header,
        ];

        for(const field of form.fields){

            const value = (values[field.id] ?? "").toString().trim();

            // skip fields the operator left blank
            if(value === ""){
                continue;
            }

            // collapse newlines, a multi line value would waste bytes and confuse the tag layout
            const singleLineValue = value.replace(/\s*\n\s*/g, " ");

            lines.push(`${field.tag}: ${singleLineValue}`);

        }

        return lines.join("\n");

    }

    /**
     * Returns the ids of required fields the operator has not filled in.
     */
    static getMissingRequiredFields(form, values) {
        return form.fields
            .filter((field) => field.required)
            .filter((field) => (values[field.id] ?? "").toString().trim() === "")
            .map((field) => field.id);
    }

    /**
     * Splits text into chunks that each fit within maxBytes.
     *
     * Splits on whitespace where possible so words stay intact, and always splits
     * on whole code points so a multi byte character is never cut in half.
     */
    static chunkByBytes(text, maxBytes) {

        // work in code points, not UTF-16 units, so surrogate pairs stay together
        const characters = Array.from(text);
        const chunks = [];

        var index = 0;
        while(index < characters.length){

            // walk forward while the chunk still fits in the byte budget,
            // remembering the last whitespace we passed as a break opportunity
            var bytes = 0;
            var end = index;
            var lastBreak = -1;
            while(end < characters.length){

                const characterBytes = this.byteLength(characters[end]);
                if(bytes + characterBytes > maxBytes){
                    break;
                }

                bytes += characterBytes;

                if(/\s/.test(characters[end])){
                    lastBreak = end;
                }

                end++;

            }

            // a single character that exceeds the whole budget would otherwise loop forever,
            // so take it anyway to guarantee we always make progress
            if(end === index){
                chunks.push(characters[index]);
                index = index + 1;
                continue;
            }

            // the rest of the text fits, we are done
            if(end >= characters.length){
                chunks.push(characters.slice(index, end).join(""));
                break;
            }

            // prefer breaking at whitespace, but not if that wastes more than half the chunk
            var cut = end;
            if(lastBreak > index && lastBreak > index + Math.floor((end - index) / 2)){
                cut = lastBreak;
            }

            chunks.push(characters.slice(index, cut).join("").trimEnd());

            // skip the whitespace we broke on, it would otherwise lead the next chunk
            index = cut;
            while(index < characters.length && /\s/.test(characters[index])){
                index++;
            }

        }

        return chunks.filter((chunk) => chunk !== "");

    }

    /**
     * Splits report text into the actual messages to transmit.
     *
     * A report that fits in one packet is sent as is, with no part marker. Anything
     * longer is prefixed with "[n/m] " so the receiving operator can reassemble it.
     *
     * The marker width depends on the number of parts, which depends on the marker
     * width, so this tries increasing part counts until one is self consistent.
     */
    static splitIntoParts(text, budgetBytes) {

        // nothing to send
        if(text === ""){
            return [];
        }

        // fits in a single packet, send it without a part marker
        if(this.byteLength(text) <= budgetBytes){
            return [text];
        }

        for(let partCount = 2; partCount <= 99; partCount++){

            // assume the widest marker this part count can produce, e.g "[10/10] "
            const markerBytes = this.byteLength(`[${partCount}/${partCount}] `);
            const chunkBudget = budgetBytes - markerBytes;

            // node name is so long there is no room left for content
            if(chunkBudget <= 0){
                break;
            }

            const chunks = this.chunkByBytes(text, chunkBudget);

            // if it split into no more parts than we assumed, the markers are guaranteed
            // to be no wider than the ones we budgeted for, so every part fits
            if(chunks.length <= partCount){
                return chunks.map((chunk, i) => `[${i + 1}/${chunks.length}] ${chunk}`);
            }

        }

        return null;

    }

    /**
     * Renders a form and works out exactly what will be transmitted.
     * Used both for the live preview and for sending, so what the operator sees
     * on screen is byte for byte what goes out over the air.
     */
    static prepare(form, values, nodeName) {

        const text = this.renderReport(form, values);
        const budgetBytes = this.getChannelTextBudget(nodeName);
        const parts = this.splitIntoParts(text, budgetBytes);

        return {
            text: text,
            textBytes: this.byteLength(text),
            budgetBytes: budgetBytes,
            parts: parts,
            missingRequiredFields: this.getMissingRequiredFields(form, values),
        };

    }

}

export default ReportEncoder;
