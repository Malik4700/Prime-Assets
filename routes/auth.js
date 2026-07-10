const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Admin = require('../models/Admin');
const bcrypt = require('bcryptjs'); 
const ReferralCode = require('../models/ReferralCode');

// [1] GET Login Page Layout
router.get('/login', (req, res) => {
    res.render('user/login', { error: null });
});

// [2] GET Signup Page Layout
router.get('/signup', (req, res) => {
    res.render('user/signup', { error: null });
});

// [3] POST Handle User Registration (Signup)
router.post('/signup', async (req, res) => {
    try {
        const { username, email, phone, password, verifyPassword, promoCode, country, gender } = req.body;

        if (password !== verifyPassword) {
            return res.render('user/signup', { error: 'Passwords do not match!' });
        }

        let truePromoCode = '';
        let referralTokenRecord = null;

        // 1. Check if the code is a custom referral token
        if (promoCode && promoCode.trim() !== '') {
            referralTokenRecord = await ReferralCode.findOne({ code: promoCode.trim(), isUsed: false });
        }

        if (referralTokenRecord) {
            // Referral code is valid! Get the admin code that generated it
            truePromoCode = referralTokenRecord.assignedAdminCode.trim().toLowerCase();
        } else {
            // 2. Fallback: Run your exact original admin promo checks
            let assignedAdmin = await Admin.findOne({ promoCode: promoCode.trim() });
            if (!assignedAdmin) {
                assignedAdmin = await User.findOne({ role: 'admin', assignedAdminCode: promoCode.toUpperCase().trim() });
            }

            if (!assignedAdmin) {
                return res.render('user/signup', { error: 'Invalid Promo/Registration Code! Please check with your representative.' });
            }

            truePromoCode = assignedAdmin.promoCode || assignedAdmin.assignedAdminCode || '';
        }

        const userExists = await User.findOne({ $or: [{ email: email.trim() }, { username: username.trim() }] });
        if (userExists) {
            return res.render('user/signup', { error: 'Username or Email already registered.' });
        }

        const newUser = new User({
            username: username.trim(),
            email: email.trim(),
            phone,
            password, 
            country,
            gender,
            role: 'user', 
            assignedAdminCode: truePromoCode.toUpperCase().trim(),
            referredWithCode: referralTokenRecord ? referralTokenRecord.code.trim() : '',
            balance: 0.00,
            activePlanName: '',
            isBlocked: false,
            isFrozen: false,
            level: 1
        });

        await newUser.save();
        if (referralTokenRecord) {
            referralTokenRecord.isUsed = true;
            referralTokenRecord.referredUser = username.trim();
            await referralTokenRecord.save();
        }
        res.redirect('/auth/login');

    } catch (err) {
        console.error(err);
        res.render('user/signup', { error: 'An error occurred during registration. Try again.' });
    }
});

// [4] POST Handle User Login
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email) {
            return res.render('user/login', { error: 'Please enter your username or email address.' });
        }

        const loginInput = email.trim();

        // Step A: Search for the identity inside the unified 'users' collection first
        let accountNode = await User.findOne({
            $or: [
                { email: loginInput },
                { username: loginInput }
            ]
        });

        let databaseOrigin = 'users';

        // Step B: Fallback search the legacy 'admins' collection only if not found in users
        if (!accountNode) {
            accountNode = await Admin.findOne({
                $or: [
                    { email: loginInput },
                    { username: loginInput }
                ]
        });
            databaseOrigin = 'admins';
        }

        // If absolutely no document matches the input criteria
        if (!accountNode) {
            return res.render('user/login', { error: 'Invalid username/email or password.' });
        }

        // Step C: Validate passwords safely based on format type
        let isMatch = false;
        if (accountNode.password.startsWith('$2a$') || accountNode.password.startsWith('$2b$')) {
            isMatch = await bcrypt.compare(password, accountNode.password);
        } else {
            isMatch = (accountNode.password === password);
        }

        if (!isMatch) {
            return res.render('user/login', { error: 'Invalid username/email or password.' });
        }

        // Security restrictions check
        if (databaseOrigin === 'users') {
            if (accountNode.isBlocked) {
                return res.render('user/login', { error: 'Your workspace access has been deactivated by core infrastructure.' });
            }
            if (accountNode.isFrozen) {
                return res.render('user/login', { error: 'Your account access is currently frozen. Please contact your manager.' });
            }
        }

        // Step D: Clean mapping of runtime session values
        req.session.userId = accountNode._id;
        
        const derivedRole = (databaseOrigin === 'admins') ? 'admin' : accountNode.role;
        req.session.role = derivedRole; 

        // Prioritize promoCode for Admins so session.adminCode gets populated accurately!
        const operationalCode = accountNode.promoCode || accountNode.assignedAdminCode || '';
        req.session.adminCode = operationalCode.toUpperCase().trim(); 

        // Step E: Route redirection based on explicit access tokens
        if (derivedRole === 'superadmin') {
            return res.redirect('/superadmin/dashboard');
        } else if (derivedRole === 'admin') {
            return res.redirect('/admin/dashboard'); 
        } else {
            // UPDATED: Now redirects seamlessly to the new modular home view
            return res.redirect('/user/home'); 
        }

    } catch (err) {
        console.error(err);
        res.render('user/login', { error: 'An error occurred during sign-in. Try again.' });
    }
});

// [5] POST Handle Investment Portfolio Contract Purchase
router.post('/purchase-plan', async (req, res) => {
    try {
        if (!req.session.userId || req.session.role !== 'user') {
            return res.status(401).json({ success: false, message: 'Unauthorized terminal request access.' });
        }

        const { planName, duration } = req.body;
        if (!planName || !duration) {
            return res.status(400).json({ success: false, message: 'Invalid payload execution tokens missing.' });
        }

        const targetUser = await User.findById(req.session.userId);
        if (!targetUser) {
            return res.status(404).json({ success: false, message: 'User node mismatch in active cluster.' });
        }

        if (targetUser.isBlocked || targetUser.isFrozen) {
            return res.status(403).json({ success: false, message: 'Infrastructure credentials frozen or suspended.' });
        }

        // Ensure user can't select/override if an active plan already runs
        if (targetUser.activePlanName && targetUser.activePlanName !== 'None' && targetUser.activePlanName !== '') {
            return res.status(400).json({ success: false, message: 'An active framework contract layout is already running.' });
        }

        // Apply changes to database entry structures
        targetUser.activePlanName = planName;
        await targetUser.save();

        // Push realtime event payload via global socket protocols if accessible
        const io = req.app.get('socketio');
        if (io) {
            io.to(targetUser._id.toString()).emit('planActivated', {
                activePlanName: planName,
                message: `Contract framework for ${planName} successfully initialized.`
            });
        }

        return res.status(200).json({ 
            success: true, 
            message: `Contract stream ${planName} successfully initialized in system framework grid structure.`,
            activePlanName: planName
        });

    } catch (err) {
        console.error("Critical error inside portfolio contract allocation route:", err);
        return res.status(500).json({ success: false, message: 'Internal transaction infrastructure error.' });
    }
});

// [6] GET Handle User Logout
router.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error("Error destroying session:", err);
            return res.redirect('/user/home'); // UPDATED: Fallback cleanly to user home view
        }
        res.clearCookie('connect.sid'); 
        res.redirect('/'); 
    });
});


module.exports = router;