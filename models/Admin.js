const mongoose = require('mongoose');

const AdminSchema = new mongoose.Schema({
    username: { 
        type: String, 
        required: true, 
        unique: true 
    },
    email: { 
        type: String, 
        required: true, 
        unique: true 
    },
    password: { 
        type: String, 
        required: true 
    },
    promoCode: { 
        type: String, 
        required: true, 
        unique: true 
    }, 
    // 🟢 ADD THIS FIELD FIELD SO MONGOOSE RECOGNIZES IT
    whatsappNumber: {
        type: String,
        default: ''
    },
    isRestricted: { 
        type: Boolean, 
        default: false 
    },
    isOnline: { 
        type: Boolean, 
        default: true 
    },
    createdAt: { 
        type: Date,
        default: Date.now 
    }
});

module.exports = mongoose.model('Admin', AdminSchema);