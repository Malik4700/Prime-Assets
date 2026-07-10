
// 1. Load environment variables
require('dotenv').config();

// 2. Import packages
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const connectDB = require('./config/db');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');

// Import database models
const User = require('./models/User'); 
const Withdrawal = require('./models/Withdrawal');

// Import route definitions
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const superadminRoutes = require('./routes/superadmin');
const referralRoutes = require('./routes/referrals');
const ReferralCode = require('./models/ReferralCode');
const MongoStore = require('connect-mongo');

const app = express();
const PORT = process.env.PORT || 3000;

// Wrap server to support WebSockets
const server = http.createServer(app);
const io = socketIo(server);

// Connect to Database
connectDB();

// Middlewares
app.use(express.json()); 
app.use(express.urlencoded({ extended: true })); 

// Session Configuration
app.use(session({
    secret: process.env.SESSION_SECRET || 'fallback_secret_key_2026',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
        mongoUrl: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/your-database-name',
        ttl: 14 * 24 * 60 * 60 // 14 days storage tracking
    }),
    cookie: { 
        maxAge: 14 * 24 * 60 * 60 * 1000, // 14 days session lifespan
        httpOnly: true,                  
        secure: process.env.NODE_ENV === 'production', 
        sameSite: 'lax'
    }
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================================
// 🔒 GLOBAL MAINTENANCE INTERLOCK SYSTEM (UPDATED BYPASS)
// ============================================================================
const Superadmin = require('./models/Superadmin');

app.use(async (req, res, next) => {
    try {
        const config = await Superadmin.findOne();
        
        if (config && config.isMaintenanceActive) {
            // Rule 1: Always let active Superadmins pass through
            if (req.session && req.session.user && req.session.user.role === 'superadmin') {
                return next();
            }
            
            // Rule 2: CRITICAL BYPASSES - Let Superadmin routes, auth pages, and assets skip the lock screen completely
            const allowedPaths = ['/auth/login', '/superadmin/login', '/auth/logout', '/login', '/superadmin/dashboard', '/superadmin/toggle-maintenance'];
            if (allowedPaths.includes(req.path) || req.path.startsWith('/superadmin') || req.path.startsWith('/css') || req.path.startsWith('/js')) {
                return next();
            }

            // Interrupt normal user requests and display system down overlay
            return res.status(503).send(`
                <!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>System Maintenance</title>
                    <script src="https://cdn.tailwindcss.com"></script>
                </head>
                <body class="bg-[#030f0c] text-slate-100 min-h-screen flex items-center justify-center font-sans p-4">
                    <div class="max-w-md w-full text-center space-y-6 p-8 rounded-[28px] border border-emerald-500/20 bg-slate-950/80 backdrop-blur-xl shadow-2xl">
                        <div class="w-16 h-16 bg-amber-500/10 border border-amber-500/20 text-amber-400 mx-auto flex items-center justify-center rounded-2xl text-3xl animate-pulse">
                            ⚡
                        </div>
                        <div class="space-y-2">
                            <h1 class="font-black text-xs uppercase tracking-widest text-white">Platform Offline</h1>
                            <p class="text-[11px] text-slate-400 font-medium leading-relaxed font-mono">
                                The system is undergoing scheduled core optimization. Regular operations will restore automatically.
                            </p>
                        </div>
                        <div class="border-t border-emerald-500/10 pt-4 text-[9px] text-slate-500 font-bold tracking-wider font-mono uppercase">
                            CORE INTERLOCK ACTIVE
                        </div>
                    </div>
                </body>
                </html>
            `);
        }
        next();
    } catch (err) {
        console.error("Maintenance guard error:", err);
        next();
    }
});

// Mount main routing systems
app.use('/admin/referral-manager', referralRoutes);
app.use('/admin', adminRoutes);
app.use('/superadmin', superadminRoutes);
app.use('/auth', authRoutes);

// Landing Page Route
app.get('/', (req, res) => {
    res.render('landing');
});

// Auth Login Protection Middleware
const requireLogin = (req, res, next) => {
    if (!req.session || !req.session.userId) {
        if (req.headers['accept']?.includes('application/json')) {
            return res.status(401).json({ error: 'Session handshake unauthenticated' });
        }
        return res.redirect('/auth/login');
    }
    next();
};

// ==================== NEW FIXED USER ROUTES ====================

// 1. User Home Page Route
app.get('/user/home', requireLogin, async (req, res) => {
    try {
        const freshUser = await User.findById(req.session.userId);
        if (!freshUser) return res.redirect('/auth/login');
        res.render('user/Home', { user: freshUser });
    } catch (err) {
        res.redirect('/auth/login');
    }
});

// 2. User Plans Page Route (Fixes Cannot GET /user/plans)
app.get('/user/plans', requireLogin, async (req, res) => {
    try {
        const freshUser = await User.findById(req.session.userId);
        if (!freshUser) return res.redirect('/auth/login');
        res.render('user/Plans', { user: freshUser });
    } catch (err) {
        res.redirect('/user/home');
    }
});

// 3. User Profile Page Route (Fixes Cannot GET /user/profile)
app.get('/user/profile', requireLogin, async (req, res) => {
    try {
        const freshUser = await User.findById(req.session.userId);
        if (!freshUser) return res.redirect('/auth/login');
        res.render('user/Profile', { user: freshUser });
    } catch (err) {
        res.redirect('/user/home');
    }
});

app.post('/generate-referral-code', async (req, res) => {
    try {
        const targetUsername = req.body.targetUsername || req.body.referrerUsername;
        const activePromoKey = req.session.adminPromo || req.session.adminCode || '';

        if (!targetUsername || !targetUsername.trim()) {
            return res.status(400).json({ success: false, error: "Referrer name variable is required." });
        }

        const userInstance = await User.findOne({ username: targetUsername.trim() });
        if (!userInstance) {
            return res.status(404).json({ success: false, error: `User configuration profile "${targetUsername}" not found inside directory.` });
        }

        const generateMixedCode = () => {
            const dictionary = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
            let resultChain = '';
            const generationLength = Math.floor(Math.random() * 2) + 7;
            for (let index = 0; index < generationLength; index++) {
                resultChain += dictionary.charAt(Math.floor(Math.random() * dictionary.length));
            }
            return resultChain;
        };

        let codeCandidate = generateMixedCode();
        let isCollisionDetected = await ReferralCode.findOne({ code: codeCandidate });
        while (isCollisionDetected) {
            codeCandidate = generateMixedCode();
            isCollisionDetected = await ReferralCode.findOne({ code: codeCandidate });
        }

        const newReferralRecord = new ReferralCode({
            code: codeCandidate,
            referrerUsername: targetUsername.trim(),
            assignedAdminCode: activePromoKey.trim() || 'SYSTEM', 
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

// Purchase Purchase intake Block - UPDATED FOR LIFETIME BEGINNER RESTRICTIONS
app.post('/user/request-plan-buy', requireLogin, async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({ success: false, msg: 'Authentication matrix drop: Session context not found.' });
        }

        const { planDays, planName, planCost } = req.body;
        if (!planDays || !planName || !planCost) {
            return res.status(400).json({ success: false, msg: 'Bad Request: Incomplete structure stream data.' });
        }

        const activeUser = await User.findById(req.session.userId);
        if (!activeUser) {
            return res.status(404).json({ success: false, msg: 'Account footprint not identified.' });
        }

        // ENFORCE BEGINNER LIFETIME CONSTRAINT
        if (planDays === '7' && (activeUser.hasBoughtBeginner === true || activeUser.hasBoughtBeginner === 'true')) {
            return res.status(400).json({ success: false, msg: 'Limit Exceeded: Tier 1 Beginner allocation is restricted to single deployment profiles.' });
        }

        if (activeUser.planRequestStatus === 'pending' || (activeUser.currentPlan && activeUser.currentPlan !== 'None')) {
            return res.status(400).json({ success: false, msg: 'Account state locked: Existing plan array or order currently active.' });
        }

        if (activeUser.balance < parseFloat(planCost)) {
            return res.status(400).json({ success: false, msg: 'Ledger discrepancy: Insufficient systemic validation balance.' });
        }

        activeUser.planRequestStatus = 'pending';
        activeUser.requestedPlanName = planName;
        activeUser.requestedPlanCost = parseFloat(planCost);
        activeUser.requestedPlanDays = planDays;

        await activeUser.save();
        console.log(`[LEDGER TRANSACTION QUEUE] User ${activeUser.username} submitted order for: ${planName} ($${planCost})`);

        return res.json({ success: true, msg: 'Order pipeline transmission logged cleanly. Pending administrative approval.' });
    } catch (err) {
        console.error('Systemic compilation failure log processing plan purchase order request:', err);
        return res.status(500).json({ success: false, msg: 'Internal core execution loop processing fault.' });
    }
});

// Live Data Sync API Endpoint for background updates
app.get('/dashboard', requireLogin, async (req, res) => {
    try {
        const userContext = await User.findById(req.session.userId);
        if (!userContext) return res.status(404).json({ error: 'User dropped' });
        const userWithdrawals = await Withdrawal.find({ userId: req.session.userId }).sort({ createdAt: -1 });

        return res.json({
            success: true,
            user: {
                username: userContext.username,
                email: userContext.email,
                phone: userContext.phone || '---',
                country: userContext.country || '---',
                balance: parseFloat(userContext.balance) || 0,        
                accruedYield: parseFloat(userContext.accruedYield) || 0,
                currentPlan: userContext.currentPlan || 'None',
                planExpiresAt: userContext.planExpiresAt || '',
                isBlocked: userContext.isBlocked || false,
                isFrozen: userContext.isFrozen || false,
                isWithdrawRestrained: userContext.isWithdrawRestrained || false,
                withdrawals: userWithdrawals
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/user/request-withdraw', requireLogin, async (req, res) => {
    try {
        const { blockchain, address, amount } = req.body;
        const requestedValue = parseFloat(amount);

        if (!address || address.trim() === '' || isNaN(requestedValue) || requestedValue <= 0) {
            return res.status(400).json({ success: false, msg: 'Invalid transaction parameters.' });
        }

        const activeUser = await User.findById(req.session.userId);
        if (!activeUser) {
            return res.status(404).json({ success: false, msg: 'User profile instance matrix not located.' });
        }

        if (activeUser.isFrozen) {
            return res.status(403).json({ success: false, msg: 'Action Aborted: Vault container is currently frozen.' });
        }

        if (activeUser.isWithdrawRestrained) {
            return res.status(403).json({ success: false, msg: 'Action Aborted: Remittance privileges are suspended on this instance.' });
        }

        if (activeUser.currentPlan && activeUser.currentPlan !== 'None' && activeUser.currentPlan !== '') {
            return res.status(400).json({ 
                success: false, 
                msg: 'Action Denied: Withdrawals are restricted while an active plan is running.' 
            });
        }

        if (activeUser.balance < requestedValue) {
            return res.status(400).json({ success: false, msg: 'Insufficient liquidity depth in asset container.' });
        }

        activeUser.balance -= requestedValue;
        await activeUser.save();

        const pendingWithdrawal = new Withdrawal({
            userId: activeUser._id || req.session.userId,
            method: blockchain || req.body.blockchain || req.body.method || req.body.network || 'Blockchain Network',
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

// Admin Account Purge Terminal Controller Route
app.post('/admin/delete-user', requireLogin, async (req, res) => {
    try {
        if (!req.session.adminCode) {
            return res.status(403).json({ success: false, msg: 'Unauthorized intercept: Administrative node access only.' });
        }
        const { userId } = req.body;
        if (!userId) {
            return res.status(400).json({ success: false, msg: 'Bad Request: Target user footprint identifier missing.' });
        }
        const operationalResult = await User.findByIdAndDelete(userId);
        if (!operationalResult) {
            return res.status(404).json({ success: false, msg: 'Purge target not found in records matrix.' });
        }
        console.log(`[SYSTEM LEDGER PURGE] Admin (${req.session.adminCode}) permanently deleted user account node: ${userId}`);
        return res.json({ success: true, msg: 'Profile document container successfully removed from operational matrix.' });
    } catch (err) {
        console.error('Critical exception compiled during user account execution purge:', err);
        return res.status(500).json({ success: false, msg: 'Internal systems matrix error updating ledger files.' });
    }
});

// Admin User Block Status Toggle Controller Route
app.post('/admin/toggle-block', requireLogin, async (req, res) => {
    try {
        if (!req.session.adminCode) {
            return res.status(403).json({ success: false, msg: 'Unauthorized: Access restricted to administrative nodes.' });
        }
        const { userId } = req.body;
        if (!userId) {
            return res.status(400).json({ success: false, msg: 'Bad Request: Missing target footprint user ID.' });
        }
        const targetUser = await User.findById(userId);
        if (!targetUser) {
            return res.status(404).json({ success: false, msg: 'User profile matrix not found.' });
        }
        targetUser.isBlocked = !targetUser.isBlocked;
        await targetUser.save();
        console.log(`[SYSTEM AUTH MATRIX] Admin (${req.session.adminCode}) changed block flag for ${targetUser.username} to: ${targetUser.isBlocked}`);
        return res.json({ success: true, msg: `User successfully ${targetUser.isBlocked ? 'blocked' : 'unblocked'}.` });
    } catch (err) {
        console.error('Exception compiling user block status modification:', err);
        return res.status(500).json({ success: false, msg: 'Internal server error processing security toggle.' });
    }
});

// Admin Plans Desk JSON Feeder API Stream Route
app.get('/admin/api/users-plans-queue', requireLogin, async (req, res) => {
    try {
        if (!req.session.adminCode) {
            return res.status(403).json({ success: false, msg: 'Unauthorized workspace access.' });
        }
        
        // 🟢 FIXED: Filter users so admins ONLY see plans belonging to their own assigned promo code node
        const adminManagerCode = req.session.adminCode.toUpperCase().trim();
        const systemUsers = await User.find({
            assignedAdminCode: adminManagerCode,
            $or: [
                { planRequestStatus: 'pending' },
                { currentPlan: { $exists: true, $ne: 'None', $ne: '' } }
            ]
        });
        return res.json(systemUsers);
    } catch (err) {
        console.error('API Plan cluster query exception:', err);
        return res.status(500).json({ error: 'Failed to synchronize system records stream data matrix.' });
    }
});

// Admin Engine Control Toggle Handler (Stop/Resume Yield Generation)
app.post('/admin/plans/toggle-engine-state', requireLogin, async (req, res) => {
    try {
        if (!req.session.adminCode) {
            return res.status(403).json({ success: false, msg: 'Access Denied: Administrative authority missing.' });
        }
        const { userId, command } = req.body;
        if (!userId || !command) {
            return res.status(400).json({ success: false, msg: 'Invalid execution parameters passed to node link.' });
        }
        const systemUser = await User.findById(userId);
        if (!systemUser) {
            return res.status(404).json({ success: false, msg: 'Target account profile matrix drop-out recorded.' });
        }
        if (command === 'stop') {
            systemUser.isPlanPaused = true;
        } else if (command === 'continue') {
            systemUser.isPlanPaused = false;
        } else {
            return res.status(400).json({ success: false, msg: 'Unknown system directive payload command configuration.' });
        }
        await systemUser.save();
        console.log(`[ENGINE MATRIX STATE CHANGE] Admin (${req.session.adminCode}) changed running tier state for user ${systemUser.username} to: ${command.toUpperCase()}`);
        return res.json({ 
            success: true, 
            msg: `Yield generation engine matrix successfully adjusted to state: ${command.toUpperCase()}` 
        });
    } catch (err) {
        console.error('Critical exception running user yield generation toggle command:', err);
        return res.status(500).json({ success: false, msg: 'Internal systems runtime error updating tracking files.' });
    }
});

// Admin Plans Queue Action Handler (Approve or Decline Pending User Plans) - UPDATED FOR COMPLEX TIER PARSING
app.post('/admin/plans/action', requireLogin, async (req, res) => {
    try {
        if (!req.session.adminCode) {
            return res.status(403).json({ success: false, msg: 'Access Denied: Missing administrative authority privileges.' });
        }

        const { userId, action } = req.body;
        if (!userId || !action) {
            return res.status(400).json({ success: false, msg: 'Invalid payload: Missing execution target details.' });
        }

        const targetUser = await User.findById(userId);
        if (!targetUser) {
            return res.status(404).json({ success: false, msg: 'Target profile document missing from database instance.' });
        }

        if (action === 'approve') {
            if (targetUser.planRequestStatus !== 'pending') {
                return res.status(400).json({ success: false, msg: 'Conflict: User account has no active pending order.' });
            }

            const planCostThreshold = parseFloat(targetUser.requestedPlanCost || 0);
            if (targetUser.balance < planCostThreshold) {
                return res.status(400).json({ success: false, msg: 'Ledger failure: Target balance is below minimum activation threshold.' });
            }

            // Securely parse variable composite strings (like "30_premium", "60_platinum") cleanly into integer days
            const rawDaysToken = targetUser.requestedPlanDays || '15';
            const daysToExpiration = parseInt(rawDaysToken.split('_')[0]) || 15;

            const expirationCalculatedDate = new Date();
            expirationCalculatedDate.setDate(expirationCalculatedDate.getDate() + daysToExpiration);

            // Commit system configurations 
            targetUser.currentPlan = rawDaysToken; 
            targetUser.planExpiresAt = expirationCalculatedDate.toISOString();
            targetUser.planActivatedAt = new Date().toISOString(); 
            targetUser.isPlanPaused = false;

            // TRACK LIFETIME PURCHASE OF BEGINNER PLAN UPON VALID ADMINISTRATOR APPROVAL
            if (rawDaysToken === '7') {
                targetUser.hasBoughtBeginner = true;
            }

            // Clear temporary staging variables
            targetUser.planRequestStatus = 'none';
            targetUser.requestedPlanName = '';
            targetUser.requestedPlanCost = 0;
            targetUser.requestedPlanDays = '';

        } else if (action === 'decline') {
            targetUser.planRequestStatus = 'none';
            targetUser.requestedPlanName = '';
            targetUser.requestedPlanCost = 0;
            targetUser.requestedPlanDays = '';
        } else {
            return res.status(400).json({ success: false, msg: 'Unknown process action configuration request.' });
        }

        await targetUser.save();
        console.log(`[QUEUE MANAGEMENT SYSTEM] Admin (${req.session.adminCode}) executed action [${action.toUpperCase()}] for user: ${targetUser.username}`);

        return res.json({ 
            success: true, 
            msg: `User registration tier queue request successfully processed with action status: ${action.toUpperCase()}` 
        });
    } catch (err) {
        console.error('Critical engine exception running user plan activation handle action:', err);
        return res.status(500).json({ success: false, msg: 'Internal financial ledger transaction update error.' });
    }
});

// Logout Handling
app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error("Error destroying session:", err);
            return res.redirect('/'); 
        }
        res.clearCookie('connect.sid');
        res.redirect('/');
    });
});

// Real-Time WebSockets
io.on('connection', (socket) => {
    socket.on('joinUserRoom', (userId) => { socket.join(userId); });
    socket.on('disconnect', () => {});
});

// ==================== AUTOMATED BACKGROUND YIELD ENGINE ====================
// UPDATED FOR DYNAMIC ACCRUAL RATES BASED ON PLAN PROFIT RATIOS
setInterval(async () => {
    try {
        const now = new Date();
        
        const activeUsers = await User.find({
            currentPlan: { $exists: true, $ne: 'None', $ne: '' },
            planExpiresAt: { $gt: now }, 
            isPlanPaused: false
        });

        for (const user of activeUsers) {
            const principal = parseFloat(user.balance) || 0;
            if (principal <= 0) continue; 

            // Calculate precise custom dynamic yield rates matching layout specifications
            let totalProfitPercentage = 0.20; // Default fallback to 20%
            let totalPlanDurationDays = 15;   // Default fallback to 15 Days

            const tierTokenId = user.currentPlan;
            if (tierTokenId === '7') {
                totalProfitPercentage = 0.20; // 20%
                totalPlanDurationDays = 7;
            } else if (tierTokenId === '15') {
                totalProfitPercentage = 0.20; // 20%
                totalPlanDurationDays = 15;
            } else if (tierTokenId === '30') {
                totalProfitPercentage = 0.25; // 25%
                totalPlanDurationDays = 30;
            } else if (tierTokenId === '30_premium') {
                totalProfitPercentage = 0.30; // 30%
                totalPlanDurationDays = 30;
            } else if (tierTokenId === '60') {
                totalProfitPercentage = 0.40; // 40%
                totalPlanDurationDays = 60;
            } else if (tierTokenId === '60_platinum') {
                totalProfitPercentage = 0.50; // 50%
                totalPlanDurationDays = 60;
            }

            // Distribute total profit down to exact per-minute compounding slices
            const dailyReturnRate = totalProfitPercentage / totalPlanDurationDays;
            const returnPerMinute = dailyReturnRate / 1440;

            const yieldAccruedIncrement = principal * returnPerMinute;

            // Increment balances cleanly
            user.balance = parseFloat((user.balance + yieldAccruedIncrement).toFixed(6));
            user.accruedYield = parseFloat(((user.accruedYield || 0) + yieldAccruedIncrement).toFixed(6));

            await user.save();
            
            if (io) {
                io.to(user._id.toString()).emit('balanceUpdate', {
                    balance: user.balance,
                    accruedYield: user.accruedYield
                });
            }
        }
    } catch (err) {
        console.error('Failure inside automated background yield engine loop:', err);
    }
}, 60000); // Evaluates every 60 seconds

server.listen(PORT, () => {
    console.log(`🚀 Server fully operational on port ${PORT}`);
});
