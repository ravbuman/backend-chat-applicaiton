/**
 * User Data Model
 * MongoDB schema with validation, indexes, and virtual properties
 * 
 * @description User entity with phone-based authentication and status tracking
 * @author Chat App Team
 * @version 1.0.0
 */

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const moment = require('moment');
const logger = require('../utils/logger');

/**
 * User Schema Definition
 * Implements secure phone + PIN authentication with session management
 */
const userSchema = new mongoose.Schema({
  // Authentication fields
  phoneNumber: {
    type: String,
    required: [true, 'Phone number is required'],
    unique: true,
    trim: true,
    validate: {
      validator: function(v) {
        // Validate phone number format (10-15 digits)
        return /^\d{10,15}$/.test(v);
      },
      message: 'Phone number must be 10-15 digits'
    }
  },

  pinHash: {
    type: String,
    required: [true, 'PIN hash is required'],
    select: false // Don't include in queries by default
  },

  // User status and presence
  status: {
    type: String,
    enum: ['online', 'offline', 'away'],
    default: 'offline',
    index: true
  },

  lastSeen: {
    type: Date,
    default: Date.now,
    index: true
  },

  isActive: {
    type: Boolean,
    default: true,
    index: true
  },

  // Session management
  sessionData: {
    lastLoginAt: {
      type: Date,
      default: null
    },
    lastActivityAt: {
      type: Date,
      default: Date.now
    },
    deviceInfo: {
      userAgent: String,
      ipAddress: String,
      platform: String
    },
    refreshTokenVersion: {
      type: Number,
      default: 0
    }
  },

  // Security fields
  security: {
    pinRetryCount: {
      type: Number,
      default: 0,
      max: 5
    },
    pinRetryWindow: {
      type: Date,
      default: null
    },
    isLocked: {
      type: Boolean,
      default: false
    },
    lockedUntil: {
      type: Date,
      default: null
    },
    lastPasswordChange: {
      type: Date,
      default: Date.now
    }
  },

  // Profile information (optional for future enhancement)
  profile: {
    displayName: {
      type: String,
      trim: true,
      maxlength: [50, 'Display name cannot exceed 50 characters']
    },
    avatar: {
      type: String,
      default: null
    },
    bio: {
      type: String,
      trim: true,
      maxlength: [200, 'Bio cannot exceed 200 characters']
    }
  },

  // Metadata
  metadata: {
    totalMessages: {
      type: Number,
      default: 0
    },
    totalLogins: {
      type: Number,
      default: 0
    },
    createdAt: {
      type: Date,
      default: Date.now,
      immutable: true
    },
    updatedAt: {
      type: Date,
      default: Date.now
    }
  }
}, {
  timestamps: false, // We handle this manually in metadata
  versionKey: false,
  collection: 'users'
});

/**
 * Indexes for performance optimization
 */
userSchema.index({ phoneNumber: 1 }, { unique: true });
userSchema.index({ status: 1, lastSeen: -1 });
userSchema.index({ 'sessionData.lastActivityAt': -1 });
userSchema.index({ 'security.isLocked': 1, 'security.lockedUntil': 1 });
userSchema.index({ isActive: 1, 'metadata.createdAt': -1 });

/**
 * Virtual properties
 */
userSchema.virtual('isOnline').get(function() {
  return this.status === 'online';
});

userSchema.virtual('isAccountLocked').get(function() {
  return this.security.isLocked && 
         this.security.lockedUntil && 
         new Date() < this.security.lockedUntil;
});

userSchema.virtual('lastSeenFormatted').get(function() {
  return moment(this.lastSeen).fromNow();
});

userSchema.virtual('accountAge').get(function() {
  return moment().diff(moment(this.metadata.createdAt), 'days');
});

/**
 * Pre-save middleware
 */
userSchema.pre('save', async function(next) {
  try {
    // Update the updatedAt timestamp
    this.metadata.updatedAt = new Date();

    // Hash PIN if it's modified
    if (this.isModified('pinHash') && !this.pinHash.startsWith('$2a$')) {
      const saltRounds = 12;
      this.pinHash = await bcrypt.hash(this.pinHash, saltRounds);
      this.security.lastPasswordChange = new Date();
      
      logger.logAuth('PIN_UPDATED', this.phoneNumber, true, {
        userId: this._id
      });
    }

    // Reset retry count if PIN is changed
    if (this.isModified('pinHash')) {
      this.security.pinRetryCount = 0;
      this.security.pinRetryWindow = null;
      this.security.isLocked = false;
      this.security.lockedUntil = null;
    }

    next();
  } catch (error) {
    logger.error('Error in user pre-save middleware:', error);
    next(error);
  }
});

/**
 * Instance Methods
 */

/**
 * Compare PIN with stored hash
 * @param {string} pin - Plain text PIN
 * @returns {Promise<boolean>}
 */
userSchema.methods.comparePin = async function(pin) {
  try {
    if (!pin || !this.pinHash) {
      return false;
    }
    
    const isMatch = await bcrypt.compare(pin, this.pinHash);
    
    logger.logAuth('PIN_COMPARISON', this.phoneNumber, isMatch, {
      userId: this._id
    });
    
    return isMatch;
  } catch (error) {
    logger.error('Error comparing PIN:', error);
    return false;
  }
};

/**
 * Update user activity timestamp
 * @returns {Promise<void>}
 */
userSchema.methods.updateActivity = async function() {
  try {
    this.sessionData.lastActivityAt = new Date();
    await this.save({ validateBeforeSave: false });
    
    logger.debug('User activity updated', {
      userId: this._id,
      phoneNumber: this.phoneNumber
    });
  } catch (error) {
    logger.error('Error updating user activity:', error);
  }
};

/**
 * Set user online status
 * @param {Object} deviceInfo - Device information
 * @returns {Promise<void>}
 */
userSchema.methods.setOnline = async function(deviceInfo = {}) {
  try {
    this.status = 'online';
    this.lastSeen = new Date();
    this.sessionData.lastActivityAt = new Date();
    this.sessionData.deviceInfo = {
      ...this.sessionData.deviceInfo,
      ...deviceInfo
    };
    
    await this.save({ validateBeforeSave: false });
    
    logger.logAuth('USER_ONLINE', this.phoneNumber, true, {
      userId: this._id,
      deviceInfo
    });
  } catch (error) {
    logger.error('Error setting user online:', error);
  }
};

/**
 * Set user offline status
 * @returns {Promise<void>}
 */
userSchema.methods.setOffline = async function() {
  try {
    this.status = 'offline';
    this.lastSeen = new Date();
    
    await this.save({ validateBeforeSave: false });
    
    logger.logAuth('USER_OFFLINE', this.phoneNumber, true, {
      userId: this._id
    });
  } catch (error) {
    logger.error('Error setting user offline:', error);
  }
};

/**
 * Handle failed PIN attempt
 * @returns {Promise<boolean>} Returns true if account is now locked
 */
userSchema.methods.handleFailedPinAttempt = async function() {
  try {
    const now = new Date();
    const retryWindowMinutes = 15; // 15 minutes retry window
    const maxRetries = 5;
    
    // Reset retry count if retry window has expired
    if (this.security.pinRetryWindow && 
        now > moment(this.security.pinRetryWindow).add(retryWindowMinutes, 'minutes').toDate()) {
      this.security.pinRetryCount = 0;
      this.security.pinRetryWindow = null;
    }
    
    // Set retry window if first attempt
    if (this.security.pinRetryCount === 0) {
      this.security.pinRetryWindow = now;
    }
    
    this.security.pinRetryCount += 1;
    
    // Lock account if max retries exceeded
    if (this.security.pinRetryCount >= maxRetries) {
      this.security.isLocked = true;
      this.security.lockedUntil = moment().add(30, 'minutes').toDate(); // Lock for 30 minutes
      
      logger.logAuth('ACCOUNT_LOCKED', this.phoneNumber, false, {
        userId: this._id,
        retryCount: this.security.pinRetryCount,
        lockedUntil: this.security.lockedUntil
      });
    }
    
    await this.save({ validateBeforeSave: false });
    
    return this.security.isLocked;
  } catch (error) {
    logger.error('Error handling failed PIN attempt:', error);
    return false;
  }
};

/**
 * Reset PIN retry attempts
 * @returns {Promise<void>}
 */
userSchema.methods.resetPinRetries = async function() {
  try {
    this.security.pinRetryCount = 0;
    this.security.pinRetryWindow = null;
    this.security.isLocked = false;
    this.security.lockedUntil = null;
    
    await this.save({ validateBeforeSave: false });
    
    logger.logAuth('PIN_RETRIES_RESET', this.phoneNumber, true, {
      userId: this._id
    });
  } catch (error) {
    logger.error('Error resetting PIN retries:', error);
  }
};

/**
 * Increment refresh token version (invalidates all existing tokens)
 * @returns {Promise<void>}
 */
userSchema.methods.invalidateTokens = async function() {
  try {
    this.sessionData.refreshTokenVersion += 1;
    await this.save({ validateBeforeSave: false });
    
    logger.logAuth('TOKENS_INVALIDATED', this.phoneNumber, true, {
      userId: this._id,
      newVersion: this.sessionData.refreshTokenVersion
    });
  } catch (error) {
    logger.error('Error invalidating tokens:', error);
  }
};

/**
 * Static Methods
 */

/**
 * Find user by phone number with security data
 * @param {string} phoneNumber 
 * @returns {Promise<Object|null>}
 */
userSchema.statics.findByPhoneWithSecurity = function(phoneNumber) {
  return this.findOne({ phoneNumber, isActive: true })
    .select('+pinHash')
    .exec();
};

/**
 * Get online users list
 * @param {Array} excludeIds - User IDs to exclude
 * @returns {Promise<Array>}
 */
userSchema.statics.getOnlineUsers = function(excludeIds = []) {
  return this.find({
    status: 'online',
    isActive: true,
    _id: { $nin: excludeIds }
  })
  .select('phoneNumber profile.displayName status lastSeen')
  .sort({ lastSeen: -1 })
  .exec();
};

/**
 * Clean up inactive sessions
 * @param {number} minutesInactive - Minutes of inactivity threshold
 * @returns {Promise<number>} Number of users updated
 */
userSchema.statics.cleanupInactiveSessions = async function(minutesInactive = 30) {
  try {
    const cutoffTime = moment().subtract(minutesInactive, 'minutes').toDate();
    
    const result = await this.updateMany(
      {
        status: { $in: ['online', 'away'] },
        'sessionData.lastActivityAt': { $lt: cutoffTime }
      },
      {
        $set: {
          status: 'offline',
          lastSeen: new Date()
        }
      }
    );
    
    logger.info(`Cleaned up ${result.modifiedCount} inactive sessions`);
    return result.modifiedCount;
  } catch (error) {
    logger.error('Error cleaning up inactive sessions:', error);
    return 0;
  }
};

/**
 * Transform output (remove sensitive data)
 */
userSchema.methods.toJSON = function() {
  if (!this) return {};
  const user = this.toObject ? this.toObject({ virtuals: true }) : {};
  // Remove sensitive fields
  if (user) {
    delete user.pinHash;
    delete user.security;
    delete user.sessionData?.refreshTokenVersion;
  }
  return user;
};

// Create and export the model
const User = mongoose.model('User', userSchema);

module.exports = User;
