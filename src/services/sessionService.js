/**
 * Session Service
 * Session management, inactivity tracking, and timeout handling
 * 
 * @description Service layer for managing user sessions and activity monitoring
 * @author Chat App Team
 * @version 1.0.0
 */

const moment = require('moment');
const config = require('../config/config');
const logger = require('../utils/logger');
const User = require('../models/userModel');
const authService = require('./authService');

class SessionService {
  constructor() {
    this.activeSessions = new Map(); // In-memory session tracking
    this.inactivityTimeoutMs = config.session.timeoutMinutes * 60 * 1000; // 5 minutes in ms
    this.cleanupIntervalMs = 2 * 60 * 1000; // 2 minutes cleanup interval
    this.sessionTimeoutWarningMs = (config.session.timeoutMinutes - 1) * 60 * 1000; // 4 minutes warning
    
    // Start cleanup timer
    this.startCleanupTimer();
  }

  /**
   * Track user session activity
   * @param {string} userId - User ID
   * @param {Object} activityData - Activity information
   * @returns {Promise<void>}
   */
  async trackActivity(userId, activityData = {}) {
    try {
      if (!userId) {
        throw new Error('User ID is required');
      }

      const now = new Date();
      const sessionData = {
        userId,
        lastActivity: now,
        userAgent: activityData.userAgent || '',
        ipAddress: activityData.ipAddress || '',
        platform: activityData.platform || 'unknown',
        socketId: activityData.socketId || null,
        isActive: true
      };

      // Update in-memory session
      this.activeSessions.set(userId, sessionData);

      // Update database
      const user = await User.findById(userId);
      if (user && user.isActive) {
        await user.updateActivity();
        
        logger.debug('User activity tracked', {
          userId,
          lastActivity: now,
          platform: sessionData.platform
        });
      }

    } catch (error) {
      logger.error('Error tracking user activity:', error, { userId });
    }
  }

  /**
   * Check if user session is active
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Session status
   */
  async checkSessionStatus(userId) {
    try {
      if (!userId) {
        throw new Error('User ID is required');
      }

      const sessionData = this.activeSessions.get(userId);
      const now = new Date();

      // If no in-memory session, check database
      if (!sessionData) {
        const user = await User.findById(userId);
        if (!user || !user.isActive) {
          return {
            isActive: false,
            requiresPinEntry: true,
            reason: 'User not found'
          };
        }

        const lastActivity = moment(user.sessionData.lastActivityAt);
        const minutesInactive = moment().diff(lastActivity, 'minutes');
        const isActive = minutesInactive < config.session.timeoutMinutes;

        return {
          isActive,
          requiresPinEntry: !isActive,
          minutesInactive,
          lastActivity: user.sessionData.lastActivityAt,
          reason: isActive ? 'Active' : 'Session timeout'
        };
      }

      // Check in-memory session
      const lastActivity = moment(sessionData.lastActivity);
      const minutesInactive = moment().diff(lastActivity, 'minutes');
      const isActive = minutesInactive < config.session.timeoutMinutes;

      // Check if warning should be shown (1 minute before timeout)
      const warningThresholdMinutes = config.session.timeoutMinutes - 1;
      const showWarning = minutesInactive >= warningThresholdMinutes && isActive;

      return {
        isActive,
        requiresPinEntry: !isActive,
        showWarning,
        minutesInactive,
        minutesUntilTimeout: Math.max(0, config.session.timeoutMinutes - minutesInactive),
        lastActivity: sessionData.lastActivity,
        reason: isActive ? 'Active' : 'Session timeout'
      };

    } catch (error) {
      logger.error('Error checking session status:', error, { userId });
      return {
        isActive: false,
        requiresPinEntry: true,
        reason: 'Error checking session'
      };
    }
  }

  /**
   * Handle session timeout for user
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Timeout result
   */
  async handleSessionTimeout(userId) {
    try {
      if (!userId) {
        throw new Error('User ID is required');
      }

      // Remove from active sessions
      this.activeSessions.delete(userId);

      // Update user status in database
      const user = await User.findById(userId);
      if (user && user.isActive) {
        user.status = 'away'; // Set to away instead of offline for timeout
        user.lastSeen = new Date();
        await user.save();

        logger.info('User session timed out', {
          userId,
          phoneNumber: user.phoneNumber,
          lastActivity: user.sessionData.lastActivityAt
        });
      }

      return {
        success: true,
        message: 'Session timed out',
        requiresPinEntry: true
      };

    } catch (error) {
      logger.error('Error handling session timeout:', error, { userId });
      throw error;
    }
  }

  /**
   * Reactivate user session after PIN verification
   * @param {string} userId - User ID
   * @param {Object} deviceInfo - Device information
   * @returns {Promise<Object>} Reactivation result
   */
  async reactivateSession(userId, deviceInfo = {}) {
    try {
      if (!userId) {
        throw new Error('User ID is required');
      }

      const user = await User.findById(userId);
      if (!user || !user.isActive) {
        throw new Error('User not found');
      }

      // Update session data
      await this.trackActivity(userId, deviceInfo);

      // Set user back online
      await user.setOnline(deviceInfo);

      logger.info('User session reactivated', {
        userId,
        phoneNumber: user.phoneNumber,
        deviceInfo
      });

      return {
        success: true,
        message: 'Session reactivated successfully',
        user: user.toJSON()
      };

    } catch (error) {
      logger.error('Error reactivating session:', error, { userId });
      throw error;
    }
  }

  /**
   * End user session (logout)
   * @param {string} userId - User ID
   * @param {string} reason - Reason for ending session
   * @returns {Promise<Object>} Session end result
   */
  async endSession(userId, reason = 'logout') {
    try {
      if (!userId) {
        throw new Error('User ID is required');
      }

      // Remove from active sessions
      this.activeSessions.delete(userId);

      // Update user status
      const user = await User.findById(userId);
      if (user && user.isActive) {
        await user.setOffline();
        
        logger.info('User session ended', {
          userId,
          phoneNumber: user.phoneNumber,
          reason
        });
      }

      return {
        success: true,
        message: 'Session ended successfully'
      };

    } catch (error) {
      logger.error('Error ending session:', error, { userId, reason });
      throw error;
    }
  }

  /**
   * Get all active sessions
   * @returns {Array} List of active sessions
   */
  getActiveSessions() {
    const sessions = [];
    const now = new Date();

    for (const [userId, sessionData] of this.activeSessions.entries()) {
      const minutesInactive = moment().diff(moment(sessionData.lastActivity), 'minutes');
      const isActive = minutesInactive < config.session.timeoutMinutes;

      if (isActive) {
        sessions.push({
          userId,
          lastActivity: sessionData.lastActivity,
          minutesInactive,
          platform: sessionData.platform,
          socketId: sessionData.socketId
        });
      }
    }

    return sessions;
  }

  /**
   * Get session statistics
   * @returns {Object} Session statistics
   */
  getSessionStatistics() {
    const activeSessions = this.getActiveSessions();
    const totalSessions = this.activeSessions.size;
    const now = moment();

    // Calculate session distribution by platform
    const platformStats = {};
    const activityStats = {
      veryActive: 0, // < 5 minutes
      active: 0,     // 5-15 minutes
      idle: 0        // > 15 minutes
    };

    activeSessions.forEach(session => {
      // Platform stats
      platformStats[session.platform] = (platformStats[session.platform] || 0) + 1;

      // Activity stats
      if (session.minutesInactive < 5) {
        activityStats.veryActive++;
      } else if (session.minutesInactive < 15) {
        activityStats.active++;
      } else {
        activityStats.idle++;
      }
    });

    return {
      totalActiveSessions: activeSessions.length,
      totalTrackedSessions: totalSessions,
      sessionTimeout: config.session.timeoutMinutes,
      platformDistribution: platformStats,
      activityDistribution: activityStats,
      timestamp: now.toISOString()
    };
  }

  /**
   * Update socket ID for user session
   * @param {string} userId - User ID
   * @param {string} socketId - Socket ID
   * @returns {void}
   */
  updateSocketId(userId, socketId) {
    const sessionData = this.activeSessions.get(userId);
    if (sessionData) {
      sessionData.socketId = socketId;
      this.activeSessions.set(userId, sessionData);
    }
  }

  /**
   * Remove socket ID for user session
   * @param {string} userId - User ID
   * @returns {void}
   */
  removeSocketId(userId) {
    const sessionData = this.activeSessions.get(userId);
    if (sessionData) {
      sessionData.socketId = null;
      this.activeSessions.set(userId, sessionData);
    }
  }

  /**
   * Get users who need session timeout warning
   * @returns {Array} List of users needing warning
   */
  getUsersNeedingTimeoutWarning() {
    const warningUsers = [];
    const warningThresholdMinutes = config.session.timeoutMinutes - 1;

    for (const [userId, sessionData] of this.activeSessions.entries()) {
      const minutesInactive = moment().diff(moment(sessionData.lastActivity), 'minutes');
      
      if (minutesInactive >= warningThresholdMinutes && 
          minutesInactive < config.session.timeoutMinutes) {
        warningUsers.push({
          userId,
          socketId: sessionData.socketId,
          minutesInactive,
          minutesUntilTimeout: config.session.timeoutMinutes - minutesInactive
        });
      }
    }

    return warningUsers;
  }

  /**
   * Get users whose sessions have timed out
   * @returns {Array} List of timed out users
   */
  getTimedOutUsers() {
    const timedOutUsers = [];

    for (const [userId, sessionData] of this.activeSessions.entries()) {
      const minutesInactive = moment().diff(moment(sessionData.lastActivity), 'minutes');
      
      if (minutesInactive >= config.session.timeoutMinutes) {
        timedOutUsers.push({
          userId,
          socketId: sessionData.socketId,
          minutesInactive
        });
      }
    }

    return timedOutUsers;
  }

  /**
   * Start cleanup timer for inactive sessions
   * @private
   */
  startCleanupTimer() {
    setInterval(() => {
      this.cleanupInactiveSessions();
    }, this.cleanupIntervalMs);

    logger.info('Session cleanup timer started', {
      intervalMs: this.cleanupIntervalMs,
      timeoutMinutes: config.session.timeoutMinutes
    });
  }

  /**
   * Cleanup inactive sessions
   * @private
   */
  async cleanupInactiveSessions() {
    try {
      const now = moment();
      const sessionsToRemove = [];

      // Find sessions that have been inactive for more than timeout + 5 minutes
      const extendedTimeoutMinutes = config.session.timeoutMinutes + 5;

      for (const [userId, sessionData] of this.activeSessions.entries()) {
        const minutesInactive = now.diff(moment(sessionData.lastActivity), 'minutes');
        
        if (minutesInactive > extendedTimeoutMinutes) {
          sessionsToRemove.push(userId);
        }
      }

      // Remove inactive sessions
      for (const userId of sessionsToRemove) {
        this.activeSessions.delete(userId);
        
        // Also update user status in database
        try {
          const user = await User.findById(userId);
          if (user && user.status !== 'offline') {
            await user.setOffline();
          }
        } catch (error) {
          logger.warn('Error updating offline status during cleanup:', error, { userId });
        }
      }

      if (sessionsToRemove.length > 0) {
        logger.info('Inactive sessions cleaned up', {
          cleanedCount: sessionsToRemove.length,
          remainingActiveSessions: this.activeSessions.size
        });
      }

      // Also run database cleanup for users marked as online but actually inactive
      await User.cleanupInactiveSessions(config.session.timeoutMinutes);

    } catch (error) {
      logger.error('Error during session cleanup:', error);
    }
  }

  /**
   * Force cleanup all sessions (for shutdown)
   * @returns {Promise<void>}
   */
  async forceCleanupAllSessions() {
    try {
      const userIds = Array.from(this.activeSessions.keys());
      
      // Clear in-memory sessions
      this.activeSessions.clear();

      // Update all users to offline status
      if (userIds.length > 0) {
        await User.updateMany(
          { _id: { $in: userIds } },
          { 
            $set: { 
              status: 'offline',
              lastSeen: new Date()
            }
          }
        );
      }

      logger.info('All sessions force cleaned up', {
        cleanedUserCount: userIds.length
      });

    } catch (error) {
      logger.error('Error during force cleanup:', error);
    }
  }
}

// Create singleton instance
const sessionService = new SessionService();

module.exports = sessionService;
