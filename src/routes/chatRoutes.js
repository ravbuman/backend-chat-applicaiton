/**
 * Chat Routes
 * Route definitions for chat-related endpoints
 * 
 * @description Route layer for chat and messaging HTTP endpoints
 * @author Chat App Team
 * @version 1.0.0
 */

const express = require('express');
const joi = require('joi');
const { 
  authenticate, 
  validateSession, 
  rateLimitByUser,
  ensureOwnership 
} = require('../middleware/authMiddleware');
const { ValidationMiddleware, schemas } = require('../utils/validator');
const chatController = require('../controllers/chatController');

const router = express.Router();

/**
 * Apply authentication to all chat routes
 */
router.use(authenticate);
router.use(validateSession);

/**
 * Message endpoints
 */

// Send a message
router.post('/send',
  ValidationMiddleware.validate(schemas.sendMessage, 'body'),
  chatController.sendMessage
);

// Get chat history with another user
router.get('/history/:userId',
  ValidationMiddleware.validateObjectId('userId'),
  ValidationMiddleware.validate(schemas.pagination, 'query'),
  chatController.getChatHistory
);

// Get group chat history
router.get('/history/group/:groupId',
  ValidationMiddleware.validateObjectId('groupId'),
  ValidationMiddleware.validate(schemas.pagination, 'query'),
  chatController.getChatHistory
);

// Mark messages as read
router.post('/mark-read',
  rateLimitByUser(60, 60 * 1000), // 60 requests per minute per user
  ValidationMiddleware.validate(joi.object({
    senderId: schemas.objectId.required()
  }), 'body'),
  chatController.markMessagesAsRead
);

// Delete a message
router.delete('/message/:messageId',
  ValidationMiddleware.validateObjectId('messageId'),
  chatController.deleteMessage
);

/**
 * User status and presence endpoints
 */

// Update user status
router.post('/status',
  rateLimitByUser(20, 60 * 1000), // 20 status updates per minute per user
  ValidationMiddleware.validate(schemas.updateUserStatus, 'body'),
  chatController.updateUserStatus
);

// Get online users
router.get('/online-users',
  rateLimitByUser(30, 60 * 1000), // 30 requests per minute per user
  chatController.getOnlineUsers
);

// Search users
router.get('/search-users',
  rateLimitByUser(20, 60 * 1000), // 20 searches per minute per user
  ValidationMiddleware.validate(joi.object({
    q: joi.string().min(3).max(50).required().messages({
      'string.min': 'Search term must be at least 3 characters',
      'string.max': 'Search term cannot exceed 50 characters',
      'any.required': 'Search term (q) is required'
    }),
    limit: joi.number().integer().min(1).max(50).default(10)
  }), 'query'),
  chatController.searchUsers
);

/**
 * Conversation management endpoints
 */

// Get recent conversations
router.get('/conversations',
  rateLimitByUser(30, 60 * 1000), // 30 requests per minute per user
  ValidationMiddleware.validate(joi.object({
    limit: joi.number().integer().min(1).max(50).default(10)
  }), 'query'),
  chatController.getRecentConversations
);

// Get unread message count
router.get('/unread-count',
  rateLimitByUser(60, 60 * 1000), // 60 requests per minute per user
  chatController.getUnreadCount
);

/**
 * Statistics and analytics endpoints
 */

// Get chat statistics for current user
router.get('/statistics',
  rateLimitByUser(10, 60 * 1000), // 10 requests per minute per user
  chatController.getChatStatistics
);

/**
 * Health and monitoring endpoints
 */

// Chat service health check
router.get('/health',
  chatController.healthCheck
);

/**
 * Error handling for invalid routes
 */
router.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: `Chat route ${req.originalUrl} not found`,
    error: 'ROUTE_NOT_FOUND',
    availableEndpoints: {
      messages: [
        'POST /api/chat/send',
        'GET /api/chat/history/:userId',
        'GET /api/chat/history/group/:groupId',
        'POST /api/chat/mark-read',
        'DELETE /api/chat/message/:messageId'
      ],
      status: [
        'POST /api/chat/status',
        'GET /api/chat/online-users',
        'GET /api/chat/search-users'
      ],
      conversations: [
        'GET /api/chat/conversations',
        'GET /api/chat/unread-count'
      ],
      analytics: [
        'GET /api/chat/statistics'
      ],
      monitoring: [
        'GET /api/chat/health'
      ]
    },
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
