const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, trim: true },
    email: { type: String, required: true, unique: true, trim: true },
    phone: { type: String, required: true },
    password: { type: String, required: true },
    country: { type: String, required: true },
    gender: { type: String, required: true },
    profileImage: { type: String, default: '' }, 
    
    // THE ROLE SYSTEM: Defines authorization levels across the entire application
    role: {
        type: String, 
        enum: ['user', 'admin', 'superadmin'], 
        default: 'user' 
    },
    
    // THE ISOLATION KEY: Links regular users to an admin's invite framework
    assignedAdminCode: { type: String, index: true, default: '' }, 
    
    // Financial Ledger Metrics aligned directly to Admin Panels
    balance: { type: Number, default: 0 },         
    level: { type: Number, default: 1, min: 1 },    
    
    // --- ADVANCED PLAN INTERACTION SYSTEM MECHANICS ---
    referredWithCode: { type: String, default: '' },      // Stores the 7-8 digit referral token used during registration
    currentPlan: { type: String, default: 'None' },       // Active ongoing plan designation string (e.g., '15', '30')
    planActivatedAt: { type: Date, default: null },       // Precise timestamp when the Admin verifies and triggers the plan
    planExpiresAt: { type: Date, default: null },         // Future milestone timestamp computed to power the front-end countdown ticker
    isPlanPaused: { type: Boolean, default: false },       // Controls if a plan ticker and automated yields are frozen separately
    
    // LIFETIME PLAN CONTROLLER ARRAYS
    hasBoughtBeginner: { type: Boolean, default: false },  // Tracks if user has deployed the Tier 1 Beginner plan previously
    
    planRequestStatus: { 
        type: String, 
        enum: ['none', 'pending', 'approved', 'rejected'], // Added 'rejected' to accommodate clear operational status matching route parameters cleanly
        default: 'none' 
    },                                                     // Tracks if a user is currently waiting for admin to authorize a buy order
    requestedPlanName: { type: String, default: '' },      // The duration handle requested by user (e.g., '15 Days')
    requestedPlanCost: { type: Number, default: 0 },       // Total cost amount to freeze/hold while the request stays pending
    requestedPlanDays: { type: String, default: '' },      // Backwards tracking support for incoming manual selection rows

    // Administrative Security & Restriction Flags
    isFrozen: { type: Boolean, default: false },             // Completely freezes access and prints banner by balance
    isWithdrawRestrained: { type: Boolean, default: false }, // Disables or hides click actions on user withdrawal elements
    isChatBlocked: { type: Boolean, default: false },        // Restricts customer chat capabilities down support rows
    isBlocked: { type: Boolean, default: false },            // Global override block restricting full log-in mechanics

    // Chat Metadata Metrics for Administrative Dashboards Sorting Loop
    isChatPinned: { type: Boolean, default: false },
    isChatArchived: { type: Boolean, default: false },
    lastMessageAt: { type: Date, default: null },
    lastMessageSnippet: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('User', UserSchema);