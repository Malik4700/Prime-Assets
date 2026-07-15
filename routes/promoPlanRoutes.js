const express = require('express');
const router = express.Router();
const PromoPlan = require('../models/PromoPlan');

// STRICT SECURITY GUARD: Only allow authentic Superadmins to manage promo assets
const isSuperadmin = (req, res, next) => {
    if (req.session && req.session.user && req.session.user.role === 'superadmin') {
        return next();
    }
    // If not a superadmin, block execution
    return res.status(403).json({ success: false, msg: 'Access Denied: Superadmin authority required.' });
};

// @route   POST /api/promo-plans
// @desc    Create a new time-limited promo plan (Superadmin only)
router.post('/', isSuperadmin, async (req, res) => {
    try {
        const { name, description, price, durationDays, profitPercent, startDate, endDate, maxPurchases } = req.body;

        const newPromo = new PromoPlan({
            name,
            description,
            price: parseFloat(price),
            durationDays: parseInt(durationDays),
            profitPercent: parseFloat(profitPercent || 0),
            startDate: startDate ? new Date(startDate) : null, // Handle empty date safely
            endDate: endDate ? new Date(endDate) : null,       // Handle empty date safely
            maxPurchases: maxPurchases ? parseInt(maxPurchases) : null,
            isActive: true, // Explicitly enforce active status
            purchaseCount: 0
        });

        await newPromo.save();
        res.status(201).json({ success: true, msg: 'Promo plan created successfully!', data: newPromo });
    } catch (error) {
        res.status(500).json({ success: false, msg: 'Failed to create promo plan.', error: error.message });
    }
});

// @route   GET /api/promo-plans/active
// @desc    Get all active, valid promo plans (Available to logged-in users)
router.get('/active', async (req, res) => {
    try {
        const now = new Date();
        const activePromos = await PromoPlan.find({
            isActive: true,
            startDate: { $lte: now },
            endDate: { $gte: now }
        });

        // Filter out any that have hit their purchase limit
        const availablePromos = activePromos.filter(promo => 
            promo.maxPurchases === null || promo.purchaseCount < promo.maxPurchases
        );

        res.status(200).json({ success: true, data: availablePromos });
    } catch (error) {
        res.status(500).json({ success: false, msg: 'Server error retrieving promo plans.' });
    }
});

module.exports = router;