/**
 * Chat Service
 * Business logic for messaging, user status, and chat history management
 * 
 * @description Service layer handling all chat-related operations and business rules
 * @author Chat App Team
 * @version 1.0.0
 */

const moment = require('moment');
const config = require('../config/config');
const logger = require('../utils/logger');
const User = require('../models/userModel');
const Message = require('../models/messageModel');
const { ValidationMiddleware } = require('../utils/validator');

class ChatService {
  constructor() {
    this.messageRetentionDays = 365; // Keep messages for 1 year
    this.maxMessageLength = 1000;
  }

  /**
   * Send a message
   * @param {string} senderId - Sender user ID
   * @param {string} receiverId - Receiver user ID (optional for group messages)
   * @param {string} groupId - Group ID (optional for one-to-one messages)
   * @param {string} content - Message content
   * @param {string} messageType - Message type (text, image, file)
   * @param {Object} metadata - Additional metadata
   * @returns {Promise<Object>} Created message
   */
  async sendMessage(senderId, receiverId, groupId, content, messageType = 'text', metadata = {}) {
    try {
      // Validate inputs
      if (!senderId) {
        throw new Error('Sender ID is required');
      }

      if (!receiverId && !groupId) {
        throw new Error('Either receiver ID or group ID is required');
      }

      if (receiverId && groupId) {
        throw new Error('Cannot specify both receiver ID and group ID');
      }

      if (!content || content.trim().length === 0) {
        throw new Error('Message content is required');
      }

      if (content.length > this.maxMessageLength) {
        throw new Error(`Message exceeds maximum length of ${this.maxMessageLength} characters`);
      }

      // Validate sender exists
      const sender = await User.findById(senderId);
      if (!sender || !sender.isActive) {
        throw new Error('Sender not found');
      }

      // Validate receiver exists (for one-to-one messages)
      let receiver = null;
      if (receiverId) {
        receiver = await User.findById(receiverId);
        if (!receiver || !receiver.isActive) {
          throw new Error('Receiver not found');
        }

        // Check if sender is trying to send message to themselves
        if (senderId === receiverId) {
          throw new Error('Cannot send message to yourself');
        }
      }

      // Create message
      const message = new Message({
        senderId,
        receiverId: receiverId || null,
        groupId: groupId || null,
        content: content.trim(),
        messageType,
        status: 'sent',
        delivery: {
          sentAt: new Date()
        },
        metadata: {
          platform: metadata.platform || 'web',
          userAgent: metadata.userAgent || '',
          ipAddress: metadata.ipAddress || '',
          createdAt: new Date()
        }
      });

      await message.save();

      // Update sender activity
      await sender.updateActivity();

      // Update message count for receiver if one-to-one message
      if (receiver) {
        await this.updateUserMessageCount(receiverId);
      }

      logger.info('Message sent successfully', {
        messageId: message.messageId,
        senderId,
        receiverId,
        groupId,
        messageType,
        contentLength: content.length
      });

      // Populate sender information for response
      await message.populate('senderId', 'phoneNumber profile.displayName profile.avatar status');
      if (receiverId) {
        await message.populate('receiverId', 'phoneNumber profile.displayName profile.avatar status');
      }

      return {
        success: true,
        message: 'Message sent successfully',
        data: message.toJSON()
      };

    } catch (error) {
      logger.error('Error sending message:', error, {
        senderId,
        receiverId,
        groupId,
        messageType
      });
      throw error;
    }
  }

  /**
   * Get chat history between two users or in a group
   * @param {string} userId - Current user ID
   * @param {string} otherUserId - Other user ID (for one-to-one chat)
   * @param {string} groupId - Group ID (for group chat)
   * @param {Object} options - Pagination and filtering options
   * @returns {Promise<Object>} Chat history
   */
  async getChatHistory(userId, otherUserId, groupId, options = {}) {
    try {
      const { page = 1, limit = 20, before = null } = options;

      // Validate inputs
      if (!userId) {
        throw new Error('User ID is required');
      }

      if (!otherUserId && !groupId) {
        throw new Error('Either other user ID or group ID is required');
      }

      if (otherUserId && groupId) {
        throw new Error('Cannot specify both other user ID and group ID');
      }

      // Validate user exists
      const user = await User.findById(userId);
      if (!user || !user.isActive) {
        throw new Error('User not found');
      }

      let messages = [];
      let totalCount = 0;

      if (otherUserId) {
        // One-to-one chat history
        // Validate other user exists
        const otherUser = await User.findById(otherUserId);
        if (!otherUser || !otherUser.isActive) {
          throw new Error('Other user not found');
        }

        messages = await Message.getChatHistory(userId, otherUserId, { page, limit, before });
        
        // Get total count for pagination
        totalCount = await Message.countDocuments({
          $or: [
            { senderId: userId, receiverId: otherUserId },
            { senderId: otherUserId, receiverId: userId }
          ],
          'flags.isDeleted': false
        });

      } else if (groupId) {
        // Group chat history
        // TODO: Add group validation when group model is implemented
        messages = await Message.getGroupChatHistory(groupId, { page, limit, before });
        
        totalCount = await Message.countDocuments({
          groupId,
          'flags.isDeleted': false
        });
      }

      // Mark messages as delivered for the current user
      if (otherUserId) {
        await this.markMessagesAsDelivered(otherUserId, userId);
      }

      const totalPages = Math.ceil(totalCount / limit);
      const hasMore = page < totalPages;

      logger.info('Chat history retrieved', {
        userId,
        otherUserId,
        groupId,
        page,
        limit,
        messagesCount: messages.length,
        totalCount
      });

      return {
        success: true,
        data: {
          messages: messages.reverse(), // Reverse to show oldest first
          pagination: {
            page,
            limit,
            totalCount,
            totalPages,
            hasMore
          }
        }
      };

    } catch (error) {
      logger.error('Error getting chat history:', error, {
        userId,
        otherUserId,
        groupId,
        options
      });
      throw error;
    }
  }

  /**
   * Mark messages as read
   * @param {string} senderId - Sender user ID
   * @param {string} receiverId - Receiver user ID
   * @returns {Promise<Object>} Result
   */
  async markMessagesAsRead(senderId, receiverId) {
    try {
      if (!senderId || !receiverId) {
        throw new Error('Sender ID and Receiver ID are required');
      }

      const markedCount = await Message.markConversationAsRead(senderId, receiverId);

      logger.debug('Messages marked as read', {
        senderId,
        receiverId,
        markedCount
      });

      return {
        success: true,
        message: `${markedCount} messages marked as read`,
        markedCount
      };

    } catch (error) {
      logger.error('Error marking messages as read:', error, {
        senderId,
        receiverId
      });
      throw error;
    }
  }

  /**
   * Mark messages as delivered
   * @param {string} senderId - Sender user ID
   * @param {string} receiverId - Receiver user ID
   * @returns {Promise<Object>} Result
   * @private
   */
  async markMessagesAsDelivered(senderId, receiverId) {
    try {
      const result = await Message.updateMany(
        {
          senderId,
          receiverId,
          status: 'sent',
          'flags.isDeleted': false
        },
        {
          $set: {
            status: 'delivered',
            'delivery.deliveredAt': new Date()
          }
        }
      );

      logger.debug('Messages marked as delivered', {
        senderId,
        receiverId,
        deliveredCount: result.modifiedCount
      });

      return result.modifiedCount;

    } catch (error) {
      logger.error('Error marking messages as delivered:', error);
      return 0;
    }
  }

  /**
   * Get unread message count for user
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Unread count
   */
  async getUnreadCount(userId) {
    try {
      if (!userId) {
        throw new Error('User ID is required');
      }

      const unreadCount = await Message.getUnreadCount(userId);

      return {
        success: true,
        data: {
          unreadCount
        }
      };

    } catch (error) {
      logger.error('Error getting unread count:', error, { userId });
      throw error;
    }
  }

  /**
   * Get recent conversations for user
   * @param {string} userId - User ID
   * @param {number} limit - Number of conversations to return
   * @returns {Promise<Object>} Recent conversations
   */
  async getRecentConversations(userId, limit = 10) {
    try {
      if (!userId) {
        throw new Error('User ID is required');
      }

      const conversations = await Message.getRecentConversations(userId, limit);

      logger.info('Recent conversations retrieved', {
        userId,
        conversationsCount: conversations.length
      });

      return {
        success: true,
        data: {
          conversations
        }
      };

    } catch (error) {
      logger.error('Error getting recent conversations:', error, { userId });
      throw error;
    }
  }

  /**
   * Update user online status
   * @param {string} userId - User ID
   * @param {string} status - Status (online, offline, away)
   * @param {Object} deviceInfo - Device information
   * @returns {Promise<Object>} Result
   */
  async updateUserStatus(userId, status, deviceInfo = {}) {
    try {
      if (!userId) {
        throw new Error('User ID is required');
      }

      const validStatuses = ['online', 'offline', 'away'];
      if (!validStatuses.includes(status)) {
        throw new Error('Invalid status. Must be one of: ' + validStatuses.join(', '));
      }

      const user = await User.findById(userId);
      if (!user || !user.isActive) {
        throw new Error('User not found');
      }

      const previousStatus = user.status;

      if (status === 'online') {
        await user.setOnline(deviceInfo);
      } else if (status === 'offline') {
        await user.setOffline();
      } else {
        user.status = status;
        user.lastSeen = new Date();
        await user.save();
      }

      logger.info('User status updated', {
        userId,
        phoneNumber: user.phoneNumber,
        previousStatus,
        newStatus: status,
        deviceInfo
      });

      return {
        success: true,
        message: 'Status updated successfully',
        data: {
          userId,
          status,
          lastSeen: user.lastSeen
        }
      };

    } catch (error) {
      logger.error('Error updating user status:', error, { userId, status });
      throw error;
    }
  }

  /**
   * Get online users list
   * @param {string} currentUserId - Current user ID (to exclude from list)
   * @returns {Promise<Object>} Online users
   */
  async getOnlineUsers(currentUserId) {
    try {
      const excludeIds = currentUserId ? [currentUserId] : [];
      const onlineUsers = await User.getOnlineUsers(excludeIds);

      return {
        success: true,
        data: {
          users: onlineUsers
        }
      };

    } catch (error) {
      logger.error('Error getting online users:', error, { currentUserId });
      throw error;
    }
  }

  /**
   * Search users by phone number
   * @param {string} searchTerm - Search term (phone number)
   * @param {string} currentUserId - Current user ID (to exclude from results)
   * @param {number} limit - Maximum number of results
   * @returns {Promise<Object>} Search results
   */
  async searchUsers(searchTerm, currentUserId, limit = 10) {
    try {
      const excludeIds = currentUserId ? [currentUserId] : [];
      let users;
      if (!searchTerm || searchTerm.trim().length < 3) {
        // Return all users except current user
        users = await User.find({
          isActive: true,
          _id: { $nin: excludeIds }
        })
        .select('phoneNumber profile.displayName profile.avatar status lastSeen')
        .limit(limit)
        .exec();
      } else {
        const searchRegex = new RegExp(searchTerm.trim(), 'i');
        users = await User.find({
          phoneNumber: searchRegex,
          isActive: true,
          _id: { $nin: excludeIds }
        })
        .select('phoneNumber profile.displayName profile.avatar status lastSeen')
        .limit(limit)
        .exec();
      }
      return {
        success: true,
        data: {
          users,
          searchTerm
        }
      };
    } catch (error) {
      logger.error('Error searching users:', error, { searchTerm, currentUserId });
      throw error;
    }
  }

  /**
   * Delete a message
   * @param {string} messageId - Message ID
   * @param {string} userId - User ID (must be sender)
   * @returns {Promise<Object>} Result
   */
  async deleteMessage(messageId, userId) {
    try {
      if (!messageId || !userId) {
        throw new Error('Message ID and User ID are required');
      }

      const message = await Message.findById(messageId);
      if (!message) {
        throw new Error('Message not found');
      }

      // Check if user is the sender
      if (message.senderId.toString() !== userId) {
        throw new Error('Only the sender can delete this message');
      }

      // Check if message is already deleted
      if (message.flags.isDeleted) {
        throw new Error('Message is already deleted');
      }

      // Soft delete the message
      await message.softDelete(userId);

      logger.info('Message deleted', {
        messageId,
        userId,
        originalSender: message.senderId
      });

      return {
        success: true,
        message: 'Message deleted successfully'
      };

    } catch (error) {
      logger.error('Error deleting message:', error, { messageId, userId });
      throw error;
    }
  }

  /**
   * Update user message count
   * @param {string} userId - User ID
   * @returns {Promise<void>}
   * @private
   */
  async updateUserMessageCount(userId) {
    try {
      await User.findByIdAndUpdate(
        userId,
        { $inc: { 'metadata.totalMessages': 1 } },
        { new: false }
      );
    } catch (error) {
      // Non-critical error, just log it
      logger.warn('Failed to update user message count:', error, { userId });
    }
  }

  /**
   * Get chat statistics for user
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Chat statistics
   */
  async getChatStatistics(userId) {
    try {
      if (!userId) {
        throw new Error('User ID is required');
      }

      const user = await User.findById(userId);
      if (!user || !user.isActive) {
        throw new Error('User not found');
      }

      // Get message statistics
      const sentMessages = await Message.countDocuments({
        senderId: userId,
        'flags.isDeleted': false
      });

      const receivedMessages = await Message.countDocuments({
        receiverId: userId,
        'flags.isDeleted': false
      });

      const unreadMessages = await Message.countDocuments({
        receiverId: userId,
        status: { $in: ['sent', 'delivered'] },
        'flags.isDeleted': false
      });

      // Get recent activity
      const recentMessages = await Message.find({
        $or: [
          { senderId: userId },
          { receiverId: userId }
        ],
        'flags.isDeleted': false,
        'metadata.createdAt': {
          $gte: moment().subtract(7, 'days').toDate()
        }
      }).countDocuments();

      return {
        success: true,
        data: {
          userId,
          totalSent: sentMessages,
          totalReceived: receivedMessages,
          unreadCount: unreadMessages,
          recentActivity: recentMessages,
          accountCreated: user.metadata.createdAt,
          lastSeen: user.lastSeen,
          totalLogins: user.metadata.totalLogins
        }
      };

    } catch (error) {
      logger.error('Error getting chat statistics:', error, { userId });
      throw error;
    }
  }

  /**
   * Cleanup old messages (for maintenance)
   * @returns {Promise<number>} Number of messages cleaned up
   */
  async cleanupOldMessages() {
    try {
      const cutoffDate = moment().subtract(this.messageRetentionDays, 'days').toDate();

      const result = await Message.deleteMany({
        'metadata.createdAt': { $lt: cutoffDate },
        'flags.isDeleted': true
      });

      logger.info('Old messages cleanup completed', {
        deletedCount: result.deletedCount,
        retentionDays: this.messageRetentionDays,
        cutoffDate
      });

      return result.deletedCount;

    } catch (error) {
      logger.error('Error cleaning up old messages:', error);
      return 0;
    }
  }
}

// Create singleton instance
const chatService = new ChatService();

module.exports = chatService;
