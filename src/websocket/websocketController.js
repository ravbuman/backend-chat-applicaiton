/**
 * WebSocket Controller
 * Real-time communication handler using Socket.IO
 * 
 * @description WebSocket event handlers for real-time chat functionality
 * @author Chat App Team
 * @version 1.0.0
 */

const jwt = require('jsonwebtoken');
const socketIO = require('socket.io');
const config = require('../config/config');
const logger = require('../utils/logger');
const authService = require('../services/authService');
const chatService = require('../services/chatService');
const sessionService = require('../services/sessionService');
const User = require('../models/userModel');

class WebSocketController {
  constructor() {
    this.io = null;
    this.connectedUsers = new Map(); // userId -> socket data
    this.userSockets = new Map(); // userId -> Set of socketIds
    this.socketUsers = new Map(); // socketId -> userId
    
    // Event types
    this.EVENTS = {
      CONNECTION: 'connection',
      DISCONNECT: 'disconnect',
      JOIN_ROOM: 'join-room',
      LEAVE_ROOM: 'leave-room',
      SEND_MESSAGE: 'send-message',
      MESSAGE_RECEIVED: 'message-received',
      MESSAGE_DELIVERED: 'message-delivered',
      MESSAGE_READ: 'message-read',
      TYPING_START: 'typing-start',
      TYPING_STOP: 'typing-stop',
      USER_STATUS: 'user-status',
      USER_ONLINE: 'user-online',
      USER_OFFLINE: 'user-offline',
      SESSION_WARNING: 'session-warning',
      SESSION_TIMEOUT: 'session-timeout',
      FORCE_LOGOUT: 'force-logout',
      ERROR: 'error'
    };
  }

  /**
   * Initialize WebSocket server
   * @param {Object} server - HTTP server instance
   * @returns {Object} Socket.IO instance
   */
  initialize(server) {
    this.io = socketIO(server, {
      cors: {
        origin: config.websocket.corsOrigin,
        methods: ['GET', 'POST'],
        credentials: true
      },
      pingTimeout: config.websocket.pingTimeout,
      pingInterval: config.websocket.pingInterval,
      transports: ['websocket', 'polling']
    });

    // Authentication middleware
    this.io.use(this.authenticateSocket.bind(this));

    // Connection handler
    this.io.on(this.EVENTS.CONNECTION, this.handleConnection.bind(this));

    // Start session monitoring
    this.startSessionMonitoring();

    logger.info('WebSocket server initialized', {
      corsOrigin: config.websocket.corsOrigin,
      pingTimeout: config.websocket.pingTimeout,
      pingInterval: config.websocket.pingInterval
    });

    return this.io;
  }

  /**
   * Authenticate WebSocket connection
   * @param {Object} socket - Socket.IO socket
   * @param {Function} next - Next middleware
   */
  async authenticateSocket(socket, next) {
    try {
      const token = socket.handshake.auth.token || 
                   socket.handshake.headers.authorization?.replace('Bearer ', '');

      if (!token) {
        return next(new Error('Authentication token required'));
      }

      // Verify access token
      const { user, decoded } = await authService.verifyAccessToken(token);

      if (!user.isActive || user.isAccountLocked) {
        return next(new Error('Account is not accessible'));
      }

      // Attach user data to socket
      socket.userId = user._id.toString();
      socket.user = user;
      socket.decodedToken = decoded;

      logger.info('Socket authenticated', {
        socketId: socket.id,
        userId: user._id,
        phoneNumber: user.phoneNumber
      });

      next();

    } catch (error) {
      logger.warn('Socket authentication failed:', {
        socketId: socket.id,
        error: error.message,
        ip: socket.handshake.address
      });
      next(new Error('Authentication failed'));
    }
  }

  /**
   * Handle new WebSocket connection
   * @param {Object} socket - Socket.IO socket
   */
  async handleConnection(socket) {
    const userId = socket.userId;
    const user = socket.user;

    try {
      // Track connection
      await this.trackUserConnection(userId, socket);

      // Set user online
      await user.setOnline({
        userAgent: socket.handshake.headers['user-agent'],
        ipAddress: socket.handshake.address,
        platform: socket.handshake.query.platform || 'web'
      });

      // Update session activity
      await sessionService.trackActivity(userId, {
        socketId: socket.id,
        userAgent: socket.handshake.headers['user-agent'],
        ipAddress: socket.handshake.address,
        platform: socket.handshake.query.platform || 'web'
      });

      // Join personal room
      socket.join(`user:${userId}`);

      // Notify other users that this user is online
      socket.broadcast.emit(this.EVENTS.USER_ONLINE, {
        userId,
        phoneNumber: user.phoneNumber,
        profile: user.profile,
        timestamp: new Date().toISOString()
      });

      // Send online users list to newly connected user
      const onlineUsers = await chatService.getOnlineUsers(userId);
      socket.emit('online-users', onlineUsers.data);

      logger.info('User connected via WebSocket', {
        socketId: socket.id,
        userId,
        phoneNumber: user.phoneNumber,
        totalConnections: this.connectedUsers.size
      });

      // Set up event handlers
      this.setupEventHandlers(socket);

    } catch (error) {
      logger.error('Error handling WebSocket connection:', error, {
        socketId: socket.id,
        userId
      });
      socket.emit(this.EVENTS.ERROR, {
        message: 'Connection setup failed',
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Setup event handlers for socket
   * @param {Object} socket - Socket.IO socket
   */
  setupEventHandlers(socket) {
    const userId = socket.userId;

    // Join chat room
    socket.on(this.EVENTS.JOIN_ROOM, async (data) => {
      await this.handleJoinRoom(socket, data);
    });

    // Leave chat room
    socket.on(this.EVENTS.LEAVE_ROOM, async (data) => {
      await this.handleLeaveRoom(socket, data);
    });

    // Send message
    socket.on(this.EVENTS.SEND_MESSAGE, async (data) => {
      await this.handleSendMessage(socket, data);
    });

    // Message delivered
    socket.on(this.EVENTS.MESSAGE_DELIVERED, async (data) => {
      await this.handleMessageDelivered(socket, data);
    });

    // Message read
    socket.on(this.EVENTS.MESSAGE_READ, async (data) => {
      await this.handleMessageRead(socket, data);
    });

    // Typing indicators
    socket.on(this.EVENTS.TYPING_START, (data) => {
      this.handleTypingStart(socket, data);
    });

    socket.on(this.EVENTS.TYPING_STOP, (data) => {
      this.handleTypingStop(socket, data);
    });

    // User status update
    socket.on(this.EVENTS.USER_STATUS, async (data) => {
      await this.handleUserStatus(socket, data);
    });

    // Disconnect handler
    socket.on(this.EVENTS.DISCONNECT, async (reason) => {
      await this.handleDisconnection(socket, reason);
    });

    // Error handler
    socket.on('error', (error) => {
      logger.error('Socket error:', error, {
        socketId: socket.id,
        userId
      });
    });
  }

  /**
   * Handle join chat room
   * @param {Object} socket - Socket.IO socket
   * @param {Object} data - Room data
   */
  async handleJoinRoom(socket, data) {
    try {
      const { roomId, roomType = 'user' } = data;
      const userId = socket.userId;

      if (!roomId) {
        socket.emit(this.EVENTS.ERROR, {
          message: 'Room ID is required',
          timestamp: new Date().toISOString()
        });
        return;
      }

      const roomName = `${roomType}:${roomId}`;
      socket.join(roomName);

      // Track activity
      await sessionService.trackActivity(userId, { socketId: socket.id });

      logger.debug('User joined room', {
        socketId: socket.id,
        userId,
        roomId,
        roomType
      });

      socket.emit('room-joined', {
        roomId,
        roomType,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Error joining room:', error, {
        socketId: socket.id,
        userId: socket.userId
      });
      socket.emit(this.EVENTS.ERROR, {
        message: 'Failed to join room',
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Handle leave chat room
   * @param {Object} socket - Socket.IO socket
   * @param {Object} data - Room data
   */
  async handleLeaveRoom(socket, data) {
    try {
      const { roomId, roomType = 'user' } = data;
      const userId = socket.userId;

      if (!roomId) {
        socket.emit(this.EVENTS.ERROR, {
          message: 'Room ID is required',
          timestamp: new Date().toISOString()
        });
        return;
      }

      const roomName = `${roomType}:${roomId}`;
      socket.leave(roomName);

      logger.debug('User left room', {
        socketId: socket.id,
        userId,
        roomId,
        roomType
      });

      socket.emit('room-left', {
        roomId,
        roomType,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Error leaving room:', error, {
        socketId: socket.id,
        userId: socket.userId
      });
    }
  }

  /**
   * Handle send message via WebSocket
   * @param {Object} socket - Socket.IO socket
   * @param {Object} data - Message data
   */
  async handleSendMessage(socket, data) {
    try {
      const { receiverId, groupId, content, messageType = 'text' } = data;
      const senderId = socket.userId;

      // Track activity
      await sessionService.trackActivity(senderId, { socketId: socket.id });

      // Send message using chat service
      const result = await chatService.sendMessage(
        senderId,
        receiverId,
        groupId,
        content,
        messageType,
        {
          platform: 'websocket',
          userAgent: socket.handshake.headers['user-agent'],
          ipAddress: socket.handshake.address
        }
      );

      const message = result.data;

      // Emit to sender
      socket.emit(this.EVENTS.MESSAGE_RECEIVED, {
        message,
        status: 'sent',
        timestamp: new Date().toISOString()
      });

      // Emit to receiver or group
      if (receiverId) {
        // One-to-one message
        this.io.to(`user:${receiverId}`).emit(this.EVENTS.MESSAGE_RECEIVED, {
          message,
          status: 'delivered',
          timestamp: new Date().toISOString()
        });
      } else if (groupId) {
        // Group message
        socket.to(`group:${groupId}`).emit(this.EVENTS.MESSAGE_RECEIVED, {
          message,
          status: 'delivered',
          timestamp: new Date().toISOString()
        });
      }

      logger.info('Message sent via WebSocket', {
        messageId: message.messageId,
        senderId,
        receiverId,
        groupId,
        contentLength: content.length
      });

    } catch (error) {
      logger.error('Error sending message via WebSocket:', error, {
        socketId: socket.id,
        userId: socket.userId
      });
      socket.emit(this.EVENTS.ERROR, {
        message: 'Failed to send message',
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Handle message delivered
   * @param {Object} socket - Socket.IO socket
   * @param {Object} data - Message data
   */
  async handleMessageDelivered(socket, data) {
    try {
      const { messageId, senderId } = data;
      const userId = socket.userId;

      if (!messageId || !senderId) {
        return;
      }

      // Track activity
      await sessionService.trackActivity(userId, { socketId: socket.id });

      // Notify sender that message was delivered
      this.io.to(`user:${senderId}`).emit(this.EVENTS.MESSAGE_DELIVERED, {
        messageId,
        deliveredBy: userId,
        timestamp: new Date().toISOString()
      });

      logger.debug('Message delivery confirmed', {
        messageId,
        senderId,
        deliveredBy: userId
      });

    } catch (error) {
      logger.error('Error handling message delivered:', error);
    }
  }

  /**
   * Handle message read
   * @param {Object} socket - Socket.IO socket
   * @param {Object} data - Message data
   */
  async handleMessageRead(socket, data) {
    try {
      const { senderId } = data;
      const receiverId = socket.userId;

      if (!senderId) {
        return;
      }

      // Track activity
      await sessionService.trackActivity(receiverId, { socketId: socket.id });

      // Mark messages as read
      const result = await chatService.markMessagesAsRead(senderId, receiverId);

      // Notify sender that messages were read
      this.io.to(`user:${senderId}`).emit(this.EVENTS.MESSAGE_READ, {
        readBy: receiverId,
        markedCount: result.markedCount,
        timestamp: new Date().toISOString()
      });

      logger.debug('Messages marked as read via WebSocket', {
        senderId,
        readBy: receiverId,
        markedCount: result.markedCount
      });

    } catch (error) {
      logger.error('Error handling message read:', error);
    }
  }

  /**
   * Handle typing start
   * @param {Object} socket - Socket.IO socket
   * @param {Object} data - Typing data
   */
  handleTypingStart(socket, data) {
    try {
      const { receiverId, groupId } = data;
      const userId = socket.userId;
      const user = socket.user;

      const typingData = {
        userId,
        phoneNumber: user.phoneNumber,
        displayName: user.profile?.displayName,
        timestamp: new Date().toISOString()
      };

      if (receiverId) {
        // One-to-one typing
        this.io.to(`user:${receiverId}`).emit(this.EVENTS.TYPING_START, typingData);
      } else if (groupId) {
        // Group typing
        socket.to(`group:${groupId}`).emit(this.EVENTS.TYPING_START, typingData);
      }

      logger.debug('Typing started', { userId, receiverId, groupId });

    } catch (error) {
      logger.error('Error handling typing start:', error);
    }
  }

  /**
   * Handle typing stop
   * @param {Object} socket - Socket.IO socket
   * @param {Object} data - Typing data
   */
  handleTypingStop(socket, data) {
    try {
      const { receiverId, groupId } = data;
      const userId = socket.userId;

      const typingData = {
        userId,
        timestamp: new Date().toISOString()
      };

      if (receiverId) {
        // One-to-one typing
        this.io.to(`user:${receiverId}`).emit(this.EVENTS.TYPING_STOP, typingData);
      } else if (groupId) {
        // Group typing
        socket.to(`group:${groupId}`).emit(this.EVENTS.TYPING_STOP, typingData);
      }

      logger.debug('Typing stopped', { userId, receiverId, groupId });

    } catch (error) {
      logger.error('Error handling typing stop:', error);
    }
  }

  /**
   * Handle user status update
   * @param {Object} socket - Socket.IO socket
   * @param {Object} data - Status data
   */
  async handleUserStatus(socket, data) {
    try {
      const { status } = data;
      const userId = socket.userId;

      if (!status) {
        socket.emit(this.EVENTS.ERROR, {
          message: 'Status is required',
          timestamp: new Date().toISOString()
        });
        return;
      }

      // Track activity
      await sessionService.trackActivity(userId, { socketId: socket.id });

      // Update status
      await chatService.updateUserStatus(userId, status, {
        socketId: socket.id,
        platform: 'websocket'
      });

      // Broadcast status change
      socket.broadcast.emit(this.EVENTS.USER_STATUS, {
        userId,
        status,
        timestamp: new Date().toISOString()
      });

      logger.info('User status updated via WebSocket', {
        userId,
        status
      });

    } catch (error) {
      logger.error('Error updating user status:', error);
      socket.emit(this.EVENTS.ERROR, {
        message: 'Failed to update status',
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Handle user disconnection
   * @param {Object} socket - Socket.IO socket
   * @param {string} reason - Disconnect reason
   */
  async handleDisconnection(socket, reason) {
    const userId = socket.userId;
    const user = socket.user;

    try {
      // Remove from tracking
      await this.removeUserConnection(userId, socket.id);

      // Check if user has other active connections
      const userSockets = this.userSockets.get(userId);
      const hasOtherConnections = userSockets && userSockets.size > 0;

      if (!hasOtherConnections) {
        // Set user offline if no other connections
        if (user) {
          await user.setOffline();
        }

        // End session
        await sessionService.endSession(userId, 'disconnect');

        // Notify other users
        socket.broadcast.emit(this.EVENTS.USER_OFFLINE, {
          userId,
          phoneNumber: user?.phoneNumber,
          timestamp: new Date().toISOString()
        });
      }

      logger.info('User disconnected from WebSocket', {
        socketId: socket.id,
        userId,
        phoneNumber: user?.phoneNumber,
        reason,
        hasOtherConnections,
        totalConnections: this.connectedUsers.size
      });

    } catch (error) {
      logger.error('Error handling disconnection:', error, {
        socketId: socket.id,
        userId,
        reason
      });
    }
  }

  /**
   * Track user connection
   * @param {string} userId - User ID
   * @param {Object} socket - Socket.IO socket
   * @private
   */
  async trackUserConnection(userId, socket) {
    // Add to connected users
    this.connectedUsers.set(socket.id, {
      userId,
      socketId: socket.id,
      connectedAt: new Date(),
      lastActivity: new Date()
    });

    // Track user sockets
    if (!this.userSockets.has(userId)) {
      this.userSockets.set(userId, new Set());
    }
    this.userSockets.get(userId).add(socket.id);

    // Track socket users
    this.socketUsers.set(socket.id, userId);

    // Update session service
    sessionService.updateSocketId(userId, socket.id);
  }

  /**
   * Remove user connection
   * @param {string} userId - User ID
   * @param {string} socketId - Socket ID
   * @private
   */
  async removeUserConnection(userId, socketId) {
    // Remove from connected users
    this.connectedUsers.delete(socketId);

    // Remove from user sockets
    const userSockets = this.userSockets.get(userId);
    if (userSockets) {
      userSockets.delete(socketId);
      if (userSockets.size === 0) {
        this.userSockets.delete(userId);
      }
    }

    // Remove from socket users
    this.socketUsers.delete(socketId);

    // Update session service
    sessionService.removeSocketId(userId);
  }

  /**
   * Start session monitoring for timeouts and warnings
   * @private
   */
  startSessionMonitoring() {
    setInterval(() => {
      this.checkSessionTimeouts();
    }, 60 * 1000); // Check every minute

    logger.info('Session monitoring started');
  }

  /**
   * Check for session timeouts and warnings
   * @private
   */
  async checkSessionTimeouts() {
    try {
      // Check for users needing timeout warning
      const warningUsers = sessionService.getUsersNeedingTimeoutWarning();
      for (const userInfo of warningUsers) {
        if (userInfo.socketId) {
          this.io.to(userInfo.socketId).emit(this.EVENTS.SESSION_WARNING, {
            minutesUntilTimeout: userInfo.minutesUntilTimeout,
            timestamp: new Date().toISOString()
          });
        }
      }

      // Check for timed out users
      const timedOutUsers = sessionService.getTimedOutUsers();
      for (const userInfo of timedOutUsers) {
        if (userInfo.socketId) {
          this.io.to(userInfo.socketId).emit(this.EVENTS.SESSION_TIMEOUT, {
            message: 'Your session has expired due to inactivity',
            timestamp: new Date().toISOString()
          });
        }
        
        // Handle session timeout
        await sessionService.handleSessionTimeout(userInfo.userId);
      }

    } catch (error) {
      logger.error('Error checking session timeouts:', error);
    }
  }

  /**
   * Get WebSocket statistics
   * @returns {Object} WebSocket statistics
   */
  getStatistics() {
    return {
      totalConnections: this.connectedUsers.size,
      uniqueUsers: this.userSockets.size,
      averageConnectionsPerUser: this.userSockets.size > 0 ? 
        this.connectedUsers.size / this.userSockets.size : 0,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Broadcast to all connected users
   * @param {string} event - Event name
   * @param {Object} data - Event data
   */
  broadcast(event, data) {
    this.io.emit(event, data);
  }

  /**
   * Send to specific user
   * @param {string} userId - User ID
   * @param {string} event - Event name
   * @param {Object} data - Event data
   */
  sendToUser(userId, event, data) {
    this.io.to(`user:${userId}`).emit(event, data);
  }

  /**
   * Force logout user (disconnect all sockets)
   * @param {string} userId - User ID
   * @param {string} reason - Logout reason
   */
  async forceLogoutUser(userId, reason = 'admin_action') {
    const userSockets = this.userSockets.get(userId);
    if (userSockets) {
      for (const socketId of userSockets) {
        const socket = this.io.sockets.sockets.get(socketId);
        if (socket) {
          socket.emit(this.EVENTS.FORCE_LOGOUT, {
            reason,
            timestamp: new Date().toISOString()
          });
          socket.disconnect(true);
        }
      }
    }

    logger.info('User force logged out', { userId, reason });
  }
}

// Create singleton instance
const webSocketController = new WebSocketController();

module.exports = webSocketController;
