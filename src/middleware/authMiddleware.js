/**
 * Authentication Middleware
 * JWT token verification, session validation, and security checks
 * 
 * @description Middleware for protecting routes and validating user authentication
 * @author Chat App Team
 * @version 1.0.0
 */

const jwt = require('jsonwebtoken');
const config = require('../config/config');
const logger = require('../utils/logger');
const authService = require('../services/authService');
const sessionService = require('../services/sessionService');
const User = require('../models/userModel');

/**
 * Extract token from request headers or cookies
 * @param {Object} req - Express request object
 * @returns {string|null} JWT token
 */
const extractToken = (req) => {
  // Check Authorization header (Bearer token)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }

  // Check cookies (for HttpOnly cookie implementation)
  if (req.cookies && req.cookies.accessToken) {
    return req.cookies.accessToken;
  }

  // Check custom header
  if (req.headers['x-access-token']) {
    return req.headers['x-access-token'];
  }

  return null;
};

/**
 * Main authentication middleware
 * Verifies JWT token and sets user data in request
 */
const authenticate = async (req, res, next) => {
  try {
    const token = extractToken(req);

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access token is required',
        error: 'MISSING_TOKEN',
        timestamp: new Date().toISOString()
      });
    }

    // Verify access token
    const { user, decoded } = await authService.verifyAccessToken(token);

    // Check if user account is active
    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Account has been deactivated',
        error: 'ACCOUNT_INACTIVE',
        timestamp: new Date().toISOString()
      });
    }

    // Check if account is locked
    if (user.isAccountLocked) {
      return res.status(423).json({
        success: false,
        message: 'Account is temporarily locked',
        error: 'ACCOUNT_LOCKED',
        timestamp: new Date().toISOString()
      });
    }

    // Track user activity for session management
    await sessionService.trackActivity(user._id.toString(), {
      userAgent: req.get('User-Agent'),
      ipAddress: req.ip || req.connection.remoteAddress,
      platform: req.get('Platform') || 'web'
    });

    // Set user data in request
    req.user = user;
    req.token = token;
    req.decodedToken = decoded;

    // Log successful authentication
    logger.debug('User authenticated successfully', {
      userId: user._id,
      phoneNumber: user.phoneNumber,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    next();

  } catch (error) {
    logger.warn('Authentication failed:', {
      error: error.message,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      path: req.path
    });

    // Handle specific JWT errors
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Access token has expired',
        error: 'TOKEN_EXPIRED',
        timestamp: new Date().toISOString()
      });
    }

    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid access token',
        error: 'INVALID_TOKEN',
        timestamp: new Date().toISOString()
      });
    }

    // Generic authentication error
    return res.status(401).json({
      success: false,
      message: 'Authentication failed',
      error: 'AUTH_FAILED',
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * Optional authentication middleware
 * Sets user data if valid token is provided, but doesn't require it
 */
const optionalAuth = async (req, res, next) => {
  try {
    const token = extractToken(req);

    if (token) {
      try {
        const { user, decoded } = await authService.verifyAccessToken(token);
        
        if (user.isActive && !user.isAccountLocked) {
          req.user = user;
          req.token = token;
          req.decodedToken = decoded;

          // Track activity
          await sessionService.trackActivity(user._id.toString(), {
            userAgent: req.get('User-Agent'),
            ipAddress: req.ip || req.connection.remoteAddress,
            platform: req.get('Platform') || 'web'
          });
        }
      } catch (error) {
        // Ignore token errors for optional auth
        logger.debug('Optional auth token validation failed:', error.message);
      }
    }

    next();

  } catch (error) {
    // Continue without authentication for optional routes
    next();
  }
};

/**
 * Session validation middleware
 * Checks if user session is still active based on activity timeout
 */
const validateSession = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
        error: 'NOT_AUTHENTICATED',
        timestamp: new Date().toISOString()
      });
    }

    const sessionStatus = await sessionService.checkSessionStatus(req.user._id.toString());

    if (!sessionStatus.isActive) {
      // Session has timed out
      await sessionService.handleSessionTimeout(req.user._id.toString());

      return res.status(401).json({
        success: false,
        message: 'Session has expired due to inactivity',
        error: 'SESSION_TIMEOUT',
        requiresPinEntry: true,
        data: {
          minutesInactive: sessionStatus.minutesInactive,
          timeoutMinutes: config.session.timeoutMinutes
        },
        timestamp: new Date().toISOString()
      });
    }

    // Add session warning if needed
    if (sessionStatus.showWarning) {
      res.setHeader('X-Session-Warning', 'true');
      res.setHeader('X-Minutes-Until-Timeout', sessionStatus.minutesUntilTimeout);
    }

    next();

  } catch (error) {
    logger.error('Session validation error:', error, {
      userId: req.user?._id,
      path: req.path
    });

    return res.status(500).json({
      success: false,
      message: 'Session validation failed',
      error: 'SESSION_VALIDATION_ERROR',
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * Refresh token validation middleware
 * Specifically for refresh token endpoints
 */
const validateRefreshToken = async (req, res, next) => {
  try {
    const refreshToken = req.body.refreshToken || req.cookies.refreshToken;

    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        message: 'Refresh token is required',
        error: 'MISSING_REFRESH_TOKEN',
        timestamp: new Date().toISOString()
      });
    }

    // Verify refresh token
    const decoded = jwt.verify(refreshToken, config.jwt.refreshSecret, {
      algorithm: config.jwt.algorithm,
      issuer: 'chat-app-backend',
      audience: 'chat-app-frontend'
    });

    // Find user
    const user = await User.findById(decoded.sub);
    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Invalid refresh token',
        error: 'INVALID_REFRESH_TOKEN',
        timestamp: new Date().toISOString()
      });
    }

    // Check token version
    if (decoded.tokenVersion !== user.sessionData.refreshTokenVersion) {
      return res.status(401).json({
        success: false,
        message: 'Refresh token has been invalidated',
        error: 'TOKEN_INVALIDATED',
        timestamp: new Date().toISOString()
      });
    }

    req.user = user;
    req.refreshToken = refreshToken;
    req.decodedRefreshToken = decoded;

    next();

  } catch (error) {
    logger.warn('Refresh token validation failed:', {
      error: error.message,
      ip: req.ip
    });

    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Refresh token has expired',
        error: 'REFRESH_TOKEN_EXPIRED',
        timestamp: new Date().toISOString()
      });
    }

    return res.status(401).json({
      success: false,
      message: 'Invalid refresh token',
      error: 'INVALID_REFRESH_TOKEN',
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * Role-based authorization middleware
 * @param {Array} roles - Required roles
 * @returns {Function} Express middleware
 */
const authorize = (roles = []) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
        error: 'NOT_AUTHENTICATED',
        timestamp: new Date().toISOString()
      });
    }

    // For now, all authenticated users have the same role
    // This can be extended when role-based access is needed
    const userRole = 'user';

    if (roles.length > 0 && !roles.includes(userRole)) {
      return res.status(403).json({
        success: false,
        message: 'Insufficient permissions',
        error: 'FORBIDDEN',
        timestamp: new Date().toISOString()
      });
    }

    next();
  };
};

/**
 * Rate limiting by user
 * @param {number} maxRequests - Maximum requests per window
 * @param {number} windowMs - Time window in milliseconds
 * @returns {Function} Express middleware
 */
const rateLimitByUser = (maxRequests = 100, windowMs = 15 * 60 * 1000) => {
  const userRequestCounts = new Map();

  return (req, res, next) => {
    const userId = req.user?._id?.toString() || req.ip;
    const now = Date.now();
    
    if (!userRequestCounts.has(userId)) {
      userRequestCounts.set(userId, { count: 0, resetTime: now + windowMs });
    }

    const userLimits = userRequestCounts.get(userId);

    // Reset count if window has expired
    if (now > userLimits.resetTime) {
      userLimits.count = 0;
      userLimits.resetTime = now + windowMs;
    }

    // Check if limit exceeded
    if (userLimits.count >= maxRequests) {
      const resetIn = Math.ceil((userLimits.resetTime - now) / 1000);
      
      logger.warn('Rate limit exceeded', {
        userId,
        ip: req.ip,
        path: req.path,
        count: userLimits.count,
        maxRequests
      });

      return res.status(429).json({
        success: false,
        message: 'Too many requests',
        error: 'RATE_LIMIT_EXCEEDED',
        retryAfter: resetIn,
        timestamp: new Date().toISOString()
      });
    }

    // Increment count
    userLimits.count++;

    // Set headers
    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - userLimits.count));
    res.setHeader('X-RateLimit-Reset', new Date(userLimits.resetTime).toISOString());

    next();
  };
};

/**
 * Middleware to ensure user owns the resource
 * @param {string} paramName - Name of the parameter containing the user ID
 * @returns {Function} Express middleware
 */
const ensureOwnership = (paramName = 'userId') => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
        error: 'NOT_AUTHENTICATED',
        timestamp: new Date().toISOString()
      });
    }

    const resourceUserId = req.params[paramName] || req.body[paramName];
    const currentUserId = req.user._id.toString();

    if (resourceUserId !== currentUserId) {
      logger.warn('Unauthorized resource access attempt', {
        currentUserId,
        resourceUserId,
        ip: req.ip,
        path: req.path
      });

      return res.status(403).json({
        success: false,
        message: 'Access denied: You can only access your own resources',
        error: 'OWNERSHIP_REQUIRED',
        timestamp: new Date().toISOString()
      });
    }

    next();
  };
};

module.exports = {
  authenticate,
  optionalAuth,
  validateSession,
  validateRefreshToken,
  authorize,
  rateLimitByUser,
  ensureOwnership,
  extractToken
};
