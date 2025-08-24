/**
 * Error Handler Middleware
 * Centralized error handling with logging and user-friendly responses
 * 
 * @description Global error handling middleware for consistent error responses
 * @author Chat App Team
 * @version 1.0.0
 */

const config = require('../config/config');
const logger = require('../utils/logger');

/**
 * Error types for categorization
 */
const ERROR_TYPES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  AUTH_ERROR: 'AUTH_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  RATE_LIMIT: 'RATE_LIMIT',
  DATABASE_ERROR: 'DATABASE_ERROR',
  EXTERNAL_SERVICE_ERROR: 'EXTERNAL_SERVICE_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR'
};

/**
 * Custom error class for application errors
 */
class AppError extends Error {
  constructor(message, statusCode = 500, errorType = ERROR_TYPES.INTERNAL_ERROR, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.errorType = errorType;
    this.details = details;
    this.isOperational = true;
    this.timestamp = new Date().toISOString();

    // Capture stack trace
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Database error handler
 * @param {Error} error - MongoDB/Mongoose error
 * @returns {AppError} Formatted application error
 */
const handleDatabaseError = (error) => {
  let message = 'Database operation failed';
  let statusCode = 500;
  let details = null;

  // MongoDB duplicate key error
  if (error.code === 11000) {
    const field = Object.keys(error.keyValue)[0];
    message = `${field.charAt(0).toUpperCase() + field.slice(1)} already exists`;
    statusCode = 409;
    details = { field, value: error.keyValue[field] };
  }
  
  // MongoDB validation error
  else if (error.name === 'ValidationError') {
    const errors = Object.values(error.errors).map(err => ({
      field: err.path,
      message: err.message,
      value: err.value
    }));
    message = 'Validation failed';
    statusCode = 400;
    details = { validationErrors: errors };
  }
  
  // MongoDB cast error
  else if (error.name === 'CastError') {
    message = `Invalid ${error.path}: ${error.value}`;
    statusCode = 400;
    details = { field: error.path, value: error.value, expectedType: error.kind };
  }
  
  // MongoDB connection error
  else if (error.name === 'MongoNetworkError' || error.name === 'MongoTimeoutError') {
    message = 'Database connection failed';
    statusCode = 503;
  }

  return new AppError(message, statusCode, ERROR_TYPES.DATABASE_ERROR, details);
};

/**
 * JWT error handler
 * @param {Error} error - JWT error
 * @returns {AppError} Formatted application error
 */
const handleJWTError = (error) => {
  let message = 'Authentication failed';
  let statusCode = 401;
  let details = null;

  if (error.name === 'JsonWebTokenError') {
    message = 'Invalid token';
    details = { reason: 'malformed_token' };
  } else if (error.name === 'TokenExpiredError') {
    message = 'Token has expired';
    details = { 
      reason: 'expired_token',
      expiredAt: error.expiredAt
    };
  } else if (error.name === 'NotBeforeError') {
    message = 'Token not active yet';
    details = { 
      reason: 'token_not_active',
      notBefore: error.notBefore
    };
  }

  return new AppError(message, statusCode, ERROR_TYPES.AUTH_ERROR, details);
};

/**
 * Validation error handler
 * @param {Error} error - Joi validation error
 * @returns {AppError} Formatted application error
 */
const handleValidationError = (error) => {
  if (error.isJoi) {
    const details = error.details.map(detail => ({
      field: detail.path.join('.'),
      message: detail.message,
      value: detail.context?.value
    }));

    return new AppError(
      'Input validation failed',
      400,
      ERROR_TYPES.VALIDATION_ERROR,
      { validationErrors: details }
    );
  }

  return new AppError(error.message, 400, ERROR_TYPES.VALIDATION_ERROR);
};

/**
 * Format error response for client
 * @param {AppError} error - Application error
 * @param {Object} req - Express request object
 * @returns {Object} Formatted error response
 */
const formatErrorResponse = (error, req) => {
  const response = {
    success: false,
    message: error.message,
    error: error.errorType || ERROR_TYPES.INTERNAL_ERROR,
    timestamp: error.timestamp || new Date().toISOString(),
    path: req.originalUrl,
    method: req.method
  };

  // Add details in development or for specific error types
  if (config.isDevelopment || error.details) {
    response.details = error.details;
  }

  // Add request ID if available
  if (req.requestId) {
    response.requestId = req.requestId;
  }

  // Add stack trace in development
  if (config.isDevelopment && error.stack) {
    response.stack = error.stack;
  }

  return response;
};

/**
 * Log error with appropriate level
 * @param {Error} error - Error object
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const logError = (error, req, res) => {
  const logData = {
    message: error.message,
    statusCode: error.statusCode || 500,
    errorType: error.errorType || ERROR_TYPES.INTERNAL_ERROR,
    path: req.originalUrl,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    userId: req.user?.id || 'anonymous',
    requestId: req.requestId,
    timestamp: new Date().toISOString()
  };

  // Add error details for logging
  if (error.details) {
    logData.details = error.details;
  }

  // Determine log level based on status code
  if (error.statusCode >= 500) {
    logger.error('Server Error:', error, logData);
  } else if (error.statusCode >= 400) {
    logger.warn('Client Error:', logData);
  } else {
    logger.info('Request Error:', logData);
  }
};

/**
 * Development error handler - includes stack traces
 * @param {Error} error - Error object
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Next middleware
 */
const developmentErrorHandler = (error, req, res, next) => {
  let appError = error;

  // Convert known errors to AppError
  if (!error.isOperational) {
    if (error.name === 'ValidationError' || error.code === 11000) {
      appError = handleDatabaseError(error);
    } else if (error.name?.includes('JWT') || error.name?.includes('Token')) {
      appError = handleJWTError(error);
    } else if (error.isJoi) {
      appError = handleValidationError(error);
    } else {
      // Generic internal error
      appError = new AppError(
        error.message || 'Something went wrong',
        error.statusCode || 500,
        ERROR_TYPES.INTERNAL_ERROR,
        config.isDevelopment ? { originalError: error.message } : null
      );
    }
  }

  // Log the error
  logError(appError, req, res);

  // Send error response
  res.status(appError.statusCode || 500).json(formatErrorResponse(appError, req));
};

/**
 * Production error handler - excludes sensitive information
 * @param {Error} error - Error object
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Next middleware
 */
const productionErrorHandler = (error, req, res, next) => {
  let appError = error;

  // Convert known errors to AppError
  if (!error.isOperational) {
    if (error.name === 'ValidationError' || error.code === 11000) {
      appError = handleDatabaseError(error);
    } else if (error.name?.includes('JWT') || error.name?.includes('Token')) {
      appError = handleJWTError(error);
    } else if (error.isJoi) {
      appError = handleValidationError(error);
    } else {
      // Generic internal error - don't leak details in production
      appError = new AppError(
        'Internal server error',
        500,
        ERROR_TYPES.INTERNAL_ERROR
      );
    }
  }

  // Log the error
  logError(appError, req, res);

  // Send error response (sanitized for production)
  const response = formatErrorResponse(appError, req);
  
  // Remove sensitive data in production
  if (appError.statusCode >= 500) {
    response.message = 'Internal server error';
    delete response.details;
    delete response.stack;
  }

  res.status(appError.statusCode || 500).json(response);
};

/**
 * Handle 404 errors - route not found
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Next middleware
 */
const notFoundHandler = (req, res, next) => {
  const error = new AppError(
    `Route ${req.originalUrl} not found`,
    404,
    ERROR_TYPES.NOT_FOUND,
    { 
      method: req.method,
      url: req.originalUrl,
      suggestion: 'Check the API documentation for available endpoints'
    }
  );

  next(error);
};

/**
 * Async error handler wrapper
 * @param {Function} fn - Async function
 * @returns {Function} Express middleware
 */
const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/**
 * Handle unhandled promise rejections
 */
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', { promise, reason });
  // Don't exit the process in production
  if (!config.isProduction) {
    process.exit(1);
  }
});

/**
 * Handle uncaught exceptions
 */
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  // Gracefully close the server
  process.exit(1);
});

/**
 * Create custom error instances
 */
const createError = {
  badRequest: (message, details = null) => 
    new AppError(message, 400, ERROR_TYPES.VALIDATION_ERROR, details),
  
  unauthorized: (message = 'Authentication required', details = null) => 
    new AppError(message, 401, ERROR_TYPES.AUTH_ERROR, details),
  
  forbidden: (message = 'Access denied', details = null) => 
    new AppError(message, 403, ERROR_TYPES.PERMISSION_DENIED, details),
  
  notFound: (message = 'Resource not found', details = null) => 
    new AppError(message, 404, ERROR_TYPES.NOT_FOUND, details),
  
  conflict: (message = 'Resource conflict', details = null) => 
    new AppError(message, 409, ERROR_TYPES.VALIDATION_ERROR, details),
  
  tooManyRequests: (message = 'Too many requests', details = null) => 
    new AppError(message, 429, ERROR_TYPES.RATE_LIMIT, details),
  
  internal: (message = 'Internal server error', details = null) => 
    new AppError(message, 500, ERROR_TYPES.INTERNAL_ERROR, details),
  
  serviceUnavailable: (message = 'Service unavailable', details = null) => 
    new AppError(message, 503, ERROR_TYPES.EXTERNAL_SERVICE_ERROR, details)
};

module.exports = {
  AppError,
  ERROR_TYPES,
  developmentErrorHandler,
  productionErrorHandler,
  notFoundHandler,
  asyncHandler,
  createError,
  handleDatabaseError,
  handleJWTError,
  handleValidationError
};
