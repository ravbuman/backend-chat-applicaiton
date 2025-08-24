/**
 * Input Validation Utility
 * Joi-based validation with custom rules and sanitization
 * 
 * @description Enterprise-grade input validation and sanitization
 * @author Chat App Team
 * @version 1.0.0
 */

const joi = require('joi');
const { StatusCodes } = require('http-status-codes');

/**
 * Custom validation messages
 */
const VALIDATION_MESSAGES = {
  'string.empty': 'Field cannot be empty',
  'string.min': 'Field must be at least {#limit} characters long',
  'string.max': 'Field must not exceed {#limit} characters',
  'string.pattern.base': 'Field format is invalid',
  'number.base': 'Field must be a number',
  'number.min': 'Field must be at least {#limit}',
  'number.max': 'Field must not exceed {#limit}',
  'any.required': 'Field is required',
  'any.only': 'Field must be one of: {#valids}'
};

/**
 * Custom Joi extensions
 */
const customJoi = joi.extend({
  type: 'phoneNumber',
  base: joi.string(),
  messages: {
    'phoneNumber.invalid': 'Phone number must be 10-15 digits'
  },
  rules: {
    format: {
      validate(value, helpers) {
        // Remove all non-digit characters
        const cleanPhone = value.replace(/\D/g, '');
        
        // Check if phone number is valid (10-15 digits)
        if (cleanPhone.length < 10 || cleanPhone.length > 15) {
          return helpers.error('phoneNumber.invalid');
        }
        
        return cleanPhone;
      }
    }
  }
});

/**
 * Validation schemas
 */
const schemas = {
  // User Registration
  userRegistration: joi.object({
    phoneNumber: customJoi.phoneNumber().format().required()
      .messages({
        'any.required': 'Phone number is required',
        'phoneNumber.invalid': 'Phone number must be 10-15 digits'
      }),
    pin: joi.string()
      .pattern(/^\d{4}$/)
      .required()
      .messages({
        'string.pattern.base': 'PIN must be exactly 4 digits',
        'any.required': 'PIN is required'
      })
  }),

  // User Login
  userLogin: joi.object({
    phoneNumber: customJoi.phoneNumber().format().required(),
    pin: joi.string()
      .pattern(/^\d{4}$/)
      .required()
      .messages({
        'string.pattern.base': 'PIN must be exactly 4 digits',
        'any.required': 'PIN is required'
      })
  }),

  // PIN Verification
  pinVerification: joi.object({
    pin: joi.string()
      .pattern(/^\d{4}$/)
      .required()
      .messages({
        'string.pattern.base': 'PIN must be exactly 4 digits',
        'any.required': 'PIN is required'
      })
  }),

  // Send Message
  sendMessage: joi.object({
    receiverId: joi.string()
      .pattern(/^[0-9a-fA-F]{24}$/)
      .optional()
      .messages({
        'string.pattern.base': 'Invalid receiver ID format'
      }),
    groupId: joi.string()
      .pattern(/^[0-9a-fA-F]{24}$/)
      .optional()
      .messages({
        'string.pattern.base': 'Invalid group ID format'
      }),
    content: joi.string()
      .trim()
      .min(1)
      .max(1000)
      .required()
      .messages({
        'string.empty': 'Message content cannot be empty',
        'string.max': 'Message cannot exceed 1000 characters',
        'any.required': 'Message content is required'
      }),
    messageType: joi.string()
      .valid('text', 'image', 'file')
      .default('text')
      .messages({
        'any.only': 'Message type must be text, image, or file'
      })
  }).custom((value, helpers) => {
    // Custom validation to ensure either receiverId or groupId is present
    if (!value.receiverId && !value.groupId) {
      return helpers.error('any.custom', { message: 'Either receiverId or groupId is required' });
    }
    if (value.receiverId && value.groupId) {
      return helpers.error('any.custom', { message: 'Cannot specify both receiverId and groupId' });
    }
    return value;
  }),

  // Get Chat History
  getChatHistory: joi.object({
    userId: joi.string()
      .pattern(/^[0-9a-fA-F]{24}$/)
      .optional()
      .messages({
        'string.pattern.base': 'Invalid user ID format'
      }),
    groupId: joi.string()
      .pattern(/^[0-9a-fA-F]{24}$/)
      .optional()
      .messages({
        'string.pattern.base': 'Invalid group ID format'
      }),
    page: joi.number()
      .integer()
      .min(1)
      .default(1)
      .messages({
        'number.min': 'Page must be at least 1'
      }),
    limit: joi.number()
      .integer()
      .min(1)
      .max(100)
      .default(20)
      .messages({
        'number.min': 'Limit must be at least 1',
        'number.max': 'Limit cannot exceed 100'
      })
  }).custom((value, helpers) => {
    // Custom validation to ensure either userId or groupId is present
    if (!value.userId && !value.groupId) {
      return helpers.error('any.custom', { message: 'Either userId or groupId is required' });
    }
    if (value.userId && value.groupId) {
      return helpers.error('any.custom', { message: 'Cannot specify both userId and groupId' });
    }
    return value;
  }),

  // Update User Status
  updateUserStatus: joi.object({
    status: joi.string()
      .valid('online', 'offline', 'away')
      .required()
      .messages({
        'any.only': 'Status must be online, offline, or away',
        'any.required': 'Status is required'
      })
  }),

  // WebSocket Events
  joinRoom: joi.object({
    roomId: joi.string()
      .pattern(/^[0-9a-fA-F]{24}$/)
      .required()
      .messages({
        'string.pattern.base': 'Invalid room ID format',
        'any.required': 'Room ID is required'
      })
  }),

  // Pagination
  pagination: joi.object({
    page: joi.number()
      .integer()
      .min(1)
      .default(1),
    limit: joi.number()
      .integer()
      .min(1)
      .max(100)
      .default(20)
  }),

  // MongoDB ObjectId
  objectId: joi.string()
    .pattern(/^[0-9a-fA-F]{24}$/)
    .messages({
      'string.pattern.base': 'Invalid ID format'
    })
};

/**
 * Validation middleware factory
 */
class ValidationMiddleware {
  /**
   * Create validation middleware for request body
   * @param {joi.Schema} schema 
   * @param {string} property - 'body', 'query', 'params'
   * @returns {Function}
   */
  static validate(schema, property = 'body') {
    return (req, res, next) => {
      const { error, value } = schema.validate(req[property], {
        abortEarly: false,
        allowUnknown: false,
        stripUnknown: true,
        messages: VALIDATION_MESSAGES
      });

      if (error) {
        const validationErrors = error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message,
          value: detail.context?.value
        }));

        return res.status(StatusCodes.BAD_REQUEST).json({
          success: false,
          message: 'Validation failed',
          errors: validationErrors,
          timestamp: new Date().toISOString()
        });
      }

      // Replace the original data with validated and sanitized data
      req[property] = value;
      next();
    };
  }

  /**
   * Validate MongoDB ObjectId parameter
   * @param {string} paramName 
   * @returns {Function}
   */
  static validateObjectId(paramName) {
    return (req, res, next) => {
      const { error } = schemas.objectId.validate(req.params[paramName]);

      if (error) {
        return res.status(StatusCodes.BAD_REQUEST).json({
          success: false,
          message: `Invalid ${paramName} format`,
          timestamp: new Date().toISOString()
        });
      }

      next();
    };
  }

  /**
   * Sanitize input data
   * @param {Object} data 
   * @returns {Object}
   */
  static sanitize(data) {
    if (typeof data !== 'object' || data === null) {
      return data;
    }

    const sanitized = {};

    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'string') {
        // Trim whitespace and remove potentially dangerous characters
        sanitized[key] = value.trim()
          .replace(/[<>]/g, '') // Remove < and > to prevent XSS
          .replace(/javascript:/gi, '') // Remove javascript: protocol
          .replace(/on\w+=/gi, ''); // Remove event handlers
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = ValidationMiddleware.sanitize(value);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  /**
   * Custom validation for phone number
   * @param {string} phoneNumber 
   * @returns {Object}
   */
  static validatePhoneNumber(phoneNumber) {
    const { error, value } = customJoi.phoneNumber().format().validate(phoneNumber);
    
    return {
      isValid: !error,
      value: value,
      error: error?.message
    };
  }

  /**
   * Custom validation for PIN
   * @param {string} pin 
   * @returns {Object}
   */
  static validatePin(pin) {
    const { error } = schemas.pinVerification.validate({ pin });
    
    return {
      isValid: !error,
      error: error?.message
    };
  }
}

module.exports = {
  schemas,
  ValidationMiddleware,
  customJoi,
  VALIDATION_MESSAGES
};
