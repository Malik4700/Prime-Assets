const mongoose = require('mongoose');

const ReferralCodeSchema = new mongoose.Schema({
    code: { 
        type: String, 
        required: true, 
        unique: true, 
        trim: true 
    }, // Stores the unique 7-8 mixed character alphanumeric code
    referrerUsername: { 
        type: String, 
        required: true, 
        trim: true 
    }, // The existing user who wants to refer a friend
    assignedAdminCode: { 
        type: String, 
        required: true 
    }, // Tracks which admin generated it so visibility isolation stays intact
    isUsed: { 
        type: Boolean, 
        default: false 
    }, // Becomes true when a new user signs up with it
    referredUser: { 
        type: String, 
        default: '' 
    } // Stores the username of the newly registered user for the admin to review
}, { timestamps: true });

module.exports = mongoose.model('ReferralCode', ReferralCodeSchema);