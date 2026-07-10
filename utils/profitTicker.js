const User = require('../models/User');

function initializeProfitEngine(io) {
    console.log('⚡ Profit Engine Matrix Initialized: Monitoring active user plans directly...');

    // Multiplier yield definitions matching Home.ejs schema specs perfectly
    const METRIC_PLAN_TIER_DICT = {
        "15": { dailyRate: (1.20 - 1) / 15 },  // 20% Profit spread over 15 Days
        "30": { dailyRate: (1.25 - 1) / 30 },  // 25% Profit spread over 30 Days
        "60": { dailyRate: (1.30 - 1) / 60 },  // 30% Profit spread over 60 Days
        "90": { dailyRate: (1.40 - 1) / 90 },  // 40% Profit spread over 90 Days
        "180": { dailyRate: (1.45 - 1) / 180 }, // 45% Profit spread over 180 Days
        "365": { dailyRate: (1.50 - 1) / 365 }  // 50% Profit spread over 365 Days
    };

    // Process yields every 60 seconds (1 minute increment)
    setInterval(async () => {
        try {
            // Target users with valid active ongoing plan codes (Using ISO string fallback comparison format)
            const usersWithActivePlans = await User.find({
                currentPlan: { $exists: true, $ne: 'None', $ne: '' },
                planExpiresAt: { $gt: new Date().toISOString() },
                isBlocked: false
            });

            if (usersWithActivePlans.length === 0) return;

            for (let user of usersWithActivePlans) {
                // Safeguard: Check if account is restricted or frozen
                if (user.isFrozen) {
                    console.log(`⚠️ Profit skipped for ${user.username}: Account restricted/frozen.`);
                    continue;
                }

                // Check for dynamic engine suspension pause triggers
                if (user.isPlanPaused === true || user.isPlanPaused === 'true') {
                    console.log(`⏸️ Yield distribution bypassed for User (${user._id}) - Engine explicitly paused.`);
                    continue; 
                }

                const tierData = METRIC_PLAN_TIER_DICT[user.currentPlan];
                if (!tierData) continue;

                // Base amount computation formula per minute
                const principal = parseFloat(user.balance) || 0;
                if (principal <= 0) continue;

                const dailyProfitContribution = user.balance * tierData.dailyRate;
                const incrementAmountPerMinute = dailyProfitContribution / 1440;

                if (isNaN(incrementAmountPerMinute) || incrementAmountPerMinute <= 0) continue;

                // 🟢 FIX 1: Atomically increment BOTH properties together inside database engine
                const updatedUser = await User.findByIdAndUpdate(
                    user._id, 
                    {
                        $inc: { 
                            balance: incrementAmountPerMinute,
                            accruedYield: incrementAmountPerMinute 
                        }
                    },
                    { new: true } // Fetches the newly calculated values directly
                );

                // Stream real-time engine telemetry payload updates via WebSockets
                if (io && updatedUser) {
                    // 🟢 FIX 2: Emitting matching keys so your frontend syncs cleanly
                    io.to(updatedUser._id.toString()).emit('balanceUpdate', {
                        balance: updatedUser.balance,
                        accruedYield: updatedUser.accruedYield,
                        planName: updatedUser.currentPlan
                    });
                }
            }
        } catch (error) {
            console.error('❌ Profit Engine interval execution exception:', error);
        }
    }, 60000); 
}

module.exports = { initializeProfitEngine };