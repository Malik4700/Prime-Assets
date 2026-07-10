const express = require('express');
const router = express.Router();
const User = require('../models/User'); 
const Superadmin = require('../models/Superadmin');
const bcrypt = require('bcryptjs'); 

// 1. Render the Superadmin Dashboard with data
router.get('/dashboard', async (req, res) => {
    try {
        // Fetch only users who have the role of 'admin'
        const admins = await User.find({ role: 'admin' });
        
        // Fetch the global system configurations via the superadmin profile record
        const superadminConfig = await Superadmin.findOne() || { isMaintenanceActive: false };
        
        // Dynamic aggregations for totals dashboard display
        const totalUsersCount = await User.countDocuments({ role: 'user' });
        
        // Compute cumulative total deposit values dynamically from User collections
        const depositAgg = await User.aggregate([
            { $match: { role: 'user' } },
            { $group: { _id: null, total: { $sum: "$totalDeposits" } } }
        ]);
        const totalDeposits = depositAgg.length > 0 ? depositAgg[0].total : 0.00;

        // Structured dummy matrix mapping metrics for all 6 tiers to pass to view cleanly
        const tierMetrics = {
            tier1: { admins: admins.length, users: totalUsersCount, deposits: totalDeposits, withdrawals: 0, activePlans: 1 },
            tier2: { admins: 0, users: 0, deposits: 0, withdrawals: 0, activePlans: 0 },
            tier3: { admins: 0, users: 0, deposits: 0, withdrawals: 0, activePlans: 0 },
            tier4: { admins: 0, users: 0, deposits: 0, withdrawals: 0, activePlans: 0 },
            tier5: { admins: 0, users: 0, deposits: 0, withdrawals: 0, activePlans: 0 },
            tier6: { admins: 0, users: 0, deposits: 0, withdrawals: 0, activePlans: 0 }
        };

        // Render the view with variables matching your updated dashboard requirements perfectly
        res.render('superadmin/dashboard', { 
            admins,
            totalDeposits,
            totalUsersCount,
            tierMetrics,
            isMaintenanceActive: superadminConfig.isMaintenanceActive
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Core system error fetching ledger.");
    }
});


// 2. Process Form Submission to Provision a New Admin
router.post('/create-admin', async (req, res) => {
    const { username, email, password, promoCode } = req.body;
    
    try {
        const existingUser = await User.findOne({ 
            $or: [
                { email }, 
                { username }, 
                { assignedAdminCode: promoCode.toUpperCase().trim() }
            ] 
        });
        
        if (existingUser) {
            return res.status(400).send("Credentials or Promo Code already allocated in network.");
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const newAdmin = new User({
            username,
            email,
            password: hashedPassword,
            role: 'admin',
            assignedAdminCode: promoCode.toUpperCase().trim(),
            phone: 'N/A',
            country: 'N/A',
            gender: 'N/A'
        });

        await newAdmin.save();
        res.redirect('/superadmin/dashboard');
    } catch (err) {
        console.error(err);
        res.status(500).send("Failed to provision admin workspace.");
    }
});

// 3. Toggle Global Maintenance Configuration Interlock State Switch
router.post('/toggle-maintenance', async (req, res) => {
    try {
        let superadminConfig = await Superadmin.findOne();
        
        if (!superadminConfig) {
            return res.status(404).send("Superadmin root document configuration node was not found.");
        }

        // Atomically switch systemic maintenance operational flags
        superadminConfig.isMaintenanceActive = !superadminConfig.isMaintenanceActive;
        await superadminConfig.save();

        res.redirect('/superadmin/dashboard');
    } catch (err) {
        console.error(err);
        res.status(500).send("Critical error updating global maintenance pipeline parameters.");
    }
});

// 4. Toggle Account Block Status (Activate / Deactivate)
router.post('/toggle-status/:id', async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) {
            return res.status(404).send("Target account node not found.");
        }

        user.isBlocked = !user.isBlocked;
        await user.save();

        res.redirect('/superadmin/dashboard');
    } catch (err) {
        console.error(err);
        res.status(500).send("Error updating operational status state.");
    }
});

// 5. Wipe Account completely (Delete Account)
router.post('/delete-account/:id', async (req, res) => {
    try {
        const deletedUser = await User.findByIdAndDelete(req.params.id);
        if (!deletedUser) {
            return res.status(404).send("Target account node not found.");
        }

        res.redirect('/superadmin/dashboard');
    } catch (err) {
        console.error(err);
        res.status(500).send("Error dropping target account from schema.");
    }
});

module.exports = router;