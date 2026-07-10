const express = require('express');
const router = express.Router();
const Admin = require('../models/Admin'); 

// 🔓 Secure Middleware matching your exact system architecture baseline
function requireAdminAuth(req, res, next) {
    if (req.session && req.session.admin) {
        return next();
    }
    return res.status(401).json({ success: false, msg: 'Unauthorized access node.' });
}

/**
 * @route   GET /admin/get-whatsapp-route
 * @desc    Fetch the active WhatsApp baseline support number for the logged-in admin
 */
router.get('/get-whatsapp-route', requireAdminAuth, async (req, res) => {
    try {
        // Query utilizing the precise structural nested identity object key
        const adminNode = await Admin.findById(req.session.admin._id);
        if (!adminNode) {
            return res.status(404).json({ success: false, msg: 'Admin profile node not found.' });
        }
        
        return res.json({ 
            success: true, 
            whatsappNumber: adminNode.whatsappNumber || '' 
        });
    } catch (error) {
        console.error('Error fetching WhatsApp route:', error);
        return res.status(500).json({ success: false, msg: 'Internal systems channel error.' });
    }
});

/**
 * @route   POST /admin/update-whatsapp-route
 * @desc    Update or delete the WhatsApp number baseline for the logged-in admin
 */
router.post('/update-whatsapp-route', requireAdminAuth, async (req, res) => {
    try {
        const { whatsappNumber } = req.body;
        
        // Clean the input string (strip anything that isn't a digit)
        const sanitizedNumber = whatsappNumber ? whatsappNumber.trim().replace(/\D/g, '') : '';

        const updatedAdmin = await Admin.findByIdAndUpdate(
            req.session.admin._id,
            { whatsappNumber: sanitizedNumber },
            { new: true }
        );

        if (!updatedAdmin) {
            return res.status(404).json({ success: false, msg: 'Failed to find targeted admin node.' });
        }

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