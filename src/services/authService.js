/**
 * Authentication Service
 * JWT-based authentication with session management and security features
 * 
 * @description Business logic layer for user authentication and session management
 * @author Chat App Team
 * @version 1.0.0
 */

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const moment = require('moment');
const config = require('../config/config');
const logger = require('../utils/logger');
const User = require('../models/userModel');
const { ValidationMiddleware } = require('../utils/validator');

class AuthService {
  constructor() {
    this.jwtOptions = {
      algorithm: config.jwt.algorithm,
      issuer: 'chat-app-backend',
      audience: 'chat-app-frontend'
    };
  }

  /**
   * Register a new user
   * @param {string} phoneNumber - User's phone number
   * @param {string} pin - 4-digit PIN
   * @param {Object} deviceInfo - Device information
   * @returns {Promise<Object>} Registration result
   */
  async register(phoneNumber, pin, deviceInfo = {}) {
    try {
      // Validate inputs
      const phoneValidation = ValidationMiddleware.validatePhoneNumber(phoneNumber);
      if (!phoneValidation.isValid) {
        throw new Error(phoneValidation.error);
      }

      const pinValidation = ValidationMiddleware.validatePin(pin);
      if (!pinValidation.isValid) {
        throw new Error(pinValidation.error);
      }

      // Check if user already exists
      const existingUser = await User.findOne({ 
        phoneNumber: phoneValidation.value,
        isActive: true 
      });

      if (existingUser) {
        logger.logAuth('REGISTRATION_FAILED', phoneNumber, false, {
          reason: 'User already exists',
          deviceInfo
        });
        throw new Error('User with this phone number already exists');
      }

      // Create new user
      const newUser = new User({
        phoneNumber: phoneValidation.value,
        pinHash: pin, // Will be hashed by the pre-save middleware
        sessionData: {
          lastLoginAt: new Date(),
          lastActivityAt: new Date(),
          deviceInfo: {
            userAgent: deviceInfo.userAgent || '',
            ipAddress: deviceInfo.ipAddress || '',
            platform: deviceInfo.platform || 'unknown'
          }
        },
        metadata: {
          totalLogins: 1
        }
      });

      await newUser.save();

      // Generate tokens
      const { accessToken, refreshToken } = this.generateTokens(newUser);

      // Set user online
      await newUser.setOnline(deviceInfo);

      logger.logAuth('REGISTRATION_SUCCESS', phoneNumber, true, {
        userId: newUser._id,
        deviceInfo
      });

      return {
        success: true,
        message: 'User registered successfully',
        user: newUser.toJSON(),
        tokens: {
          accessToken,
          refreshToken
        }
      };

    } catch (error) {
      logger.logAuth('REGISTRATION_ERROR', phoneNumber, false, {
        error: error.message,
        deviceInfo
      });
      throw error;
    }
  }

  /**
   * Authenticate user login
   * @param {string} phoneNumber - User's phone number
   * @param {string} pin - 4-digit PIN
   * @param {Object} deviceInfo - Device information
   * @returns {Promise<Object>} Login result
   */
  async login(phoneNumber, pin, deviceInfo = {}) {
    try {
      // Validate inputs
      const phoneValidation = ValidationMiddleware.validatePhoneNumber(phoneNumber);
      if (!phoneValidation.isValid) {
        throw new Error(phoneValidation.error);
      }

      const pinValidation = ValidationMiddleware.validatePin(pin);
      if (!pinValidation.isValid) {
        throw new Error(pinValidation.error);
      }

      // Find user with security data
      const user = await User.findByPhoneWithSecurity(phoneValidation.value);
      if (!user) {
        logger.logAuth('LOGIN_FAILED', phoneNumber, false, {
          reason: 'User not found',
          deviceInfo
        });
        throw new Error('Invalid phone number or PIN');
      }

      // Check if account is locked
      if (user.isAccountLocked) {
        const unlockTime = moment(user.security.lockedUntil).format('HH:mm:ss');
        logger.logAuth('LOGIN_FAILED', phoneNumber, false, {
          reason: 'Account locked',
          lockedUntil: user.security.lockedUntil,
          deviceInfo
        });
        throw new Error(`Account is locked. Try again after ${unlockTime}`);
      }

      // Verify PIN
      const isPinValid = await user.comparePin(pin);
      if (!isPinValid) {
        // Handle failed attempt
        const isLocked = await user.handleFailedPinAttempt();
        
        const remainingAttempts = Math.max(0, 5 - user.security.pinRetryCount);
        
        logger.logAuth('LOGIN_FAILED', phoneNumber, false, {
          reason: 'Invalid PIN',
          remainingAttempts,
          isLocked,
          deviceInfo
        });

        if (isLocked) {
          throw new Error('Account has been locked due to multiple failed attempts. Try again in 30 minutes.');
        }
        
        throw new Error(`Invalid phone number or PIN. ${remainingAttempts} attempts remaining.`);
      }

      // Reset PIN retry attempts on successful login
      await user.resetPinRetries();

      // Update login metadata
      user.sessionData.lastLoginAt = new Date();
      user.sessionData.lastActivityAt = new Date();
      user.sessionData.deviceInfo = {
        ...user.sessionData.deviceInfo,
        ...deviceInfo
      };
      user.metadata.totalLogins += 1;

      await user.save();

      // Generate tokens
      const { accessToken, refreshToken } = this.generateTokens(user);

      // Set user online
      await user.setOnline(deviceInfo);

      logger.logAuth('LOGIN_SUCCESS', phoneNumber, true, {
        userId: user._id,
        totalLogins: user.metadata.totalLogins,
        deviceInfo
      });

      return {
        success: true,
        message: 'Login successful',
        user: user.toJSON(),
        tokens: {
          accessToken,
          refreshToken
        }
      };

    } catch (error) {
      logger.logAuth('LOGIN_ERROR', phoneNumber, false, {
        error: error.message,
        deviceInfo
      });
      throw error;
    }
  }

  /**
   * Verify PIN for session continuation
   * @param {string} userId - User ID
   * @param {string} pin - 4-digit PIN
   * @param {Object} deviceInfo - Device information
   * @returns {Promise<Object>} Verification result
   */
  async verifyPin(userId, pin, deviceInfo = {}) {
    try {
      // Validate PIN format
      const pinValidation = ValidationMiddleware.validatePin(pin);
      if (!pinValidation.isValid) {
        throw new Error(pinValidation.error);
      }

      // Find user with security data
      const user = await User.findById(userId).select('+pinHash');
      if (!user || !user.isActive) {
        logger.logAuth('PIN_VERIFICATION_FAILED', 'unknown', false, {
          reason: 'User not found',
          userId,
          deviceInfo
        });
        throw new Error('User not found');
      }

      // Check if account is locked
      if (user.isAccountLocked) {
        const unlockTime = moment(user.security.lockedUntil).format('HH:mm:ss');
        logger.logAuth('PIN_VERIFICATION_FAILED', user.phoneNumber, false, {
          reason: 'Account locked',
          userId,
          lockedUntil: user.security.lockedUntil,
          deviceInfo
        });
        throw new Error(`Account is locked. Try again after ${unlockTime}`);
      }

      // Verify PIN
      const isPinValid = await user.comparePin(pin);
      if (!isPinValid) {
        // Handle failed attempt
        const isLocked = await user.handleFailedPinAttempt();
        
        const remainingAttempts = Math.max(0, 5 - user.security.pinRetryCount);
        
        logger.logAuth('PIN_VERIFICATION_FAILED', user.phoneNumber, false, {
          reason: 'Invalid PIN',
          userId,
          remainingAttempts,
          isLocked,
          deviceInfo
        });

        if (isLocked) {
          throw new Error('Account has been locked due to multiple failed attempts. Try again in 30 minutes.');
        }
        
        throw new Error(`Invalid PIN. ${remainingAttempts} attempts remaining.`);
      }

      // Reset PIN retry attempts on successful verification
      await user.resetPinRetries();

      // Update activity
      await user.updateActivity();

      // Generate new tokens
      const { accessToken, refreshToken } = this.generateTokens(user);

      logger.logAuth('PIN_VERIFICATION_SUCCESS', user.phoneNumber, true, {
        userId,
        deviceInfo
      });

      return {
        success: true,
        message: 'PIN verified successfully',
        user: user.toJSON(),
        tokens: {
          accessToken,
          refreshToken
        }
      };

    } catch (error) {
      logger.logAuth('PIN_VERIFICATION_ERROR', 'unknown', false, {
        error: error.message,
        userId,
        deviceInfo
      });
      throw error;
    }
  }

  /**
   * Logout user
   * @param {string} userId - User ID
   * @param {Object} deviceInfo - Device information
   * @returns {Promise<Object>} Logout result
   */
  async logout(userId, deviceInfo = {}) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Invalidate all tokens by incrementing version
      await user.invalidateTokens();

      // Set user offline
      await user.setOffline();

      logger.logAuth('LOGOUT_SUCCESS', user.phoneNumber, true, {
        userId,
        deviceInfo
      });

      return {
        success: true,
        message: 'Logout successful'
      };

    } catch (error) {
      logger.logAuth('LOGOUT_ERROR', 'unknown', false, {
        error: error.message,
        userId,
        deviceInfo
      });
      throw error;
    }
  }

  /**
   * Refresh access token using refresh token
   * @param {string} refreshToken - Refresh token
   * @returns {Promise<Object>} New tokens
   */
  async refreshToken(refreshToken) {
    try {
      if (!refreshToken) {
        throw new Error('Refresh token is required');
      }

      // Verify refresh token
      const decoded = jwt.verify(refreshToken, config.jwt.refreshSecret, {
        ...this.jwtOptions,
        ignoreExpiration: false
      });

      // Find user
      const user = await User.findById(decoded.sub);
      if (!user || !user.isActive) {
        throw new Error('User not found');
      }

      // Check token version
      if (decoded.tokenVersion !== user.sessionData.refreshTokenVersion) {
        logger.logAuth('REFRESH_TOKEN_INVALID', user.phoneNumber, false, {
          reason: 'Token version mismatch',
          userId: user._id,
          providedVersion: decoded.tokenVersion,
          currentVersion: user.sessionData.refreshTokenVersion
        });
        throw new Error('Invalid refresh token');
      }

      // Update activity
      await user.updateActivity();

      // Generate new tokens
      const { accessToken, refreshToken: newRefreshToken } = this.generateTokens(user);

      logger.logAuth('REFRESH_TOKEN_SUCCESS', user.phoneNumber, true, {
        userId: user._id
      });

      return {
        success: true,
        tokens: {
          accessToken,
          refreshToken: newRefreshToken
        }
      };

    } catch (error) {
      logger.logAuth('REFRESH_TOKEN_ERROR', 'unknown', false, {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Verify access token
   * @param {string} token - Access token
   * @returns {Promise<Object>} Decoded token payload
   */
  async verifyAccessToken(token) {
    try {
      if (!token) {
        throw new Error('Token is required');
      }

      // Verify token
      const decoded = jwt.verify(token, config.jwt.secret, {
        ...this.jwtOptions,
        ignoreExpiration: false
      });

      // Find user
      const user = await User.findById(decoded.sub);
      if (!user || !user.isActive) {
        throw new Error('User not found');
      }

      // Check token version
      if (decoded.tokenVersion !== user.sessionData.refreshTokenVersion) {
        throw new Error('Token has been invalidated');
      }

      return {
        user,
        decoded
      };

    } catch (error) {
      logger.debug('Access token verification failed:', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Generate JWT tokens
   * @param {Object} user - User object
   * @returns {Object} Generated tokens
   * @private
   */
  generateTokens(user) {
    const payload = {
      sub: user._id,
      phone: user.phoneNumber,
      tokenVersion: user.sessionData.refreshTokenVersion,
      iat: Math.floor(Date.now() / 1000)
    };

    // Generate access token
    const accessToken = jwt.sign(payload, config.jwt.secret, {
      ...this.jwtOptions,
      expiresIn: config.jwt.expire
    });

    // Generate refresh token
    const refreshToken = jwt.sign(payload, config.jwt.refreshSecret, {
      ...this.jwtOptions,
      expiresIn: config.jwt.refreshExpire
    });

    return {
      accessToken,
      refreshToken
    };
  }

  /**
   * Check if user session is active based on last activity
   * @param {string} userId - User ID
   * @returns {Promise<boolean>} Session status
   */
  async isSessionActive(userId) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        return false;
      }

      const lastActivity = moment(user.sessionData.lastActivityAt);
      const timeoutMinutes = config.session.timeoutMinutes;
      const isActive = moment().diff(lastActivity, 'minutes') < timeoutMinutes;

      return isActive;

    } catch (error) {
      logger.error('Error checking session activity:', error);
      return false;
    }
  }

  /**
   * Get user session information
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Session information
   */
  async getSessionInfo(userId) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      const lastActivity = moment(user.sessionData.lastActivityAt);
      const timeoutMinutes = config.session.timeoutMinutes;
      const minutesSinceActivity = moment().diff(lastActivity, 'minutes');
      const isSessionActive = minutesSinceActivity < timeoutMinutes;

      return {
        userId: user._id,
        phoneNumber: user.phoneNumber,
        status: user.status,
        lastActivity: user.sessionData.lastActivityAt,
        minutesSinceActivity,
        isSessionActive,
        timeoutMinutes,
        deviceInfo: user.sessionData.deviceInfo
      };

    } catch (error) {
      logger.error('Error getting session info:', error);
      throw error;
    }
  }

  /**
   * Cleanup expired sessions
   * @returns {Promise<number>} Number of sessions cleaned up
   */
  async cleanupExpiredSessions() {
    try {
      const cleanedCount = await User.cleanupInactiveSessions(config.session.timeoutMinutes * 2);
      
      logger.info('Expired sessions cleanup completed', {
        cleanedCount,
        timeoutMinutes: config.session.timeoutMinutes * 2
      });

      return cleanedCount;

    } catch (error) {
      logger.error('Error cleaning up expired sessions:', error);
      return 0;
    }
  }
}

// Create singleton instance
const authService = new AuthService();

module.exports = authService;
