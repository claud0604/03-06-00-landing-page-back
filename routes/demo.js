/**
 * Demo Diagnosis API - Gemini Vision for quick personal color analysis
 * STATUS: INACTIVE - Reserved for future use
 *
 * To activate: set DEMO_ACTIVE=true in .env and configure GEMINI_API_KEY
 */
const express = require('express');
const router = express.Router();

const DEMO_ACTIVE = process.env.DEMO_ACTIVE === 'true';

/**
 * POST /api/demo/diagnose
 * Currently inactive. Will receive base64 image, call Gemini, return diagnosis.
 * Body: { image: "base64string", mimeType: "image/jpeg" }
 */
router.post('/diagnose', (req, res) => {
    if (!DEMO_ACTIVE) {
        return res.status(503).json({
            success: false,
            message: 'Demo diagnosis is not active. This feature is reserved for future use.'
        });
    }
});

/**
 * GET /api/demo/status
 * Check if demo service is available
 */
router.get('/status', (req, res) => {
    res.json({
        success: true,
        active: DEMO_ACTIVE,
        message: DEMO_ACTIVE
            ? 'Demo service is active.'
            : 'Demo service is inactive. Reserved for future use.'
    });
});

module.exports = router;
