const User = require('../models/User');

function initializeProfitEngine(io) {
    console.log('⚡ Profit Engine Matrix Initialized: Monitoring active user plans directly...');

    // Multiplier yield definitions matching your Home.ejs schema specs perfectly
    const METRIC_PLAN_TIER_DICT = {
        "7": { dailyRate: (1.20 - 1) / 7 },     // 20% Profit spread over 7 Days
        "15": { dailyRate: (1.20 - 1) / 15 },   // 20% Profit spread over 15 Days
        "30": { dailyRate: (1.25 - 1) / 30 },   // 25% Profit spread over 30 Days
        "30_premium": { dailyRate: (1.30 - 1) / 30 }, // 30% Profit spread over 30 Days
        "60": { dailyRate: (1.40 - 1) / 60 },   // 40% Profit spread over 60 Days
        "60_platinum": { dailyRate: (1.50 - 1) / 60 }, // 50% Profit spread over 60 Days
        "90": { dailyRate: (1.40 - 1) / 90 },   // 40% Profit spread over 90 Days (Support for custom/promo fallback formats)
        "180": { dailyRate: (1.45 - 1) / 180 }, 
        "365": { dailyRate: (1.50 - 1) / 365 }  
    };

    // Process yields every 60 seconds (1 minute increment)
    setInterval(async () => {
        try {
            // Target users with valid active ongoing plan codes
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
                    console.log(`⏸️ Yield distribution bypassed for User (${user._id}) - Engine paused.`);
                    continue; 
                }

                // Match both static plans and fallback dynamic/promotional plans
                let tierData = METRIC_PLAN_TIER_DICT[user.currentPlan];
                if (!tierData) {
                    // Fallback for custom promotional/admin assigned duration values
                    const durationVal = parseInt(user.currentPlan) || 1;
                    const rawProfitPercent = user.currentPlanProfitPercent || user.profitPercent || 25; // default fallback 25%
                    tierData = { dailyRate: ((1 + (rawProfitPercent / 100)) - 1) / durationVal };
                }

                // Base amount computation formula per minute
                const principal = parseFloat(user.balance) || 0;
                if (principal <= 0) continue;

                const dailyProfitContribution = principal * tierData.dailyRate;
                const incrementAmountPerMinute = dailyProfitContribution / 1440;

                if (isNaN(incrementAmountPerMinute) || incrementAmountPerMinute <= 0) continue;

                // Atomically increment BOTH properties together inside the database
                const updatedUser = await User.findByIdAndUpdate(
                    user._id, 
                    {
                        $inc: { 
                            balance: incrementAmountPerMinute,
                            accruedYield: incrementAmountPerMinute 
                        }
                    },
                    { new: true } 
                );

                // Stream real-time engine telemetry updates via WebSockets
                if (io && updatedUser) {
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