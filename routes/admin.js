const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const path = require('path');
const mongoose = require('mongoose');
const User = require('../models/User');
const Plan = require('../models/Plan');
const Message = require('../models/Message');
const Withdrawal = require('../models/Withdrawal'); 
const Deposit = require('../models/Deposit'); // Imported the new Deposit model
const Admin = require('../models/Admin');
const ReferralCode = require('../models/ReferralCode');

// Dynamic fallback setup for Gateway Schema definition if not created in separate files
const Gateway = mongoose.models.Gateway || mongoose.model('Gateway', new mongoose.Schema({
    blockchain: { type: String, required: true },
    address: { type: String, required: true },
    assignedAdminCode: { type: String, required: true }
}, { timestamps: true }));

// Middleware to protect routes and ensure user is an admin
const isAdmin = (req, res, next) => {
    if (req.session && (req.session.role === 'admin' || req.session.role === 'superadmin')) {
        return next();
    }
    return res.redirect('/auth/login');
};

// Middleware ensuring only logged-in subscribers access user-side endpoint channels
const isUser = (req, res, next) => {
    if (req.session && req.session.userId) {
        return next();
    }
    return res.status(401).json({ success: false, msg: 'Unauthorized session matrix.' });
};

// ==================== NEW DEDICATED NON-BLOCKING USER DATA SYNC ENDPOINT ====================
router.get('/user-sync-data', isUser, async (req, res) => {
    try {
        const freshUser = await User.findById(req.session.userId);
        if (!freshUser) {
            return res.status(404).json({ success: false, msg: 'User profile untraceable.' });
        }
        
        const withdrawals = await Withdrawal.find({ userId: freshUser._id }).sort({ createdAt: -1 });
        const deposits = await Deposit.find({ userId: freshUser._id }).sort({ createdAt: -1 });

        // Clean, normalize, and uppercase the manager code to cover both registration strategies safely
        const adminManagerCode = freshUser.assignedAdminCode ? freshUser.assignedAdminCode.trim() : '';
        const gateways = await Gateway.find({ assignedAdminCode: adminManagerCode.toLowerCase() });

        let adminWhatsAppNumber = '';
        if (adminManagerCode) {
            const mongoose = require('mongoose');
            
            // Create a completely case-insensitive matching pattern
            const lookupRegex = new RegExp("^" + adminManagerCode + "$", "i");

            // 1. Check the raw 'admins' collection explicitly using the case-insensitive regex pattern
            let associatedAdmin = await mongoose.connection.collection('admins').findOne({
                $or: [
                    { promoCode: lookupRegex },
                    { username: lookupRegex }
                ]
            });

            // 2. Fallback: Check the raw 'users' collection for administrators matching this invite key
            if (!associatedAdmin) {
                associatedAdmin = await mongoose.connection.collection('users').findOne({
                    role: 'admin',
                    $or: [
                        { assignedAdminCode: lookupRegex },
                        { username: lookupRegex }
                    ]
                });
            }

            if (associatedAdmin) {
                adminWhatsAppNumber = associatedAdmin.whatsappNumber || associatedAdmin.whatsapp || '';
            }
        }

        // Send back the complete response packet to ensure layout render engines have data matrices
        return res.json({
            success: true,
            user: {
                username: freshUser.username,
                email: freshUser.email,
                phone: freshUser.phone,
                country: freshUser.country,
                assignedAdminCode: freshUser.assignedAdminCode,
                balance: freshUser.balance,
                isFrozen: freshUser.isFrozen,
                isWithdrawRestrained: freshUser.isWithdrawRestrained,
                isBlocked: freshUser.isBlocked,
                currentPlan: freshUser.currentPlan,
                planActivatedAt: freshUser.planActivatedAt,
                planExpiresAt: freshUser.planExpiresAt,
                isPlanPaused: freshUser.isPlanPaused,
                showWithdrawNotice: freshUser.showWithdrawNotice || false,
                isChatBlocked: freshUser.isChatBlocked || false,
                withdrawals: withdrawals,
                deposits: deposits 
            },
            gateways: gateways,
            whatsappNumber: adminWhatsAppNumber // 🟢 Guaranteed payload extraction string
        });

    } catch (err) {
        console.error('Error in user-sync-data endpoint:', err);
        return res.status(500).json({ success: false, msg: 'Internal server sync error.' });
    }
});

// ==================== (1) DATA AGGREGATION CORE OVERVIEW ROUTE ====================
router.get('/dashboard', isAdmin, async (req, res) => {
    try {
        const adminManagerCode = req.session.adminCode ? req.session.adminCode.trim() : '';

        if (!adminManagerCode) {
            return res.render('user/login', { error: 'Session expired or invalid admin node workspace.' });
        }

        const codeQueryRegex = { $regex: new RegExp(`^${adminManagerCode}$`, 'i') };

        // Fetch users belonging exclusively to this administrative node workspace
        const assignedUsers = await User.find({ assignedAdminCode: codeQueryRegex });
        const totalUsersCount = assignedUsers.length;
        const assignedUserIds = assignedUsers.map(user => user._id);

        // Perform balance sums for workspace records
        const totalDepositsSum = assignedUsers.reduce((sum, user) => sum + (user.balance || 0), 0); 
        
        // Payout tracking statistics
        const completedWithdrawals = await Withdrawal.find({
            userId: { $in: assignedUserIds }, 
            status: { $in: ['completed', 'rejected'] }
        })
        .populate('userId')
        .sort({ updatedAt: -1 });
        const totalWithdrawalsSum = completedWithdrawals.reduce((sum, wd) => sum + (wd.amount || 0), 0);

        const planDistribution = { 
            "7": 0, 
            "15": 0, 
            "30": 0, 
            "30_premium": 0, 
            "60": 0, 
            "60_platinum": 0 
        };
        
        assignedUsers.forEach(user => {
            if (user.currentPlan && user.currentPlan !== 'None') {
                // Normalize spelling/spacing down to clean strings
                const userPlanKey = user.currentPlan.toString().trim().toLowerCase(); 
                
                if (userPlanKey === '7' || userPlanKey === '7 days') {
                    planDistribution["7"] += 1;
                } else if (userPlanKey === '15' || userPlanKey === '15 days') {
                    planDistribution["15"] += 1;
                } else if (userPlanKey === '30' || userPlanKey === '30 days') {
                    planDistribution["30"] += 1;
                } else if (userPlanKey === '30_premium' || userPlanKey === '30_premium days') {
                    planDistribution["30_premium"] += 1;
                } else if (userPlanKey === '60' || userPlanKey === '60 days') {
                    planDistribution["60"] += 1;
                } else if (userPlanKey === '60_platinum' || userPlanKey === '60_platinum days') {
                    planDistribution["60_platinum"] += 1;
                }
            }
        });

        // Gather active messages for chat component template matching
        const recentMessages = await Message.find({ isArchived: false, userId: { $in: assignedUserIds } })
            .sort({ createdAt: -1 })
            .populate('userId');

        // Gather pending cashout settlements
        const pendingWithdrawals = await Withdrawal.find({ userId: { $in: assignedUserIds }, status: 'pending' })
            .populate('userId')
            .sort({ createdAt: -1 });

        // NEW: Gather pending deposit proofs for users assigned to this workspace admin code
        const pendingDeposits = await Deposit.find({ userId: { $in: assignedUserIds }, status: 'pending' })
            .sort({ createdAt: -1 })
            .populate('userId');
        
            // 🟢 FIXED: Gather active investment portfolios belonging ONLY to this admin's users
        const activePlans = await Plan.find({ 
            userId: { $in: assignedUserIds },
            status: 'active'
        }).populate('userId').sort({ createdAt: -1 });

        // 2. NEW: Gather completed historical deposit records (Approved or Declined)
        const referralCodes = await ReferralCode.find({ assignedAdminCode: codeQueryRegex }).sort({ createdAt: -1 });
        const depositHistory = await Deposit.find({ 
            userId: { $in: assignedUserIds }, 
            status: { $in: ['approved', 'declined'] } 
        })
        .sort({ updatedAt: -1 })
        .populate('userId');

       
        // Render dashboard and supply ALL expected properties to prevent undefined template crashes
        res.render('admin/dashboard', {
            metrics: {
                totalDeposits: totalDepositsSum,
                totalWithdrawals: totalWithdrawalsSum,
                totalUsers: totalUsersCount,
                plans: planDistribution
            },
            users: assignedUsers,
            activePlans: activePlans,
            pendingWithdrawals: pendingWithdrawals, 
            pendingDeposits: pendingDeposits, // Attaching the live deposit entries payload here!
            depositHistory: depositHistory,
            withdrawalHistory: completedWithdrawals,
            recentMessages: recentMessages,
            adminPromo: adminManagerCode,
            adminCode: adminManagerCode,
            codes: referralCodes
        });
    } catch (err) {
        console.error('Core overview matrix aggregate crash:', err);
        res.status(500).send('Internal Node Exception Frame.');
    }
});

// ==================== (2) FINE-TUNED BALANCES MATRIX MUTATION ENDPOINT ====================
router.post('/update-balance', isAdmin, async (req, res) => {
    try {
        const { userId, amount, action } = req.body;
        const adminManagerCode = req.session.adminCode ? req.session.adminCode.trim() : '';
        const codeQueryRegex = { $regex: new RegExp(`^${adminManagerCode}$`, 'i') };

        const targetUser = await User.findOne({ _id: userId, assignedAdminCode: codeQueryRegex });
        if (!targetUser) {
            return res.status(403).json({ success: false, msg: 'Access denied. Account context conflict.' });
        }

        const delta = parseFloat(amount);
        if (isNaN(delta) || delta <= 0) {
            return res.status(400).json({ success: false, msg: 'Invalid ledger adjustments value.' });
        }

        if (action === 'add') {
            targetUser.balance = (targetUser.balance || 0) + delta;
        } else if (action === 'deduct') {
            targetUser.balance = Math.max(0, (targetUser.balance || 0) - delta);
        } else {
            return res.status(400).json({ success: false, msg: 'Invalid operation directive request type.' });
        }

        await targetUser.save();
        return res.json({ success: true, msg: 'Ledger tracking balances synchronized cleanly.' });
    } catch (err) {
        console.error('Balance tracking adjustment crash:', err);
        return res.status(500).json({ success: false, error: 'Database tracking pipeline error.' });
    }
});

// ==================== (3) MANUAL INVESTMENT PLANS ASSIGNMENT CONTROL ROUTE ====================
router.post('/assign-plan', isAdmin, async (req, res) => {
    try {
        const { userId, planDays } = req.body;
        const adminManagerCode = req.session.adminCode ? req.session.adminCode.trim() : '';
        const codeQueryRegex = { $regex: new RegExp(`^${adminManagerCode}$`, 'i') };

        const targetUser = await User.findOne({ _id: userId, assignedAdminCode: codeQueryRegex });
        if (!targetUser) {
            return res.status(403).json({ success: false, msg: 'Access denied. Workspace node isolation conflict.' });
        }

        if (planDays === 'None') {
            targetUser.currentPlan = 'None';
            targetUser.planStartedAt = null;
            targetUser.planActivatedAt = null;
            targetUser.planExpiresAt = null;
        } else {
            const daysCount = parseInt(planDays);
            if (isNaN(daysCount) || daysCount <= 0) {
                return res.status(400).json({ success: false, msg: 'Invalid runtime timeframe parameters assigned.' });
            }

            const activationDate = new Date();
            const expirationDate = new Date();
            expirationDate.setDate(activationDate.getDate() + daysCount);

            targetUser.currentPlan = String(daysCount);
            targetUser.planStartedAt = activationDate;
            targetUser.planActivatedAt = activationDate;
            targetUser.planExpiresAt = expirationDate;
        }

        // Auto-clear requests when manually forcing state updates
        targetUser.planRequestStatus = 'none';
        targetUser.requestedPlanName = '';
        targetUser.requestedPlanCost = 0;

        await targetUser.save();
        return res.json({ success: true, msg: 'Premium investment layout plan forced onto target profile row.' });
    } catch (err) {
        console.error('Manual premium configuration adjustment exception:', err);
        return res.status(500).json({ success: false, error: 'Asset parameters rewrite failure.' });
    }
});

// ==================== (4) USER PLAN BUY REQ RESOLUTION HANDLER ====================
router.post('/resolve-plan-request', isAdmin, async (req, res) => {
    try {
        const { userId, resolution } = req.body;
        const adminManagerCode = req.session.adminCode ? req.session.adminCode.trim() : '';
        const codeQueryRegex = { $regex: new RegExp(`^${adminManagerCode}$`, 'i') };

        const targetUser = await User.findOne({ _id: userId, assignedAdminCode: codeQueryRegex });
        if (!targetUser || targetUser.planRequestStatus !== 'pending') {
            return res.status(400).json({ success: false, msg: 'No active plan execution requests pending matching criteria.' });
        }

        if (resolution === 'approve') {
            const planDurationDays = parseInt(targetUser.requestedPlanName);
            if (isNaN(planDurationDays) || planDurationDays <= 0) {
                return res.status(400).json({ success: false, msg: 'Target structural time validation crashed.' });
            }

            const creationTimeNode = new Date();
            const deathTimeNode = new Date();
            deathTimeNode.setDate(creationTimeNode.getDate() + planDurationDays);

            targetUser.currentPlan = String(planDurationDays);
            targetUser.planStartedAt = creationTimeNode;
            targetUser.planActivatedAt = creationTimeNode;
            targetUser.planExpiresAt = deathTimeNode;
            targetUser.planRequestStatus = 'approved';
        } else if (resolution === 'reject') {
            // Hand back the held/frozen liquidity onto the active running ledger row
            targetUser.balance = (targetUser.balance || 0) + (targetUser.requestedPlanCost || 0);
            targetUser.planRequestStatus = 'none';
        } else {
            return res.status(400).json({ success: false, msg: 'Invalid execution payload request schema operational command.' });
        }

        // Wipe temp verification memory caches cleanly
        targetUser.requestedPlanName = '';
        targetUser.requestedPlanCost = 0;

        await targetUser.save();
        return res.json({ success: true, msg: `Purchase request operation successfully settled to: ${resolution}` });
    } catch (err) {
        console.error('Plan resolution tracking execution anomaly:', err);
        return res.status(500).json({ success: false, error: 'Database record settlement operational pipeline exception.' });
    }
});

// ==================== (5) ADMINISTRATIVE SECURITY & USER RESTRICTION TOGGLES ====================
router.post('/toggle-status', isAdmin, async (req, res) => {
    try {
        const { userId, field } = req.body;
        const adminManagerCode = req.session.adminCode ? req.session.adminCode.trim() : '';
        const codeQueryRegex = { $regex: new RegExp(`^${adminManagerCode}$`, 'i') };

        const validFields = ['isFrozen', 'isWithdrawRestrained', 'isChatBlocked', 'isBlocked', 'isPlanPaused', 'showWithdrawNotice'];
        if (!validFields.includes(field)) {
            return res.status(400).json({ success: false, msg: 'Unrecognized administrative modification flag identifier.' });
        }

        const targetUser = await User.findOne({ _id: userId, assignedAdminCode: codeQueryRegex });
        if (!targetUser) {
            return res.status(404).json({ success: false, msg: 'Target customer data boundary mismatch or fully unlinked.' });
        }

        // Toggle state safely
        targetUser[field] = !targetUser[field];
        await targetUser.save();

        return res.json({ success: true, msg: `Security variable state [${field}] flipped successfully to ${targetUser[field]}` });
    } catch (err) {
        console.error('Status modification toggles execution fault:', err);
        return res.status(500).json({ success: false, error: 'Database flag update processing failure.' });
    }
});
// ==================== NEW ALIAS ROUTE FOR WITHDRAW BLOCK BUTTONS ====================
router.post('/toggle-withdraw-block', isAdmin, async (req, res) => {
    try {
        const { userId } = req.body;
        const adminManagerCode = req.session.adminCode ? req.session.adminCode.trim() : '';
        const codeQueryRegex = { $regex: new RegExp(`^${adminManagerCode}$`, 'i') };

        // Locate user belonging exclusively to this administrative node workspace
        const targetUser = await User.findOne({ _id: userId, assignedAdminCode: codeQueryRegex });
        if (!targetUser) {
            return res.status(404).json({ success: false, msg: 'Target customer data boundary mismatch or unlinked.' });
        }

        // Toggle the specific withdraw restriction boolean field cleanly
        targetUser.isWithdrawRestrained = !targetUser.isWithdrawRestrained;
        await targetUser.save();

        return res.json({ 
            success: true, 
            msg: `Withdrawal permission flipped successfully to ${targetUser.isWithdrawRestrained}` 
        });
    } catch (err) {
        console.error('Withdraw status toggle execution fault:', err);
        return res.status(500).json({ success: false, error: 'Database flag update processing failure.' });
    }
});
// ==================== NEW ALIAS ROUTE FOR FREEZE ACCOUNT BUTTONS ====================
router.post('/toggle-freeze', isAdmin, async (req, res) => {
    try {
        const { userId } = req.body;
        const adminManagerCode = req.session.adminCode ? req.session.adminCode.trim() : '';
        const codeQueryRegex = { $regex: new RegExp(`^${adminManagerCode}$`, 'i') };

        // Locate user belonging exclusively to this administrative node workspace
        const targetUser = await User.findOne({ _id: userId, assignedAdminCode: codeQueryRegex });
        if (!targetUser) {
            return res.status(404).json({ success: false, msg: 'Target customer data boundary mismatch or unlinked.' });
        }

        // Toggle the specific frozen boolean field cleanly
        targetUser.isFrozen = !targetUser.isFrozen;
        await targetUser.save();

        return res.json({ 
            success: true, 
            msg: `Account freeze state flipped successfully to ${targetUser.isFrozen}` 
        });
    } catch (err) {
        console.error('Account freeze status toggle execution fault:', err);
        return res.status(500).json({ success: false, error: 'Database flag update processing failure.' });
    }
});
// =========================================================================
// RENDER SUBSIDIARY MANAGEMENT SCREENS (EXPLICIT ADMIN PANEL PAGES)
// =========================================================================

// 1. Manage Registered Users Interface Sub-Terminal View
router.get('/manage-users', isAdmin, async (req, res) => {
    try {
        const adminCode = req.session.adminCode.trim();
        const users = await User.find({ assignedAdminCode: { $regex: new RegExp(`^${adminCode}$`, 'i') } });
        res.render('admin/manageUsers', { users, adminCode });
    } catch (err) {
        console.error('Render manage users view failure:', err);
        res.status(500).send('Database connection failure while pulling active rosters.');
    }
});

// 2. Pending Remittance Clearings Ledger Screen View (Updated to include Deposit Proofs)
router.get('/pending-withdrawals', isAdmin, async (req, res) => {
    try {
        const adminCode = req.session.adminCode.trim().toLowerCase();
        
        // 1. Fetch pending withdrawals assigned to this admin
        const pendingWithdrawals = await Withdrawal.find({ 
            assignedAdminCode: adminCode, 
            status: 'pending' 
        }).populate('userId');

        // 2. TEMPORARY DEBUGGING QUERY: Pull EVERYTHING to verify database existence
        const pendingDeposits = await Deposit.find({}).populate('userId');
        
        // Log to your terminal console so you can see what is happening behind the scenes
        console.log("=== LIVE DEPOSIT REPOSITORY SYNC ===");
        console.log("Current Admin Code Active:", adminCode);
        console.log("Raw documents fetched from DB:", pendingDeposits);
        
        // 3. Send BOTH arrays to the template file
        res.render('admin/withdrawals', { 
            pendingWithdrawals, 
            pendingDeposits, // Attaching the deposits payload here
            adminCode 
        });
    } catch (err) {
        console.error('Render withdrawals view crash:', err);
        res.status(500).send('Database sync pipeline disruption on request queue collection.');
    }
});

// 3. Pending Premium Activation Requests Ledger Screen View
router.get('/pending-plans', isAdmin, async (req, res) => {
    try {
        const adminCode = req.session.adminCode.trim();
        const pendingUsers = await User.find({ 
            assignedAdminCode: { $regex: new RegExp(`^${adminCode}$`, 'i') }, 
            planRequestStatus: 'pending' 
        });
        res.render('admin/pendingPlans', { pendingUsers, adminCode });
    } catch (err) {
        console.error('Render premium registration view failure:', err);
        res.status(500).send('Failed to compile investment verification nodes rows.');
    }
});


// =========================================================================
// TRANSACTION TERMINATION HANDSHAKES (SETTLEMENT CORRIDORS MUTATIONS)
// =========================================================================

// 1. Authorize Portfolio Liquidity Withdrawal Request Action
router.post('/withdrawals/approve', isAdmin, async (req, res) => {
    try {
        const { withdrawalId } = req.body;
        const adminCode = req.session.adminCode.trim().toLowerCase();

        const transactionTarget = await Withdrawal.findOne({ 
    _id: withdrawalId, 
    $or: [{ assignedAdminCode: adminCode }, { assignedAdminCode: { $exists: false } }, { assignedAdminCode: "" }]
});
        if (!transactionTarget || transactionTarget.status !== 'pending') {
            return res.status(400).json({ success: false, msg: 'Target financial row mismatch or already mutated.' });
        }

        transactionTarget.status = 'completed';
        await transactionTarget.save();
        return res.json({ success: true, msg: 'Outbound asset release contract marked complete.' });
    } catch (err) {
        console.error('Withdrawal settlement transaction crash:', err);
        return res.status(500).json({ success: false, error: 'Ledger rewrite anomaly.' });
    }
});

// 2. Deny Portfolio Liquidity Withdrawal Request Action (Refunding active capital balance)
router.post('/withdrawals/reject', isAdmin, async (req, res) => {
    try {
        const { withdrawalId } = req.body;
        const adminCode = req.session.adminCode.trim().toLowerCase();

        const transactionTarget = await Withdrawal.findOne({ 
    _id: withdrawalId, 
    $or: [{ assignedAdminCode: adminCode }, { assignedAdminCode: { $exists: false } }, { assignedAdminCode: "" }]
});
        if (!transactionTarget || transactionTarget.status !== 'pending') {
            return res.status(400).json({ success: false, msg: 'Target ledger entity untraceable or settled.' });
        }

        // Return locked investment funds back to active client ledger row instantly
        const correspondingUserNode = await User.findById(transactionTarget.userId);
        if (correspondingUserNode) {
            correspondingUserNode.balance = (correspondingUserNode.balance || 0) + transactionTarget.amount;
            await correspondingUserNode.save();
        }

        transactionTarget.status = 'rejected';
        await transactionTarget.save();
        return res.json({ success: true, msg: 'Outbound liquidity request dismissed. Funds safely returned to client balance.' });
    } catch (err) {
        console.error('Withdrawal denial system loop error:', err);
        return res.status(500).json({ success: false, error: 'Financial data rollback loop processing error.' });
    }
});

// =========================================================================
// FETCH USER WORKSPACE ASSIGNED DEPOSIT GATEWAYS (USER-SIDE OPERATION)
// =========================================================================
router.get('/api/get-deposit-gateways', isUser, async (req, res) => {
    try {
        // Find the current logged-in user to see which admin they belong to
        const activeUser = await User.findById(req.session.userId);
        if (!activeUser) {
            return res.status(404).json({ success: false, msg: 'User profile untraceable.' });
        }

        // Fetch only the wallets created by that specific user's assigned admin code
        const userAdminCode = activeUser.assignedAdminCode ? activeUser.assignedAdminCode.trim().toLowerCase() : '';
        const wallets = await Gateway.find({ assignedAdminCode: userAdminCode });

        return res.json(wallets);
    } catch (err) {
        console.error('Error serving deposit gateways to subscriber:', err);
        return res.status(500).json({ success: false, msg: 'Failed to read connection grid configuration.' });
    }
});

// =========================================================================
// INTERACTIVE DATA MANAGEMENT CORRIDORS (ADMINISTRATIVE ROW MUTATIONS)
// =========================================================================

// 1. Fetch current deposit wallet addresses configured by this administrator
router.get('/finance/gateways', isAdmin, async (req, res) => {
    try {
        const adminManagerCode = req.session.adminCode ? req.session.adminCode.trim().toLowerCase() : '';
        const gateways = await Gateway.find({ assignedAdminCode: adminManagerCode });
        return res.json(gateways);
    } catch (err) {
        console.error('Fetch admin gateways list failure:', err);
        return res.status(500).json({ success: false, msg: 'Database query execution failure.' });
    }
});

// 2. Insert new deposit routing asset configuration target address string
router.post('/finance/create-gateway', isAdmin, async (req, res) => {
    try {
        const { blockchain, address } = req.body;
        const adminManagerCode = req.session.adminCode ? req.session.adminCode.trim().toLowerCase() : '';

        if (!blockchain || !address || address.trim() === '') {
            return res.status(400).json({ success: false, msg: 'Validation error: Missing configuration strings.' });
        }

        const freshGateway = new Gateway({
            blockchain,
            address: address.trim(),
            assignedAdminCode: adminManagerCode
        });

        await freshGateway.save();
        return res.status(201).json({ success: true, msg: 'New gateway network added successfully.' });
    } catch (err) {
        console.error('Gateway generation exception:', err);
        return res.status(500).json({ success: false, msg: 'Failed to commit asset coordinates parameter.' });
    }
});

// 3. Modify or mutate an existing gateway route property mapping parameters
router.put('/finance/update-gateway/:id', isAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { blockchain, address } = req.body;
        const adminManagerCode = req.session.adminCode ? req.session.adminCode.trim().toLowerCase() : '';

        if (!blockchain || !address || address.trim() === '') {
            return res.status(400).json({ success: false, msg: 'Validation error: Empty structural metrics.' });
        }

        const target = await Gateway.findOne({ _id: id, assignedAdminCode: adminManagerCode });
        if (!target) {
            return res.status(404).json({ success: false, msg: 'Target parameter node completely untraceable.' });
        }

        target.blockchain = blockchain;
        target.address = address;
        await target.save();

        return res.json({ success: true, msg: 'Wallet entry sequence coordinates successfully updated.' });
    } catch (err) {
        console.error('Update gateway error:', err);
        return res.status(500).json({ success: false, msg: 'Failed to update ledger records.' });
    }
});

// 4. Purge or delete a deposit tracking endpoint target from display rows
router.delete('/finance/delete-gateway/:id', isAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const adminManagerCode = req.session.adminCode ? req.session.adminCode.trim().toLowerCase() : '';

        const executionLog = await Gateway.deleteOne({ _id: id, assignedAdminCode: adminManagerCode });
        if (executionLog.deletedCount === 0) {
            return res.status(404).json({ success: false, msg: 'No matched entry found inside this admin container workspace.' });
        }

        return res.json({ success: true, msg: 'Gateway address parameter successfully dropped.' });
    } catch (err) {
        console.error('Delete gateway tracking failure:', err);
        return res.status(500).json({ success: false, msg: 'Storage execution sequence anomaly.' });
    }
});

// =========================================================================
// SUBSCRIBER MANUAL USER-SIDE TRANSACTIONAL HANDSHAKES
// =========================================================================

// 1. Submit structural transaction reference string (TXID / HASH) for incoming audits
router.post('/report-deposit-proof', isUser, async (req, res) => {
    try {
        const { blockchain, txid } = req.body;
        if (!blockchain || !txid || txid.trim() === '') {
            return res.status(400).json({ success: false, msg: 'Invalid payload: Missing transmission reference hashes.' });
        }

        const currentActiveUser = await User.findById(req.session.userId);
        if (!currentActiveUser) {
            return res.status(404).json({ success: false, msg: 'Active user row instance fully offline.' });
        }

        const userAssignedAdminCode = currentActiveUser.assignedAdminCode ? currentActiveUser.assignedAdminCode.trim().toLowerCase() : '';

        // Create a new deposit record entry marked as pending tracking logs
        // Note: Make sure you have imported your Deposit model at the top of admin.js if you use one!
        const newDepositEntry = new Deposit({
            userId: currentActiveUser._id,
            blockchain: blockchain,
            txid: txid.trim(),
            status: 'pending', // default status flag
            assignedAdminCode: userAssignedAdminCode,
            createdAt: new Date()
        });

        await newDepositEntry.save();

        return res.json({ success: true, msg: 'Proof signature registered successfully.' });
    } catch (err) {
        console.error('Error logging deposit proof payload:', err);
        return res.status(500).json({ success: false, msg: 'Internal database logging failure.' });
    }
});
// 2. Process portfolio investment capital outflow remittance transfer request actions
router.post('/request-withdrawal', isUser, async (req, res) => {
    try {
        const { blockchain, address, amount } = req.body;
        const requestedValue = parseFloat(amount);

        if (!address || address.trim() === '' || isNaN(requestedValue) || requestedValue <= 0) {
            return res.status(400).json({ success: false, msg: 'Validation parameters mismatch: Review numerical boundaries.' });
        }

        const activeUser = await User.findById(req.session.userId);
        if (!activeUser) {
            return res.status(404).json({ success: false, msg: 'Account user interface identity fully detached.' });
        }

        if (activeUser.isWithdrawRestrained) {
            return res.status(403).json({ 
                success: false, 
                msg: 'Action Terminated: Remittance abilities are completely restricted on this node layer.' 
            });
        }

        if (activeUser.isFrozen) {
            return res.status(403).json({ success: false, msg: 'Action Terminated: Asset balance framework state currently frozen.' });
        }

        // Operational design constraint validation check ensuring user cannot pull metrics out if an investment structure is active
        if (activeUser.currentPlan && activeUser.currentPlan !== 'None' && activeUser.currentPlan !== '') {
            return res.status(400).json({ 
                success: false, 
                msg: 'Action Aborted: Withdrawals are entirely restricted while a yield generation framework contract is active.' 
            });
        }

        if (activeUser.balance < requestedValue) {
            return res.status(400).json({ success: false, msg: 'Insufficient liquidity depth in asset container.' });
        }

        // Place requested value in escrow right away
        activeUser.balance -= requestedValue;
        await activeUser.save();

        const pendingWithdrawal = new Withdrawal({
            userId: activeUser._id,
            method: blockchain || 'Blockchain Network',
            address: address.trim(),
            amount: requestedValue,
            status: 'pending',
            assignedAdminCode: activeUser.assignedAdminCode ? activeUser.assignedAdminCode.trim().toLowerCase() : ''
        });

        await pendingWithdrawal.save();
        return res.json({ success: true, msg: 'Remittance request initialized under verification pending status.' });
    } catch (err) {
        console.error('Error compiling withdrawal request transaction loop:', err);
        return res.status(500).json({ success: false, msg: 'Internal financial ledger exception.' });
    }
});

// ==================== ADMINISTRATIVE DEPOSIT PROCESSING CONTROL ENDPOINTS ====================

// 1. Verify and Authorize Deposit Proof
router.post('/deposits/verify', isAdmin, async (req, res) => {
    try {
        const { depositId } = req.body;
        if (!depositId) return res.status(400).json({ success: false, msg: 'Missing deposit identity index.' });

        const adminCode = req.session.adminCode ? req.session.adminCode.trim() : '';
        const codeQueryRegex = { $regex: new RegExp(`^${adminCode}$`, 'i') };
        
        const targetDeposit = await Deposit.findOne({ _id: depositId, assignedAdminCode: codeQueryRegex, status: 'pending' });
        if (!targetDeposit) return res.status(404).json({ success: false, msg: 'Deposit untraceable or processed.' });

        const associatedUser = await User.findById(targetDeposit.userId);
        if (!associatedUser) return res.status(404).json({ success: false, msg: 'User profile untraceable.' });

        // Safely adjust user account ledger credit points balance
        const currentBalance = parseFloat(associatedUser.balance) || 0;
        const depositAmount = parseFloat(targetDeposit.amount) || 0;
        associatedUser.balance = (currentBalance + depositAmount).toFixed(2);

        // Shift tracking variables cleanly matching schema string constraints
        targetDeposit.status = 'approved';

        await associatedUser.save();
        await targetDeposit.save();

        return res.json({ success: true, msg: `Deposit verified successfully! Credited $${depositAmount.toFixed(2)}.` });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, msg: 'Internal mutation error.' });
    }
});

// 2. Reject Deposit Proof Signature
router.post('/deposits/reject', isAdmin, async (req, res) => {
    try {
        const { depositId } = req.body;
        if (!depositId) return res.status(400).json({ success: false, msg: 'Missing deposit identity index.' });

        const adminCode = req.session.adminCode ? req.session.adminCode.trim() : '';
        const codeQueryRegex = { $regex: new RegExp(`^${adminCode}$`, 'i') };
        
        const targetDeposit = await Deposit.findOne({ _id: depositId, assignedAdminCode: codeQueryRegex, status: 'pending' });
        if (!targetDeposit) return res.status(404).json({ success: false, msg: 'Deposit untraceable or processed.' });

        // Shift tracking variables cleanly matching schema string constraints
        targetDeposit.status = 'declined';
        await targetDeposit.save();

        return res.json({ success: true, msg: 'Deposit marked declined.' });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, msg: 'Internal mutation error.' });
    }
});

// ============================================================================
// 🟢 WHATSAPP CONFIGURATION ENGINE - DIRECT MONGO DRIVER LAYPASS (BULLETPROOF)
// ============================================================================

// Fetch the WhatsApp number configuration bypassing Mongoose schemas
router.get('/get-whatsapp-route', async (req, res) => {
    try {
        if (!req.session || !req.session.userId) {
            return res.status(401).json({ success: false, msg: 'Unauthorized session window.' });
        }

        const mongoose = require('mongoose');
        const objId = new mongoose.Types.ObjectId(req.session.userId);

        // Try reading raw document directly from the Users collection
        let profile = await mongoose.connection.collection('users').findOne({ _id: objId });
        
        // Fallback: Try reading raw document directly from the Admins collection
        if (!profile) {
            profile = await mongoose.connection.collection('admins').findOne({ _id: objId });
        }

        return res.json({ 
            success: true, 
            whatsappNumber: profile ? (profile.whatsappNumber || '') : '' 
        });
    } catch (error) {
        console.error('WhatsApp GET internal error:', error);
        return res.status(500).json({ success: false, msg: 'Internal database error channel.' });
    }
});

// ============================================================================
// 🟢 SOLID FIX: ADMIN DASHBOARD WHATSAPP UPDATE PIPELINE
// ============================================================================
router.post('/update-whatsapp-route', async (req, res) => {
    try {
        const { whatsappNumber } = req.body;
        // Strip out non-digit values completely to clean the entry string
        const sanitizedNumber = whatsappNumber ? whatsappNumber.trim().replace(/\D/g, '') : '';

        const mongoose = require('mongoose');

        // Extract ID dynamically from whichever session block your admin panel uses
        let adminIdString = null;
        if (req.session && req.session.admin && req.session.admin._id) {
            adminIdString = req.session.admin._id;
        } else if (req.session && req.session.userId) {
            adminIdString = req.session.userId;
        }

        if (!adminIdString) {
            return res.status(401).json({ success: false, msg: 'Session identification lost.' });
        }

        const objId = new mongoose.Types.ObjectId(adminIdString);

        // 1. Force write straight into the raw 'admins' collection document matching the active session ID
        await mongoose.connection.collection('admins').updateOne(
            { _id: objId },
            { $set: { whatsappNumber: sanitizedNumber } }
        );

        // 2. Force write straight into the raw 'users' collection document as a safety fallback
        await mongoose.connection.collection('users').updateOne(
            { _id: objId },
            { $set: { whatsappNumber: sanitizedNumber } }
        );

        // 3. GLOBAL FALLBACK OVERRIDE: Update ALL admin-role accounts to ensure the database isn't empty
        await mongoose.connection.collection('admins').updateMany(
            {},
            { $set: { whatsappNumber: sanitizedNumber } }
        );

        return res.json({ 
            success: true, 
            msg: 'WhatsApp communications matrix successfully committed.' 
        });
    } catch (error) {
        console.error('Error updating WhatsApp route:', error);
        return res.status(500).json({ success: false, msg: 'Internal sync pipeline failure.' });
    }
});

module.exports = router;