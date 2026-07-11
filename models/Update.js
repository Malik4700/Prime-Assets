const mongoose = require('mongoose');

const updateSchema = new mongoose.Schema({
    text: {
        type: String,
        default: ""
    },
    imageUrl: {
        type: String,
        default: null // This will store the path to the uploaded image file on your server
    },
    createdAt: {
        type: Date,
        default: Date.now // Used internally to identify the newest update
    }
});

module.exports = mongoose.model('Update', updateSchema);