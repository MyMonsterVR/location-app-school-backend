const mongoose = require('mongoose');

const friendsSchema = new mongoose.Schema({
    userId: {
        type: String,
        required: true
    },
    friendId: {
        type: String,
        required: true
    },
    status: {
        type: String,
        required: true
    },
    isOnline: {
        type: Boolean,
        required: true
    },
    lastStatusUpdate: {
        type: Date,
        required: true
    }
}, {
    timestamps: true
});

const friends = mongoose.model('Friends', friendsSchema);

module.exports = friends;