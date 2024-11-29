const mongoose = require('mongoose');

// roomId should be GUID
const roomSchema = new mongoose.Schema({
    name: {
        type: String,
        required: false
    },
    type: {
        type: String,
        required: true,
        default: 'single'
    },
    participants: [{
        type: String,
        required: true
    }]
}, {
    timestamps: true
});

const Rooms = mongoose.model('rooms', roomSchema);

module.exports = Rooms;