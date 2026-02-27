/**
 * APL Landing Demo - Express Server
 * Lightweight backend for demo AI diagnosis (Gemini Vision)
 */
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const demoRouter = require('./routes/demo');

const app = express();
const PORT = process.env.PORT || 3060;

// Middleware
app.use(cors({
    origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (origin.includes('localhost')) return callback(null, true);
        if (origin.endsWith('.pages.dev')) return callback(null, true);
        callback(new Error('Blocked by CORS policy.'));
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
    credentials: true
}));
app.use(express.json({ limit: '20mb' }));

// Request logging
if (process.env.NODE_ENV === 'development') {
    app.use((req, res, next) => {
        console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
        next();
    });
}

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'apl-landing-demo',
        timestamp: new Date().toISOString()
    });
});

// API routes
app.use('/api/demo', demoRouter);

// 404
app.use((req, res) => {
    res.status(404).json({ success: false, message: 'Resource not found.' });
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Server error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
});

// Start
app.listen(PORT, () => {
    console.log(`Demo server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
