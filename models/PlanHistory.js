const mongoose = require('mongoose');

const planHistorySchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    username: { type: String, required: true },
    email: { type: String, required: true },
    planName: { type: String, required: true },
    planActivatedAt: { type: Date, required: true },
    planExpiresAt: { type: Date, required: true },
    assignedAdminCode: { type: String, required: true },
    completedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('PlanHistory', planHistorySchema);