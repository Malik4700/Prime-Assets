const express = require('express');
const router = express.Router();
const User = require('../models/User'); 
const Superadmin = require('../models/Superadmin');
const bcrypt = require('bcryptjs'); 
const Update = require('../models/Update');
const multer = require('multer');
const path = require('path');



// 1. Render the Superadmin Dashboard with data
router.get('/dashboard', async (req, res) => {
    try {
        const admins = await User.find({ role: 'admin' });
        const superadminConfig = await Superadmin.findOne() || { isMaintenanceActive: false };
        const totalUsersCount = await User.countDocuments({ role: 'user' });
        
        const depositAgg = await User.aggregate([
            { $match: { role: 'user' } },
            { $group: { _id: null, total: { $sum: "$totalDeposits" } } }
        ]);
        const totalDeposits = depositAgg.length > 0 ? depositAgg[0].total : 0.00;

        // FETCH ALL UPDATES TO SHOW ON SUPERADMIN VIEW
        const updates = await Update.find().sort({ createdAt: -1 });

        const tierMetrics = {
            tier1: { admins: admins.length, users: totalUsersCount, deposits: totalDeposits, withdrawals: 0, activePlans: 1 },
            tier2: { admins: 0, users: 0, deposits: 0, withdrawals: 0, activePlans: 0 },
            tier3: { admins: 0, users: 0, deposits: 0, withdrawals: 0, activePlans: 0 },
            tier4: { admins: 0, users: 0, deposits: 0, withdrawals: 0, activePlans: 0 },
            tier5: { admins: 0, users: 0, deposits: 0, withdrawals: 0, activePlans: 0 },
            tier6: { admins: 0, users: 0, deposits: 0, withdrawals: 0, activePlans: 0 }
        };

        // Added updates array right here
        res.render('superadmin/dashboard', { 
            admins,
            totalDeposits,
            totalUsersCount,
            tierMetrics,
            updates, 
            isMaintenanceActive: superadminConfig.isMaintenanceActive
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Core system error fetching ledger.");
    }
});


// 2. UPDATE THIS: Process the image buffer as a Base64 string
router.post('/create-update', upload.single('image'), async (req, res) => {
    try {
        let { text } = req.body;
        if (!text) {
            text = ""; 
        }
        
        let imageUrl = null;
        // If an image was uploaded, convert its raw memory buffer into a Base64 data URI string
        if (req.file) {
            const base64Image = req.file.buffer.toString('base64');
            imageUrl = `data:${req.file.mimetype};base64,${base64Image}`;
        }

        const newUpdate = new Update({
            text: text,
            imageUrl: imageUrl
        });

        await newUpdate.save();
        res.redirect('/superadmin/dashboard?success=true');
    } catch (err) {
        console.error("Error creating update:", err);
        res.status(500).send("Core system failed to broadcast update.");
    }
});

// POST route to handle deleting an update post record
router.post('/delete-update/:id', async (req, res) => {
    try {
        await Update.findByIdAndDelete(req.params.id);
        res.redirect('/superadmin/dashboard?deleted=true');
    } catch (err) {
        console.error("Error deleting update:", err);
        res.status(500).send("Core system failed to drop update row.");
    }
});

// POST route to handle editing update text inline
router.post('/edit-update/:id', async (req, res) => {
    try {
        const { text } = req.body;
        await Update.findByIdAndUpdate(req.params.id, { text: text });
        res.redirect('/superadmin/dashboard?updated=true');
    } catch (err) {
        console.error("Error editing update:", err);
        res.status(500).send("Core system failed to update content node.");
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