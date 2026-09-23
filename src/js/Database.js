import {v4} from 'uuid';
import {addRxPlugin, createRxDatabase} from 'rxdb/plugins/core';
import {getRxStorageDexie} from 'rxdb/plugins/storage-dexie';
import GlobalState from "./GlobalState.js";
import Utils from "./Utils.js";
import ChannelKeys from "./channels/ChannelKeys.js";

// add rxdb migration plugin
import { RxDBMigrationSchemaPlugin } from 'rxdb/plugins/migration-schema';
addRxPlugin(RxDBMigrationSchemaPlugin);

/**
 * Every collection this app keeps, and the schema of each.
 *
 * Out here rather than inline so a test can open the real schemas against an
 * in-memory storage. A schema that will not take the documents the app writes, or
 * a query the storage will not run, is otherwise only discovered on a radio.
 */
export const COLLECTIONS = {
    messages: {
        schema: {
            version: 2,
            primaryKey: 'id',
            type: 'object',
            properties: {
                id: {
                    type: 'string',
                    maxLength: 36,
                },
                status: {
                    type: 'string',
                },
                to: {
                    type: 'string',
                },
                from: {
                    type: 'string',
                },
                path_len: {
                    type: 'integer',
                },
                txt_type: {
                    type: 'integer',
                },
                sender_timestamp: {
                    type: 'integer',
                },
                text: {
                    type: 'string',
                },
                timestamp: {
                    type: 'integer',
                },
                expected_ack_crc: {
                    type: 'integer',
                },
                send_type: {
                    type: 'integer',
                },
                rtt: {
                    type: 'integer',
                },
                error: {
                    type: 'string',
                },
                // who wrote a room post: the first four bytes of their public
                // key, as hex. a room relays other people's posts, so the
                // contact a post arrives from is the room, not the author
                author_prefix: {
                    type: 'string',
                },
            },
        },
        migrationStrategies: {
            // add rtt integer property in v1
            1: (oldMessage) => {
                oldMessage.rtt = null;
                return oldMessage;
            },
            // add author_prefix in v2, for room posts. older rows kept theirs
            // inside the text, where it rendered as mojibake, and the bytes
            // cannot be recovered from that, so they stay as they are
            2: (oldMessage) => {
                oldMessage.author_prefix = null;
                return oldMessage;
            },
        }
    },
    contact_messages_read_state: {
        schema: {
            version: 0,
            primaryKey: 'id',
            type: 'object',
            properties: {
                id: {
                    type: 'string',
                    maxLength: 36,
                },
                timestamp: {
                    type: 'integer',
                },
            },
        }
    },
    channel_messages: {
        schema: {
            version: 1,
            primaryKey: 'id',
            type: 'object',
            properties: {
                id: {
                    type: 'string',
                    maxLength: 36,
                },
                channel_idx: {
                    type: 'integer',
                },
                // Which channel this was, not merely which slot it arrived in.
                //
                // Stored by slot alone, a channel written into a used slot
                // inherited every message the old one had: converting to
                // Emcomm-Training put the whole of Public's traffic in the
                // #Emcomm-Training conversation, and the one list showed a
                // brand new channel as recently active. In a drill that is the
                // confusion DRILL marking exists to prevent.
                //
                // A channel's identity is its key, so that is what is kept. It
                // also means a channel's history follows it when it comes back
                // in a different slot. Null on rows written before this, where
                // the app cannot know which channel the slot held.
                channel_key: {
                    type: ['string', 'null'],
                },
                from: {
                    type: 'string',
                },
                path_len: {
                    type: 'integer',
                },
                txt_type: {
                    type: 'integer',
                },
                sender_timestamp: {
                    type: 'integer',
                },
                text: {
                    type: 'string',
                },
                timestamp: {
                    type: 'integer',
                },
            },
        },
        migrationStrategies: {
            // v1 adds the channel's key. Old rows get null rather than a
            // guess: nothing in the data says which channel occupied that slot
            // when they arrived, and attributing them to whatever is there now
            // would be wrong for exactly the slots that changed.
            1: (oldMessage) => {
                oldMessage.channel_key = null;
                return oldMessage;
            },
        },
    },
    channel_messages_read_state: {
        schema: {
            version: 0,
            primaryKey: 'id',
            type: 'object',
            properties: {
                id: {
                    type: 'string',
                    maxLength: 36,
                },
                timestamp: {
                    type: 'integer',
                },
            },
        }
    },
};

var database = null;
async function initDatabase(publicKeyHex) {

    // close any exsiting database connection
    if(database){
        await database.close();
    }

    // create a database with a unique name per identity
    database = await createRxDatabase({
        name: `meshcore_companion_db_${publicKeyHex}`,
        storage: getRxStorageDexie(),
        allowSlowCount: true,
    });

    // add database schemas
    await database.addCollections(COLLECTIONS);

    // database is now ready
    GlobalState.isDatabaseReady = true;

}

class Message {

    // insert a message into the database
    static async insert(data) {
        return await database.messages.insert({
            id: v4(),
            status: data.status,
            to: Utils.bytesToHex(data.to),
            from: Utils.bytesToHex(data.from),
            path_len: data.path_len,
            txt_type: data.txt_type,
            sender_timestamp: data.sender_timestamp,
            text: data.text,
            timestamp: Date.now(),
            expected_ack_crc: data.expected_ack_crc,
            send_type: data.send_type,
            rtt: null,
            error: null,
            // who wrote a room post. This list is written out field by field, so a
            // new one has to be added here as well as to the schema: anything not
            // named is dropped without complaint, which is how the author survived
            // being recovered from the frame and then vanished before it was saved.
            author_prefix: data.author_prefix ?? null,
        });
    }

    static async getMessageById(id) {
        return await database.messages.findOne({
            selector: {
                id: {
                    $eq: id,
                },
            },
        }).exec();
    }

    static async deleteMessageById(id) {
        return await database.messages.findOne({
            selector: {
                id: {
                    $eq: id,
                },
            },
        }).incrementalRemove();
    }

    // mark a message as delivered by its ack code
    static async setMessageDeliveredByAckCode(ackCode, roundTrip) {

        // find one latest message by ack code
        // this will prevent updating older messages that might have the same ack code
        const message = database.messages.findOne({
            selector: {
                expected_ack_crc: {
                    $eq: ackCode,
                },
            },
            sort: [
                {
                    timestamp: "desc",
                },
            ],
        });

        // patch the message state
        return await message.incrementalPatch({
            status: "delivered",
            error: null, // clear error, as we may have received an ack after delivery time out
            rtt: roundTrip,
        });

    }

    // mark a message as failed by its ack code
    static async setMessageFailedById(id, reason) {

        // find one latest message by ack code
        // this will prevent updating older messages that might have the same ack code
        const message = await this.getMessageById(id);

        // do nothing if message not found
        if(!message){
            return;
        }

        // only update if still in sending state
        if(message.status !== "sending"){
            return;
        }

        // patch the message state
        await message.patch({
            status: "failed",
            error: reason,
        });

    }

    // get all messages
    static getAllMessages() {
        return database.messages.find();
    }

    // get direct messages for the provided public key
    static getContactMessages(publicKey) {
        return database.messages.find({
            selector: {
                $or: [
                    // messages from us to other contact
                    {
                        from: {
                            $eq: Utils.bytesToHex(GlobalState.selfInfo.publicKey),
                        },
                        to: {
                            $eq: Utils.bytesToHex(publicKey),
                        },
                    },
                    // messages from other contact to us
                    {
                        from: {
                            $eq: Utils.bytesToHex(publicKey),
                        },
                        to: {
                            $eq: Utils.bytesToHex(GlobalState.selfInfo.publicKey),
                        },
                    },
                ]
            },
            sort: [
                {
                    timestamp: "asc",
                },
            ],
        });
    }

    // get unread direct messages count for the provided public key
    static getContactMessagesUnreadCount(publicKey, messagesLastReadTimestamp) {
        return database.messages.count({
            selector: {
                timestamp: {
                    $gt: messagesLastReadTimestamp,
                },
                from: {
                    $eq: Utils.bytesToHex(publicKey),
                },
                to: {
                    $eq: Utils.bytesToHex(GlobalState.selfInfo.publicKey),
                },
            },
        });
    }

    // delete direct messages for the provided public key
    static async deleteContactMessages(publicKey) {
        await this.getContactMessages(publicKey).remove();
    }

}

class ContactMessagesReadState {

    // update the read state of messages for the provided public key
    static async touch(publicKey) {
        return await database.contact_messages_read_state.upsert({
            id: Utils.bytesToHex(publicKey),
            timestamp: Date.now(),
        });
    }

    // get the read state of messages for the provided public key
    static get(publicKey) {
        return database.contact_messages_read_state.findOne({
            selector: {
                id: {
                    $eq: Utils.bytesToHex(publicKey),
                },
            },
        });
    }

}

class ChannelMessage {

    /**
     * Which rows belong to a channel.
     *
     * Keyed by the channel's secret, so its history follows it: the same channel
     * in a different slot keeps its traffic, and a different channel written into
     * the slot does not inherit it.
     *
     * Rows from before the key was recorded have none. Those are matched by slot,
     * which is the best the data allows and is what the app did for all of them
     * until now, so nobody loses history by upgrading. A mode switch stamps the
     * outgoing channel's key onto its own unkeyed rows before overwriting the
     * slot, so the guessing shrinks each time rather than repeating.
     */
    static belongsTo(channelIdx, channelKey) {
        if(channelKey == null){
            return {
                channel_idx: {
                    $eq: channelIdx,
                },
            };
        }
        return {
            $or: [
                {
                    channel_key: {
                        $eq: channelKey,
                    },
                },
                {
                    $and: [
                        {
                            channel_key: {
                                $eq: null,
                            },
                        },
                        {
                            channel_idx: {
                                $eq: channelIdx,
                            },
                        },
                    ],
                },
            ],
        };
    }

    // insert a channel message into the database
    static async insert(data) {
        return await database.channel_messages.insert({
            id: v4(),
            channel_idx: data.channel_idx,
            // which channel this is, asked of the radio's slots now rather than
            // worked out later, when the slot may hold something else
            channel_key: data.channel_key ?? ChannelKeys.forSlot(data.channel_idx) ?? null,
            from: data.from != null ? Utils.bytesToHex(data.from) : null,
            path_len: data.path_len,
            txt_type: data.txt_type,
            sender_timestamp: data.sender_timestamp,
            text: data.text,
            timestamp: Date.now(),
        });
    }

    // get channel messages for the provided channel
    static getChannelMessages(channelIdx, channelKey = null) {
        return database.channel_messages.find({
            selector: this.belongsTo(channelIdx, channelKey),
            sort: [
                {
                    timestamp: "asc",
                },
            ],
        });
    }

    /**
     * The newest message on a channel, or null.
     *
     * A channel has no advert and so no "last heard" of its own. This is the
     * nearest thing: when anything was last said on it, which is what an operator
     * means when sorting a list by what has been busy.
     */
    static getLatestChannelMessage(channelIdx, channelKey = null) {
        return database.channel_messages.findOne({
            selector: this.belongsTo(channelIdx, channelKey),
            sort: [
                {
                    timestamp: "desc",
                },
            ],
        });
    }

    // get unread channel messages count for the provided channel
    static getChannelMessagesUnreadCount(channelIdx, messagesLastReadTimestamp, channelKey = null) {
        return database.channel_messages.count({
            selector: {
                $and: [
                    {
                        timestamp: {
                            $gt: messagesLastReadTimestamp,
                        },
                    },
                    this.belongsTo(channelIdx, channelKey),
                ],
            },
        });
    }

    // delete channel messages for the provided channel
    static async deleteChannelMessages(channelIdx, channelKey = null) {
        await this.getChannelMessages(channelIdx, channelKey).remove();
    }

    /**
     * How many saved messages do not yet say which channel they came from.
     *
     * All of them predate this app keeping the channel's key, so a switch has to
     * attribute them by slot. Worth telling the operator about first: on a station
     * whose conversation is already mixed, attributing by slot makes the mixing
     * permanent, and the way out is to clear that channel's history before
     * switching.
     */
    static async countUnattributed() {
        return await database.channel_messages.count({
            selector: {
                channel_key: {
                    $eq: null,
                },
            },
        }).exec();
    }

    /**
     * Claim a slot's unattributed rows for the channel that is leaving it.
     *
     * Called before a slot is overwritten, which is the last moment the app knows
     * whose traffic that is. Afterwards the rows stay with that channel wherever
     * it turns up next, and the channel taking the slot starts empty.
     */
    static async attributeSlot(channelIdx, channelKey) {
        if(channelKey == null){
            return 0;
        }
        const rows = await database.channel_messages.find({
            selector: {
                $and: [
                    {
                        channel_idx: {
                            $eq: channelIdx,
                        },
                    },
                    {
                        channel_key: {
                            $eq: null,
                        },
                    },
                ],
            },
        }).exec();
        for(const row of rows){
            await row.patch({
                channel_key: channelKey,
            });
        }
        return rows.length;
    }

}

class ChannelMessagesReadState {

    /**
     * When this slot was last looked at.
     *
     * Deliberately by slot, where the messages themselves are by channel. The mark
     * means "the operator had this open at time T", and an unread count is only
     * ever messages newer than that, so a channel arriving in a slot someone has
     * been watching still shows everything it receives from then on.
     *
     * Keying it by channel instead was tried and undone: every channel already on
     * a station would have had no mark under its new name and so have shown its
     * whole history as unread the first time this build ran, which is a badge
     * storm in exchange for nothing an operator would notice.
     */

    // update the read state of messages for the provided channel idx
    static async touch(channelIdx) {
        return await database.channel_messages_read_state.upsert({
            id: channelIdx.toString(),
            timestamp: Date.now(),
        });
    }

    // get the read state of messages for the provided channel idx
    static get(channelIdx) {
        return database.channel_messages_read_state.findOne({
            selector: {
                id: {
                    $eq: channelIdx.toString(),
                },
            },
        });
    }

}

export default {
    initDatabase,
    Message,
    ContactMessagesReadState,
    ChannelMessage,
    ChannelMessagesReadState,
};
