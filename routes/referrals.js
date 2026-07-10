const express = require('express');
const router = express.Router();
const User = require('../models/User');
const ReferralCode = require('../models/ReferralCode');

// Middleware to check if the session belongs to an authorized admin node
const isAdmin = (req, res, next) => {
    if (req.session && (req.session.role === 'admin' || req.session.role === 'superadmin')) {
        return next();
    }
    return res.redirect('/auth/login');
};

// [GET] Render the Admin Referral Management Portal Panel
router.get('/admin/referral-manager', isAdmin, async (req, res) => {
    try {
        // ALWAYS fallback cleanly to adminPromo first, matching how dashboard objects identify
        const activePromoKey = req.session.adminPromo || req.session.adminCode || '';
        
        // Find all referral codes belonging exclusively to this administrator (Case Insensitive Match)
        const activeCodesList = await ReferralCode.find({ 
            assignedAdminCode: { $regex: new RegExp("^" + activePromoKey.trim() + "$", "i") } 
        }).sort({ createdAt: -1 });

        res.render('admin/ReferralManager', { 
            codes: activeCodesList,
            error: null,
            success: null 
        });
    } catch (err) {
        console.error("Error loading administration referral data track:", err);
        res.redirect('/admin/dashboard'); 
    }
});

// [POST] Create a unique 7-8 mixed digit alphanumeric referral code
router.post('/admin/referral-manager/generate', isAdmin, async (req, res) => {
    try {
        const { targetUsername } = req.body;
        
        // Match the identical session key structure used in the GET block
        const activePromoKey = req.session.adminPromo || req.session.adminCode || '';

        if (!targetUsername || !targetUsername.trim()) {
            return res.status(400).json({ success: false, error: "Referrer name variable is required." });
        }

        if (!activePromoKey || !activePromoKey.trim()) {
            return res.status(400).json({ success: false, error: "Administrative identification credentials missing." });
        }

        // Validate that the target username actually exists in your users table
        const userInstance = await User.findOne({ username: targetUsername.trim() });
        if (!userInstance) {
            return res.status(404).json({ success: false, error: `User configuration profile "${targetUsername}" not found inside directory.` });
        }

        // Token generator logic loop
        const generateMixedCode = () => {
            const dictionary = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
            let resultChain = '';
            const generationLength = Math.floor(Math.random() * 2) + 7; // Generates 7-8 chars
            for (let index = 0; index < generationLength; index++) {
                resultChain += dictionary.charAt(Math.floor(Math.random() * dictionary.length));
            }
            return resultChain;
        };

        // Guarantee distinct uniqueness against collision loops
        let codeCandidate = generateMixedCode();
        let isCollisionDetected = await ReferralCode.findOne({ code: codeCandidate });
        while (isCollisionDetected) {
            codeCandidate = generateMixedCode();
            isCollisionDetected = await ReferralCode.findOne({ code: codeCandidate });
        }

        const newReferralRecord = new ReferralCode({
            code: codeCandidate,
            referrerUsername: targetUsername.trim(),
            assignedAdminCode: activePromoKey.trim(), 
            isUsed: false,
            referredUser: ''
        });

        await newReferralRecord.save();

        return res.json({
            success: true,
            message: `Referral code successfully generated for ${targetUsername.trim()}: ${codeCandidate}`
        });

    } catch (err) {
        console.error("Critical error compiling admin referral configuration generation:", err);
        return res.status(500).json({ success: false, error: "Internal transaction infrastructure error." });
    }
});

module.exports = router;