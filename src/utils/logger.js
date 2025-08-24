/**
 * Enterprise Logger Utility
 * Winston-based logging with structured logging, multiple transports, and error tracking
 * 
 * @description Production-ready logging system with multiple levels and formats
 * @author Chat App Team
 * @version 1.0.0
 */

const winston = require('winston');
const path = require('path');
const config = require('../config/config');

/**
 * Custom log format for development
 */
const developmentFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
    let log = `${timestamp} [${level}]: ${message}`;
    
    // Add metadata if present
    if (Object.keys(meta).length > 0) {
      log += ` ${JSON.stringify(meta, null, 2)}`;
    }
    
    // Add stack trace for errors
    if (stack) {
      log += `\n${stack}`;
    }
    
    return log;
  })
);

/**
 * Custom log format for production
 */
const productionFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.metadata({ fillExcept: ['message', 'level', 'timestamp'] })
);

/**
 * Create logger transports based on environment
 */
const createTransports = () => {
  const transports = [];

  // Console transport
  transports.push(new winston.transports.Console({
    level: config.logging.level,
    format: config.isDevelopment ? developmentFormat : productionFormat,
    handleExceptions: true,
    handleRejections: true
  }));

  // File transport for production
  if (config.isProduction || config.isDevelopment) {
    // Ensure logs directory exists
    const logsDir = path.dirname(config.logging.file);
    
    // General application logs
    transports.push(new winston.transports.File({
      filename: config.logging.file,
      level: config.logging.level,
      format: productionFormat,
      maxsize: 5242880, // 5MB
      maxFiles: 10,
      handleExceptions: true,
      handleRejections: true
    }));

    // Error logs
    transports.push(new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      format: productionFormat,
      maxsize: 5242880, // 5MB
      maxFiles: 10,
      handleExceptions: true,
      handleRejections: true
    }));
  }

  return transports;
};

/**
 * Create Winston logger instance
 */
const logger = winston.createLogger({
  level: config.logging.level,
  format: config.isProduction ? productionFormat : developmentFormat,
  transports: createTransports(),
  exitOnError: false,
  
  // Default metadata
  defaultMeta: {
    service: 'chat-app-backend',
    environment: config.env,
    version: require('../../package.json').version
  }
});

/**
 * Enhanced logger with additional methods
 */
class EnhancedLogger {
  constructor(winstonLogger) {
    this.logger = winstonLogger;
  }

  /**
   * Log info message
   * @param {string} message 
   * @param {Object} meta 
   */
  info(message, meta = {}) {
    this.logger.info(message, this.sanitizeMeta(meta));
  }

  /**
   * Log error message
   * @param {string} message 
   * @param {Error|Object} error 
   * @param {Object} meta 
   */
  error(message, error = {}, meta = {}) {
    const errorMeta = {
      ...this.sanitizeMeta(meta),
      ...(error instanceof Error ? {
        error: error.message,
        stack: error.stack,
        name: error.name
      } : error)
    };
    
    this.logger.error(message, errorMeta);
  }

  /**
   * Log warning message
   * @param {string} message 
   * @param {Object} meta 
   */
  warn(message, meta = {}) {
    this.logger.warn(message, this.sanitizeMeta(meta));
  }

  /**
   * Log debug message
   * @param {string} message 
   * @param {Object} meta 
   */
  debug(message, meta = {}) {
    this.logger.debug(message, this.sanitizeMeta(meta));
  }

  /**
   * Log HTTP request
   * @param {Object} req Express request object
   * @param {Object} res Express response object
   * @param {number} responseTime Response time in milliseconds
   */
  logRequest(req, res, responseTime) {
    const meta = {
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      responseTime: `${responseTime}ms`,
      userAgent: req.get('User-Agent'),
      ip: req.ip || req.connection.remoteAddress,
      userId: req.user?.id || 'anonymous'
    };

    const message = `${req.method} ${req.originalUrl} ${res.statusCode} ${responseTime}ms`;
    
    if (res.statusCode >= 400) {
      this.error(message, {}, meta);
    } else {
      this.info(message, meta);
    }
  }

  /**
   * Log authentication events
   * @param {string} event 
   * @param {string} phoneNumber 
   * @param {boolean} success 
   * @param {Object} meta 
   */
  logAuth(event, phoneNumber, success, meta = {}) {
    const authMeta = {
      event,
      phoneNumber: this.maskPhoneNumber(phoneNumber),
      success,
      timestamp: new Date().toISOString(),
      ...this.sanitizeMeta(meta)
    };

    const message = `Auth ${event}: ${success ? 'SUCCESS' : 'FAILED'} for ${this.maskPhoneNumber(phoneNumber)}`;
    
    if (success) {
      this.info(message, authMeta);
    } else {
      this.warn(message, authMeta);
    }
  }

  /**
   * Log WebSocket events
   * @param {string} event 
   * @param {string} socketId 
   * @param {Object} meta 
   */
  logWebSocket(event, socketId, meta = {}) {
    const wsMeta = {
      event,
      socketId,
      timestamp: new Date().toISOString(),
      ...this.sanitizeMeta(meta)
    };

    this.info(`WebSocket ${event}`, wsMeta);
  }

  /**
   * Log database operations
   * @param {string} operation 
   * @param {string} collection 
   * @param {Object} meta 
   */
  logDatabase(operation, collection, meta = {}) {
    const dbMeta = {
      operation,
      collection,
      timestamp: new Date().toISOString(),
      ...this.sanitizeMeta(meta)
    };

    this.debug(`DB ${operation} on ${collection}`, dbMeta);
  }

  /**
   * Sanitize metadata to remove sensitive information
   * @param {Object} meta 
   * @returns {Object}
   * @private
   */
  sanitizeMeta(meta) {
    const sensitiveFields = ['password', 'pin', 'token', 'secret', 'key'];
    const sanitized = { ...meta };

    const sanitizeObject = (obj) => {
      for (const key in obj) {
        if (typeof obj[key] === 'object' && obj[key] !== null) {
          sanitizeObject(obj[key]);
        } else if (sensitiveFields.some(field => key.toLowerCase().includes(field))) {
          obj[key] = '[REDACTED]';
        }
      }
    };

    sanitizeObject(sanitized);
    return sanitized;
  }

  /**
   * Mask phone number for logging
   * @param {string} phoneNumber 
   * @returns {string}
   * @private
   */
  maskPhoneNumber(phoneNumber) {
    if (!phoneNumber || phoneNumber.length < 4) {
      return '[MASKED]';
    }
    return phoneNumber.substring(0, 3) + '*'.repeat(phoneNumber.length - 6) + phoneNumber.substring(phoneNumber.length - 3);
  }

  /**
   * Create child logger with additional context
   * @param {Object} context 
   * @returns {EnhancedLogger}
   */
  child(context) {
    const childLogger = this.logger.child(context);
    return new EnhancedLogger(childLogger);
  }
}

// Create enhanced logger instance
const enhancedLogger = new EnhancedLogger(logger);

// Handle uncaught exceptions and unhandled rejections
process.on('uncaughtException', (error) => {
  enhancedLogger.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  enhancedLogger.error('Unhandled Rejection at:', { promise, reason });
});

module.exports = enhancedLogger;
