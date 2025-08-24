/**
 * Chat Controller
 * HTTP request handlers for chat-related endpoints
 * 
 * @description Presentation layer handling chat operations and message management
 * @author Chat App Team
 * @version 1.0.0
 */

const chatService = require('../services/chatService');
const sessionService = require('../services/sessionService');
const logger = require('../utils/logger');
const { asyncHandler, createError } = require('../middleware/errorHandler');

/**
 * Extract device and request metadata
 * @param {Object} req - Express request object
 * @returns {Object} Metadata object
 */
const extractMetadata = (req) => ({
  platform: req.get('Platform') || req.body.platform || 'web',
  userAgent: req.get('User-Agent') || '',
  ipAddress: req.ip || req.connection.remoteAddress || ''
});

/**
 * Send a message
 * POST /api/chat/send
 */
const sendMessage = asyncHandler(async (req, res) => {
  const { receiverId, groupId, content, messageType = 'text' } = req.body;
  const senderId = req.user._id.toString();
  const metadata = extractMetadata(req);

  try {
    // Track user activity
    await sessionService.trackActivity(senderId, metadata);

    const result = await chatService.sendMessage(
      senderId,
      receiverId,
      groupId,
      content,
      messageType,
      metadata
    );

    logger.info('Message sent successfully', {
      messageId: result.data.messageId,
      senderId,
      receiverId,
      groupId,
      contentLength: content.length,
      messageType
    });

    res.status(201).json({
      success: true,
      message: 'Message sent successfully',
      data: result.data,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Error sending message:', error, {
      senderId,
      receiverId,
      groupId,
      messageType
    });
    throw error;
  }
});

/**
 * Get chat history
 * GET /api/chat/history/:userId or /api/chat/history/group/:groupId
 */
const getChatHistory = asyncHandler(async (req, res) => {
  const currentUserId = req.user._id.toString();
  const { userId: otherUserId, groupId } = req.params;
  const { page = 1, limit = 20, before } = req.query;

  try {
    // Track user activity
    await sessionService.trackActivity(currentUserId, extractMetadata(req));

    // Validate pagination parameters
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);

    if (pageNum < 1 || limitNum < 1 || limitNum > 100) {
      throw createError.badRequest('Invalid pagination parameters');
    }

    const options = {
      page: pageNum,
      limit: limitNum,
      before: before ? new Date(before) : null
    };

    const result = await chatService.getChatHistory(
      currentUserId,
      otherUserId,
      groupId,
      options
    );

    logger.info('Chat history retrieved', {
      currentUserId,
      otherUserId,
      groupId,
      page: pageNum,
      limit: limitNum,
      messagesCount: result.data.messages.length
    });

    res.status(200).json({
      success: true,
      message: 'Chat history retrieved successfully',
      data: result.data,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Error getting chat history:', error, {
      currentUserId,
      otherUserId,
      groupId
    });
    throw error;
  }
});

/**
 * Mark messages as read
 * POST /api/chat/mark-read
 */
const markMessagesAsRead = asyncHandler(async (req, res) => {
  const { senderId } = req.body;
  const receiverId = req.user._id.toString();

  if (!senderId) {
    throw createError.badRequest('Sender ID is required');
  }

  try {
    // Track user activity
    await sessionService.trackActivity(receiverId, extractMetadata(req));

    const result = await chatService.markMessagesAsRead(senderId, receiverId);

    logger.info('Messages marked as read', {
      senderId,
      receiverId,
      markedCount: result.markedCount
    });

    res.status(200).json({
      success: true,
      message: result.message,
      data: {
        markedCount: result.markedCount
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Error marking messages as read:', error, {
      senderId,
      receiverId
    });
    throw error;
  }
});

/**
 * Get unread message count
 * GET /api/chat/unread-count
 */
const getUnreadCount = asyncHandler(async (req, res) => {
  const userId = req.user._id.toString();

  try {
    // Track user activity
    await sessionService.trackActivity(userId, extractMetadata(req));

    const result = await chatService.getUnreadCount(userId);

    res.status(200).json({
      success: true,
      message: 'Unread count retrieved successfully',
      data: result.data,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Error getting unread count:', error, { userId });
    throw error;
  }
});

/**
 * Get recent conversations
 * GET /api/chat/conversations
 */
const getRecentConversations = asyncHandler(async (req, res) => {
  const userId = req.user._id.toString();
  const { limit = 10 } = req.query;

  try {
    // Track user activity
    await sessionService.trackActivity(userId, extractMetadata(req));

    // Validate limit
    const limitNum = parseInt(limit, 10);
    if (limitNum < 1 || limitNum > 50) {
      throw createError.badRequest('Limit must be between 1 and 50');
    }

    const result = await chatService.getRecentConversations(userId, limitNum);

    logger.info('Recent conversations retrieved', {
      userId,
      limit: limitNum,
      conversationsCount: result.data.conversations.length
    });

    res.status(200).json({
      success: true,
      message: 'Recent conversations retrieved successfully',
      data: result.data,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Error getting recent conversations:', error, { userId });
    throw error;
  }
});

/**
 * Update user status
 * POST /api/chat/status
 */
const updateUserStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  const userId = req.user._id.toString();
  const deviceInfo = extractMetadata(req);

  if (!status) {
    throw createError.badRequest('Status is required');
  }

  try {
    const result = await chatService.updateUserStatus(userId, status, deviceInfo);

    // Track user activity
    await sessionService.trackActivity(userId, deviceInfo);

    logger.info('User status updated', {
      userId,
      phoneNumber: req.user.phoneNumber,
      newStatus: status,
      platform: deviceInfo.platform
    });

    res.status(200).json({
      success: true,
      message: result.message,
      data: result.data,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Error updating user status:', error, {
      userId,
      status
    });
    throw error;
  }
});

/**
 * Get online users
 * GET /api/chat/online-users
 */
const getOnlineUsers = asyncHandler(async (req, res) => {
  const currentUserId = req.user._id.toString();

  try {
    // Track user activity
    await sessionService.trackActivity(currentUserId, extractMetadata(req));

    const result = await chatService.getOnlineUsers(currentUserId);

    logger.debug('Online users retrieved', {
      currentUserId,
      onlineUsersCount: result.data.users.length
    });

    res.status(200).json({
      success: true,
      message: 'Online users retrieved successfully',
      data: result.data,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Error getting online users:', error, { currentUserId });
    throw error;
  }
});

/**
 * Search users
 * GET /api/chat/search-users
 */
const searchUsers = asyncHandler(async (req, res) => {
  const { q: searchTerm, limit = 10 } = req.query;
  const currentUserId = req.user._id.toString();

  if (!searchTerm) {
    throw createError.badRequest('Search term (q) is required');
  }

  try {
    // Track user activity
    await sessionService.trackActivity(currentUserId, extractMetadata(req));

    // Validate limit
    const limitNum = parseInt(limit, 10);
    if (limitNum < 1 || limitNum > 50) {
      throw createError.badRequest('Limit must be between 1 and 50');
    }

    const result = await chatService.searchUsers(searchTerm, currentUserId, limitNum);

    logger.info('User search performed', {
      currentUserId,
      searchTerm,
      resultsCount: result.data.users.length
    });

    res.status(200).json({
      success: true,
      message: 'User search completed successfully',
      data: result.data,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Error searching users:', error, {
      currentUserId,
      searchTerm
    });
    throw error;
  }
});

/**
 * Delete a message
 * DELETE /api/chat/message/:messageId
 */
const deleteMessage = asyncHandler(async (req, res) => {
  const { messageId } = req.params;
  const userId = req.user._id.toString();

  if (!messageId) {
    throw createError.badRequest('Message ID is required');
  }

  try {
    // Track user activity
    await sessionService.trackActivity(userId, extractMetadata(req));

    const result = await chatService.deleteMessage(messageId, userId);

    logger.info('Message deleted', {
      messageId,
      userId,
      phoneNumber: req.user.phoneNumber
    });

    res.status(200).json({
      success: true,
      message: result.message,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Error deleting message:', error, {
      messageId,
      userId
    });
    throw error;
  }
});

/**
 * Get chat statistics for current user
 * GET /api/chat/statistics
 */
const getChatStatistics = asyncHandler(async (req, res) => {
  const userId = req.user._id.toString();

  try {
    // Track user activity
    await sessionService.trackActivity(userId, extractMetadata(req));

    const result = await chatService.getChatStatistics(userId);

    logger.info('Chat statistics retrieved', {
      userId,
      totalSent: result.data.totalSent,
      totalReceived: result.data.totalReceived,
      unreadCount: result.data.unreadCount
    });

    res.status(200).json({
      success: true,
      message: 'Chat statistics retrieved successfully',
      data: result.data,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Error getting chat statistics:', error, { userId });
    throw error;
  }
});

/**
 * Health check for chat service
 * GET /api/chat/health
 */
const healthCheck = asyncHandler(async (req, res) => {
  try {
    const sessionStats = sessionService.getSessionStatistics();
    
    res.status(200).json({
      success: true,
      message: 'Chat service is healthy',
      data: {
        status: 'healthy',
        activeSessions: sessionStats.totalActiveSessions,
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Chat health check failed:', error);
    throw createError.internal('Chat service health check failed');
  }
});

module.exports = {
  sendMessage,
  getChatHistory,
  markMessagesAsRead,
  getUnreadCount,
  getRecentConversations,
  updateUserStatus,
  getOnlineUsers,
  searchUsers,
  deleteMessage,
  getChatStatistics,
  healthCheck
};
