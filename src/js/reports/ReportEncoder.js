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

    // the shortest gap between parts of a multi part channel report. It was 2 s,
    // and on the bench a three part report reached node 2 with its middle part
    // missing although node 1's radio had accepted it. Channel messages are never
    // acknowledged, so the gap is all that keeps one part off the repeats of the
    // one before. Slow radio settings get longer, see Airtime.channelPartGapMillis
    static PART_SEND_DELAY_MILLIS = 5000;

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
     * Anything over the limit is silently truncated by sendGroupMessage().
     */
    static getChannelTextBudget(nodeName) {
        const prefix = `${nodeName ?? ""}: `;
        return this.MAX_TEXT_LEN - this.byteLength(prefix);
    }

    /**
     * How many bytes of message text we can send directly to a contact.
     *
     * Direct messages carry no sender name prefix, because the recipient knows who
     * sent it from the public key, so the whole budget is available. Note that
     * composeMsgPacket() rejects an over length message outright rather than
     * truncating it, so exceeding this fails the send instead of silently
     * shortening it.
     */
    static getContactTextBudget() {
        return this.MAX_TEXT_LEN;
    }

    /**
     * Budget for whichever destination the operator picked.
     */
    static getTextBudget(destinationType, nodeName) {
        return destinationType === "contact"
            ? this.getContactTextBudget()
            : this.getChannelTextBudget(nodeName);
    }

    // what a blank field is sent as, on a form that keeps them
    static BLANK_VALUE = "-";

    /**
     * Renders a filled in form to the plain text that goes over the air.
     * Empty optional fields are dropped entirely rather than sent as empty tags,
     * since every byte costs airtime, unless the form keeps blank fields: then
     * each is sent as "TAG: -", so a paragraph left empty on purpose is not
     * mistaken for one lost on the way. A tick box sends its tag alone when
     * ticked, and nothing when not.
     */
    static renderReport(form, values) {

        // callers should pass a values object, but a form with nothing filled in yet
        // is a normal state and must not throw
        values = values ?? {};

        const lines = [
            form.header,
        ];

        for(const field of form.fields){

            const value = (values[field.id] ?? "").toString().trim();

            if(field.type === "check"){
                if(value !== ""){
                    lines.push(field.tag);
                }
                continue;
            }

            // skip fields the operator left blank, or on a form that keeps them,
            // say so with a hyphen
            if(value === ""){
                if(form.keepBlankFields){
                    lines.push(`${field.tag}: ${this.BLANK_VALUE}`);
                }
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
        values = values ?? {};
        return form.fields
            .filter((field) => field.required)
            .filter((field) => (values[field.id] ?? "").toString().trim() === "")
            .map((field) => field.id);
    }

    /**
     * Splits text into chunks that each fit within maxBytes.
     *
     * A report is one field per line, so breaking between lines is what keeps each
     * part readable on its own: an operator copying part 2 onto a paper form sees
     * whole fields rather than the tail of one. Lines are therefore packed whole
     * wherever they fit.
     *
     * A single line too long for a part still has to be broken mid line, which in
     * practice means a long free text field. That falls back to chunkLineByBytes(),
     * which breaks on whitespace so at least words stay intact.
     */
    static chunkByBytes(text, maxBytes) {

        const chunks = [];
        var current = "";

        const flush = () => {
            if(current !== ""){
                chunks.push(current);
                current = "";
            }
        };

        for(const line of text.split("\n")){

            // the line fits on the end of the part being built
            const joined = current === "" ? line : `${current}\n${line}`;
            if(this.byteLength(joined) <= maxBytes){
                current = joined;
                continue;
            }

            // it does not fit here, so this part is finished
            flush();

            // a line that fits in a part of its own goes there whole
            if(this.byteLength(line) <= maxBytes){
                current = line;
                continue;
            }

            // too long for any part, so it has to be broken mid line. the last piece
            // stays open so following lines can still pack onto it
            const pieces = this.chunkLineByBytes(line, maxBytes);
            chunks.push(...pieces.slice(0, -1));
            current = pieces[pieces.length - 1];

        }

        flush();

        return chunks.filter((chunk) => chunk !== "");

    }

    /**
     * Splits a single line into chunks that each fit within maxBytes.
     *
     * Splits on whitespace where possible so words stay intact, and always splits
     * on whole code points so a multi byte character is never cut in half.
     */
    static chunkLineByBytes(text, maxBytes) {

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
    /**
     * Splits a report into parts that fit.
     *
     * prefix goes in front of every part, not just the first: a drill's parts can
     * arrive minutes apart and be read on their own, so each one has to say DRILL
     * for itself. Its bytes are budgeted for like the part marker's.
     */
    static splitIntoParts(text, budgetBytes, prefix = "") {

        // nothing to send
        if(text === ""){
            return [];
        }

        // fits in a single packet, send it without a part marker
        if(this.byteLength(prefix + text) <= budgetBytes){
            return [prefix + text];
        }

        for(let partCount = 2; partCount <= 99; partCount++){

            // assume the widest marker this part count can produce, e.g "[10/10] "
            const markerBytes = this.byteLength(`${prefix}[${partCount}/${partCount}] `);
            const chunkBudget = budgetBytes - markerBytes;

            // node name is so long there is no room left for content
            if(chunkBudget <= 0){
                break;
            }

            const chunks = this.chunkByBytes(text, chunkBudget);

            // if it split into no more parts than we assumed, the markers are guaranteed
            // to be no wider than the ones we budgeted for, so every part fits
            if(chunks.length <= partCount){
                return chunks.map((chunk, i) => `${prefix}[${i + 1}/${chunks.length}] ${chunk}`);
            }

        }

        return null;

    }

    /**
     * Renders a form and works out exactly what will be transmitted.
     * Used both for the live preview and for sending, so what the operator sees
     * on screen is byte for byte what goes out over the air.
     */
    static prepare(form, values, nodeName, destinationType = "channel", { markDrill = false } = {}) {

        const text = this.renderReport(form, values);
        const budgetBytes = this.getTextBudget(destinationType, nodeName);
        const parts = this.splitIntoParts(text, budgetBytes, markDrill ? "DRILL " : "");

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
