const mongoose = require('mongoose');

const locationSchema = new mongoose.Schema({
    userId: {
        type: String,
        required: true
    },
    latitude: {
        type: Number,
        required: true
    },
    longitude: {
        type: Number,
        required: true
    },
}, {
    timestamps: true
});

const location = mongoose.model('Location', locationSchema);

module.exports = location;