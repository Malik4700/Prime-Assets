const mongoose = require('mongoose');

const PromoPlanSchema = new mongoose.Schema({
    name: { type: String, required: true },
    description: { type: String, required: true },
    price: { type: Number, required: true },
    durationDays: { type: Number, required: true },
    profitPercent: { type: Number, required: true }, 
    maxPurchases: { type: Number, default: null },
    purchaseCount: { type: Number, default: 0 },       // Added
    startDate: { type: Date, default: null },           // Added
    endDate: { type: Date, default: null },             // Added
    isActive: { type: Boolean, default: true },         // Added
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('PromoPlan', PromoPlanSchema);