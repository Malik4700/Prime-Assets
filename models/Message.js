const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // Direct link to user channel
    sender: { type: String, enum: ['user', 'admin'], required: true },
    senderName: { type: String, required: true }, // e.g., "testuser" or "Agent Desk"
    messageBody: { type: String, required: true }, // Holds text context or HTML/Img reference
    isImage: { type: Boolean, default: false },
    
    // Support Terminal State Flags
    isPinned: { type: Boolean, default: false },
    isArchived: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('Message', messageSchema);