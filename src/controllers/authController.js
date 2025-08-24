/**
 * Authentication Controller
 * HTTP request handlers for authentication endpoints
 * 
 * @description Presentation layer handling authentication-related HTTP requests
 * @author Chat App Team
 * @version 1.0.0
 */

const authService = require('../services/authService');
const sessionService = require('../services/sessionService');
const logger = require('../utils/logger');
const { asyncHandler, createError } = require('../middleware/errorHandler');
const config = require('../config/config');

/**
 * Extract device information from request
 * @param {Object} req - Express request object
 * @returns {Object} Device information
 */
const extractDeviceInfo = (req) => ({
  userAgent: req.get('User-Agent') || '',
  ipAddress: req.ip || req.connection.remoteAddress || '',
  platform: req.get('Platform') || req.body.platform || 'web'
});

/**
 * Set secure cookies for tokens
 * @param {Object} res - Express response object
 * @param {Object} tokens - Access and refresh tokens
 */
const setTokenCookies = (res, tokens) => {
  // Set access token cookie (shorter expiry)
  res.cookie('accessToken', tokens.accessToken, {
    httpOnly: true,
    secure: config.cookies.secure,
    sameSite: config.cookies.sameSite,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    domain: config.cookies.domain
  });

  // Set refresh token cookie (longer expiry)
  res.cookie('refreshToken', tokens.refreshToken, {
    httpOnly: true,
    secure: config.cookies.secure,
    sameSite: config.cookies.sameSite,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    domain: config.cookies.domain
  });
};

/**
 * Clear authentication cookies
 * @param {Object} res - Express response object
 */
const clearTokenCookies = (res) => {
  res.clearCookie('accessToken', {
    httpOnly: true,
    secure: config.cookies.secure,
    sameSite: config.cookies.sameSite,
    domain: config.cookies.domain
  });

  res.clearCookie('refreshToken', {
    httpOnly: true,
    secure: config.cookies.secure,
    sameSite: config.cookies.sameSite,
    domain: config.cookies.domain
  });
};

/**
 * Register a new user
 * POST /api/auth/register
 */
const register = asyncHandler(async (req, res) => {
  const { phoneNumber, pin } = req.body;
  const deviceInfo = extractDeviceInfo(req);

  // Validate required fields
  if (!phoneNumber || !pin) {
    throw createError.badRequest('Phone number and PIN are required');
  }

  try {
    const result = await authService.register(phoneNumber, pin, deviceInfo);

    // Set secure cookies
    setTokenCookies(res, result.tokens);

    // Remove tokens from response body for security
    const response = {
      ...result,
      tokens: {
        accessToken: '***', // Hide in response
        refreshToken: '***'
      }
    };

    logger.info('User registration successful', {
      userId: result.user.id,
      phoneNumber: result.user.phoneNumber,
      ip: deviceInfo.ipAddress,
      platform: deviceInfo.platform
    });

    res.status(201).json({
      success: true,
      message: 'Registration successful',
      data: response,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Registration failed:', error, {
      phoneNumber,
      ip: deviceInfo.ipAddress,
      platform: deviceInfo.platform
    });
    throw error;
  }
});

/**
 * Login user
 * POST /api/auth/login
 */
const login = asyncHandler(async (req, res) => {
  const { phoneNumber, pin } = req.body;
  const deviceInfo = extractDeviceInfo(req);

  // Validate required fields
  if (!phoneNumber || !pin) {
    throw createError.badRequest('Phone number and PIN are required');
  }

  try {
    const result = await authService.login(phoneNumber, pin, deviceInfo);

    // Set secure cookies
    setTokenCookies(res, result.tokens);

    // Remove tokens from response body for security
    const response = {
      ...result,
      tokens: {
        accessToken: '***',
        refreshToken: '***'
      }
    };

    logger.info('User login successful', {
      userId: result.user.id,
      phoneNumber: result.user.phoneNumber,
      totalLogins: result.user.metadata.totalLogins,
      ip: deviceInfo.ipAddress,
      platform: deviceInfo.platform
    });

    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: response,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Login failed:', error, {
      phoneNumber,
      ip: deviceInfo.ipAddress,
      platform: deviceInfo.platform
    });
    throw error;
  }
});

/**
 * Verify PIN for session continuation
 * POST /api/auth/verify-pin
 */
const verifyPin = asyncHandler(async (req, res) => {
  const { pin } = req.body;
  const userId = req.user._id.toString();
  const deviceInfo = extractDeviceInfo(req);

  // Validate required fields
  if (!pin) {
    throw createError.badRequest('PIN is required');
  }

  try {
    const result = await authService.verifyPin(userId, pin, deviceInfo);

    // Set new secure cookies
    setTokenCookies(res, result.tokens);

    // Reactivate session
    await sessionService.reactivateSession(userId, deviceInfo);

    // Remove tokens from response body for security
    const response = {
      ...result,
      tokens: {
        accessToken: '***',
        refreshToken: '***'
      }
    };

    logger.info('PIN verification successful', {
      userId,
      phoneNumber: result.user.phoneNumber,
      ip: deviceInfo.ipAddress,
      platform: deviceInfo.platform
    });

    res.status(200).json({
      success: true,
      message: 'PIN verified successfully',
      data: response,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('PIN verification failed:', error, {
      userId,
      ip: deviceInfo.ipAddress,
      platform: deviceInfo.platform
    });
    throw error;
  }
});

/**
 * Refresh access token
 * POST /api/auth/refresh
 */
const refreshToken = asyncHandler(async (req, res) => {
  try {
    const refreshToken = req.body.refreshToken || req.cookies.refreshToken;

    if (!refreshToken) {
      throw createError.unauthorized('Refresh token is required');
    }

    const result = await authService.refreshToken(refreshToken);

    // Set new secure cookies
    setTokenCookies(res, result.tokens);

    logger.info('Token refresh successful', {
      userId: req.user?._id || 'unknown'
    });

    res.status(200).json({
      success: true,
      message: 'Token refreshed successfully',
      data: {
        tokens: {
          accessToken: '***',
          refreshToken: '***'
        }
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Token refresh failed:', error, {
      ip: req.ip
    });
    
    // Clear invalid cookies
    clearTokenCookies(res);
    throw error;
  }
});

/**
 * Logout user
 * POST /api/auth/logout
 */
const logout = asyncHandler(async (req, res) => {
  const userId = req.user._id.toString();
  const deviceInfo = extractDeviceInfo(req);

  try {
    await authService.logout(userId, deviceInfo);
    await sessionService.endSession(userId, 'logout');

    // Clear authentication cookies
    clearTokenCookies(res);

    logger.info('User logout successful', {
      userId,
      phoneNumber: req.user.phoneNumber,
      ip: deviceInfo.ipAddress,
      platform: deviceInfo.platform
    });

    res.status(200).json({
      success: true,
      message: 'Logout successful',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Logout failed:', error, {
      userId,
      ip: deviceInfo.ipAddress
    });
    
    // Clear cookies even if logout fails
    clearTokenCookies(res);
    throw error;
  }
});

/**
 * Get current user profile
 * GET /api/auth/me
 */
const getCurrentUser = asyncHandler(async (req, res) => {
  const user = req.user;
  const userId = user._id.toString();

  try {
    // Get session information
    const sessionStatus = await sessionService.checkSessionStatus(userId);

    logger.debug('User profile retrieved', {
      userId,
      phoneNumber: user.phoneNumber,
      status: user.status
    });

    res.status(200).json({
      success: true,
      message: 'User profile retrieved successfully',
      data: {
        user: user.toJSON(),
        session: {
          isActive: sessionStatus.isActive,
          lastActivity: sessionStatus.lastActivity,
          minutesInactive: sessionStatus.minutesInactive,
          showWarning: sessionStatus.showWarning
        }
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Error retrieving user profile:', error, { userId });
    throw error;
  }
});

/**
 * Check session status
 * GET /api/auth/session-status
 */
const getSessionStatus = asyncHandler(async (req, res) => {
  const userId = req.user._id.toString();

  try {
    const sessionStatus = await sessionService.checkSessionStatus(userId);

    res.status(200).json({
      success: true,
      message: 'Session status retrieved successfully',
      data: sessionStatus,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Error checking session status:', error, { userId });
    throw error;
  }
});

/**
 * Validate current token
 * GET /api/auth/validate
 */
const validateToken = asyncHandler(async (req, res) => {
  const user = req.user;
  const tokenInfo = req.decodedToken;

  try {
    res.status(200).json({
      success: true,
      message: 'Token is valid',
      data: {
        userId: user._id,
        phoneNumber: user.phoneNumber,
        status: user.status,
        tokenInfo: {
          iat: tokenInfo.iat,
          exp: tokenInfo.exp,
          iss: tokenInfo.iss,
          aud: tokenInfo.aud
        }
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Error validating token:', error);
    throw error;
  }
});

/**
 * Get authentication statistics (admin/debug endpoint)
 * GET /api/auth/stats
 */
const getAuthStats = asyncHandler(async (req, res) => {
  try {
    // Only allow in development or for admin users
    if (!config.isDevelopment) {
      throw createError.forbidden('Access denied');
    }

    const sessionStats = sessionService.getSessionStatistics();

    res.status(200).json({
      success: true,
      message: 'Authentication statistics retrieved',
      data: sessionStats,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Error retrieving auth stats:', error);
    throw error;
  }
});

module.exports = {
  register,
  login,
  verifyPin,
  refreshToken,
  logout,
  getCurrentUser,
  getSessionStatus,
  validateToken,
  getAuthStats
};
