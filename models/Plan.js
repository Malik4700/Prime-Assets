const mongoose = require('mongoose');

const planSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    planName: { type: String, required: true }, // e.g., "Alpha Core"
    principalAmount: { type: Number, required: true }, // e.g., 5000 PHP
    profitPercentage: { type: Number, required: true }, // e.g., 15%
    durationDays: { type: Number, required: true }, // 15, 30, 60, 90, 180, or 365
    
    // Math helpers calculated automatically on creation
    totalExpectedProfit: { type: Number, required: true }, // principal * (percent / 100)
    profitPerMinute: { type: Number, required: true }, // totalExpectedProfit / (durationDays * 24 * 60)
    
    status: { type: String, enum: ['active', 'completed'], default: 'active' },
    activatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('Plan', planSchema);