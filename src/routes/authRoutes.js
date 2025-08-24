/**
 * Authentication Routes
 * Route definitions for authentication endpoints
 * 
 * @description Route layer for authentication-related HTTP endpoints
 * @author Chat App Team
 * @version 1.0.0
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const { 
  authenticate, 
  validateSession, 
  validateRefreshToken,
  rateLimitByUser 
} = require('../middleware/authMiddleware');
const { ValidationMiddleware, schemas } = require('../utils/validator');
const authController = require('../controllers/authController');

const router = express.Router();

/**
 * Rate limiting for authentication endpoints
 */
const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 requests per windowMs
  message: {
    success: false,
    message: 'Too many authentication attempts, please try again later.',
    error: 'RATE_LIMIT_EXCEEDED'
  },
  standardHeaders: true,
  legacyHeaders: false
});

const strictAuthRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Stricter limit for sensitive operations
  message: {
    success: false,
    message: 'Too many attempts, please try again later.',
    error: 'RATE_LIMIT_EXCEEDED'
  },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * Public authentication routes (no authentication required)
 */

// User registration
router.post('/register',
  authRateLimit,
  ValidationMiddleware.validate(schemas.userRegistration, 'body'),
  authController.register
);

// User login
router.post('/login',
  ValidationMiddleware.validate(schemas.userLogin, 'body'),
  authController.login
);

// Refresh access token
router.post('/refresh',
  authRateLimit,
  validateRefreshToken,
  authController.refreshToken
);

// Validate token (public endpoint for token verification)
router.get('/validate',
  authenticate,
  authController.validateToken
);

/**
 * Protected authentication routes (authentication required)
 */

// Verify PIN for session continuation
router.post('/verify-pin',
  strictAuthRateLimit,
  authenticate,
  ValidationMiddleware.validate(schemas.pinVerification, 'body'),
  authController.verifyPin
);

// Logout user
router.post('/logout',
  authenticate,
  authController.logout
);

// Get current user profile
router.get('/me',
  authenticate,
  validateSession,
  authController.getCurrentUser
);

// Get session status
router.get('/session-status',
  authenticate,
  authController.getSessionStatus
);

// Get authentication statistics (development only)
router.get('/stats',
  authenticate,
  rateLimitByUser(10, 60 * 1000), // 10 requests per minute per user
  authController.getAuthStats
);

/**
 * Health check endpoint
 */
router.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Authentication service is healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

module.exports = router;
