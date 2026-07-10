const mongoose = require('mongoose');

const depositSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    blockchain: {
        type: String,
        required: true
    },
    txid: {
        type: String,
        required: true,
        unique: true
    },
    status: {
        type: String,
        enum: ['pending', 'approved', 'declined'],
        default: 'pending'
    },
    adminComment: {
        type: String,
        default: ''
    },
    assignedAdminCode: {
        type: String,
        default: ''
    }
}, { timestamps: true });

module.exports = mongoose.model('Deposit', depositSchema);