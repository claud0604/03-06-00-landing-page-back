const mongoose = require('mongoose');

const colorSchema = {
    rgb: { r: Number, g: Number, b: Number },
    hsl: { h: Number, s: Number, l: Number },
    lab: { l: Number, a: Number, b: Number }
};

const demoDataSchema = new mongoose.Schema({
    sessionId: { type: String, unique: true, index: true },
    timestamp: { type: Date, default: Date.now },

    // Client info
    age: Number,
    gender: String,
    timezone: String,
    region: String,
    lang: String,

    // Extracted color data
    colors: {
        skin: colorSchema,
        hair: colorSchema,
        eyebrow: colorSchema,
        eye: colorSchema,
        lip: colorSchema,
        neck: colorSchema,
        background: { rgb: { r: Number, g: Number, b: Number } }
    },

    // Proportions
    faceProportions: {
        foreheadRatio: Number,
        jawRatio: Number,
        heightRatio: Number
    },
    bodyProportions: {
        shoulderHipRatio: Number,
        shoulderWidth: Number,
        hipWidth: Number,
        torsoLength: Number
    },

    // Contrast
    contrast: {
        skinHair: Number,
        skinEye: Number,
        skinLip: Number,
        skinNeck: Number
    },

    // AI diagnosis result
    diagnosis: {
        personalColor: String,
        seasonGroup: String,
        personalColorDetail: String,
        faceShape: String,
        faceShapeDetail: String,
        bodyType: String,
        bodyTypeDetail: String,
        bestColors: [String],
        avoidColors: [String],
        stylingTip: String
    },

    segmentationUsed: Boolean
}, {
    timestamps: true,
    collection: '00_landing-demo-data'
});

demoDataSchema.index({ timestamp: -1 });
demoDataSchema.index({ 'diagnosis.personalColor': 1 });

module.exports = mongoose.model('DemoData', demoDataSchema);
