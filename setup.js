require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('./config/db');
const Admin = require('./models/Admin');
const User = require('./models/User');
const bcrypt = require('bcryptjs');

const seedDatabase = async () => {
    try {
        // 1. Connect to MongoDB using your config module
        await connectDB();
        console.log("DB Connected successfully for seeding...");

        // 2. Clear out old test data to prevent duplicates
        await Admin.deleteMany({ promoCode: 'DBLSHAH2026' });
        await User.deleteMany({ 
            $or: [
                { email: 'testuser@example.com' },
                { role: 'superadmin' } // Clears existing setup superadmin if rerun
            ] 
        });

        // 3. Create a master Admin tenant profile
        const sampleAdmin = new Admin({
            username: 'admin_root',
            email: 'admin@dblshah.com',
            password: 'adminpassword123', // Plaintext legacy support
            promoCode: 'DBLSHAH2026'
        });
        await sampleAdmin.save();
        console.log("✅ Admin Promo Code 'DBLSHAH2026' created successfully.");

        // 4. Create a pre-made Test User bound to that admin
        const sampleUser = new User({
            username: 'testuser',
            email: 'testuser@example.com',
            phone: '1234567890',
            password: 'password123', 
            country: 'United States',
            gender: 'Male',
            assignedAdminCode: 'DBLSHAH2026',
            isFrozen: false,
            role: 'user'
        });
        await sampleUser.save();
        console.log("✅ Ready-to-use Test User account created successfully.");

        // 5. Create a brand new Superadmin profile inside the unified collection
        const superHashedPassword = await bcrypt.hash('superpass2026', 10);
        const sampleSuper = new User({
            username: 'rootsuper',
            email: 'superadmin@main.com',
            password: superHashedPassword, // Securely hashed
            phone: '0000000000',
            country: 'Global',
            gender: 'N/A',
            role: 'superadmin',
            assignedAdminCode: '' // Superadmins transcend workspace codes
        });
        await sampleSuper.save();
        
        console.log("=========================================");
        console.log(" 👑 SUPERADMIN INJECTED INTO NETWORK! ");
        console.log(" Email: superadmin@main.com");
        console.log(" Password: superpass2026");
        console.log("=========================================");

        console.log("\nSetup complete! You can close this script safely.");
        process.exit(0);
    } catch (err) {
        console.error("❌ Setup failed:", err);
        process.exit(1);
    }
};

seedDatabase();