const mongoose = require('mongoose');

const chatSchema = new mongoose.Schema({
    user: {
        userId: {
            type: String,
            required: true
        },
        username: {
            type: String,
            required: true
        }
    },
    message: {
        text: {
            type: String,
            required: true
        },
        messageType: {
            type: String,
            required: true,
            default: 'text'
        },
        readBy: [{
            type: String
        }]
    },
    room: {
        roomId: {
            type: String,
            required: true
        },
    }
}, {
    timestamps: true
});

const Chat = mongoose.model('Chat', chatSchema);

module.exports = Chat;