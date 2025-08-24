/**
 * Main Server Application
 * Express server with WebSocket support, middleware setup, and error handling
 * 
 * @description Main entry point for the chat application backend
 * @author Chat App Team
 * @version 1.0.0
 */

require('express-async-errors'); // Handle async errors automatically
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

// Internal imports
const config = require('./config/config');
const databaseManager = require('./config/database');
const logger = require('./utils/logger');
const webSocketController = require('./websocket/websocketController');

// Middleware imports
const { 
  developmentErrorHandler, 
  productionErrorHandler, 
  notFoundHandler 
} = require('./middleware/errorHandler');

// Route imports
const authRoutes = require('./routes/authRoutes');
const chatRoutes = require('./routes/chatRoutes');

/**
 * Server Application Class
 * Manages the Express server, middleware, routes, and WebSocket setup
 */
class ChatServer {
  constructor() {
    this.app = express();
    this.server = http.createServer(this.app);
    this.io = null;
    this.isShuttingDown = false;
  }

  /**
   * Initialize the server with all middleware and routes
   */
  async initialize() {
    try {
      // Connect to database
      await databaseManager.connect();

      // Setup middleware
      this.setupSecurity();
      this.setupParsing();
      this.setupRateLimit();
      this.setupCORS();
      this.setupLogging();

      // Setup routes
      this.setupRoutes();

      // Setup WebSocket
      this.setupWebSocket();

      // Setup error handling
      this.setupErrorHandling();

      // Setup graceful shutdown
      this.setupGracefulShutdown();

      logger.info('🚀 Server initialized successfully', {
        environment: config.env,
        port: config.port,
        database: config.database.uri.replace(/\/\/.*@/, '//***:***@')
      });

    } catch (error) {
      logger.error('❌ Failed to initialize server:', error);
      process.exit(1);
    }
  }

  /**
   * Setup security middleware
   * @private
   */
  setupSecurity() {
    // Helmet for security headers
    this.app.use(helmet({
      contentSecurityPolicy: config.security.helmet.contentSecurityPolicy,
      hsts: config.security.helmet.hsts,
      crossOriginEmbedderPolicy: false // Disable for WebSocket compatibility
    }));

    // Trust proxy (for accurate IP addresses behind reverse proxy)
    this.app.set('trust proxy', 1);

    logger.info('✅ Security middleware configured');
  }

  /**
   * Setup parsing middleware
   * @private
   */
  setupParsing() {
    // Compression
    this.app.use(compression());

    // JSON parsing with size limit
    this.app.use(express.json({ 
      limit: '10mb',
      strict: true
    }));

    // URL encoded parsing
    this.app.use(express.urlencoded({ 
      extended: true, 
      limit: '10mb' 
    }));

    // Cookie parsing
    this.app.use(cookieParser(config.cookies.secret));

    logger.info('✅ Parsing middleware configured');
  }

  /**
   * Setup rate limiting
   * @private
   */
  setupRateLimit() {
    const globalRateLimit = rateLimit({
      windowMs: config.rateLimit.windowMs,
      max: config.rateLimit.max,
      message: config.rateLimit.message,
      standardHeaders: true,
      legacyHeaders: false,
      handler: (req, res) => {
        logger.warn('Rate limit exceeded', {
          ip: req.ip,
          path: req.path,
          userAgent: req.get('User-Agent')
        });
        res.status(429).json(config.rateLimit.message);
      }
    });

    this.app.use(globalRateLimit);
    logger.info('✅ Rate limiting configured', {
      windowMs: config.rateLimit.windowMs,
      maxRequests: config.rateLimit.max
    });
  }

  /**
   * Setup CORS
   * @private
   */
  setupCORS() {
    this.app.use(cors(config.cors));
    
    // Preflight for all routes
    this.app.options('*', cors(config.cors));

    logger.info('✅ CORS configured', {
      origins: config.cors.origin
    });
  }

  /**
   * Setup request logging
   * @private
   */
  setupLogging() {
    // Request ID middleware
    this.app.use((req, res, next) => {
      req.requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      res.setHeader('X-Request-ID', req.requestId);
      next();
    });

    // Request logging middleware
    this.app.use((req, res, next) => {
      const start = Date.now();
      
      res.on('finish', () => {
        const responseTime = Date.now() - start;
        logger.logRequest(req, res, responseTime);
      });
      
      next();
    });

    logger.info('✅ Request logging configured');
  }

  /**
   * Setup application routes
   * @private
   */
  setupRoutes() {
    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.status(200).json({
        success: true,
        message: 'Chat application server is healthy',
        data: {
          status: 'healthy',
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
          environment: config.env,
          version: require('../package.json').version,
          database: databaseManager.isHealthy() ? 'connected' : 'disconnected'
        }
      });
    });

    // API documentation endpoint
    this.app.get('/api', (req, res) => {
      res.status(200).json({
        success: true,
        message: 'Chat Application API',
        data: {
          version: '1.0.0',
          documentation: {
            authentication: '/api/auth',
            chat: '/api/chat',
            websocket: 'Connect to /socket.io for real-time features'
          },
          endpoints: {
            auth: {
              register: 'POST /api/auth/register',
              login: 'POST /api/auth/login',
              logout: 'POST /api/auth/logout',
              refresh: 'POST /api/auth/refresh',
              verifyPin: 'POST /api/auth/verify-pin',
              profile: 'GET /api/auth/me'
            },
            chat: {
              send: 'POST /api/chat/send',
              history: 'GET /api/chat/history/:userId',
              conversations: 'GET /api/chat/conversations',
              status: 'POST /api/chat/status',
              onlineUsers: 'GET /api/chat/online-users'
            }
          },
          timestamp: new Date().toISOString()
        }
      });
    });

    // Mount route modules
    this.app.use('/api/auth', authRoutes);
    this.app.use('/api/chat', chatRoutes);

    // 404 handler for API routes
    this.app.use('/api/*', notFoundHandler);

    // Root endpoint
    this.app.get('/', (req, res) => {
      res.status(200).json({
        success: true,
        message: 'Chat Application Backend API',
        data: {
          version: require('../package.json').version,
          environment: config.env,
          documentation: '/api',
          health: '/health',
          timestamp: new Date().toISOString()
        }
      });
    });

    logger.info('✅ Routes configured');
  }

  /**
   * Setup WebSocket server
   * @private
   */
  setupWebSocket() {
    this.io = webSocketController.initialize(this.server);
    
    logger.info('✅ WebSocket server configured', {
      path: '/socket.io',
      cors: config.websocket.corsOrigin
    });
  }

  /**
   * Setup error handling middleware
   * @private
   */
  setupErrorHandling() {
    // Handle 404 for non-API routes
    this.app.use('*', (req, res) => {
      res.status(404).json({
        success: false,
        message: `Route ${req.originalUrl} not found`,
        error: 'ROUTE_NOT_FOUND',
        data: {
          suggestion: 'Check /api for available endpoints',
          method: req.method,
          path: req.originalUrl
        },
        timestamp: new Date().toISOString()
      });
    });

    // Global error handler
    if (config.isDevelopment) {
      this.app.use(developmentErrorHandler);
    } else {
      this.app.use(productionErrorHandler);
    }

    logger.info('✅ Error handling configured');
  }

  /**
   * Setup graceful shutdown handlers
   * @private
   */
  setupGracefulShutdown() {
    const gracefulShutdown = async (signal) => {
      if (this.isShuttingDown) {
        logger.warn('Force shutdown initiated');
        process.exit(1);
      }

      this.isShuttingDown = true;
      logger.info(`📴 Received ${signal}. Starting graceful shutdown...`);

      try {
        // Stop accepting new connections
        this.server.close(() => {
          logger.info('✅ HTTP server closed');
        });

        // Close WebSocket connections
        if (this.io) {
          this.io.close(() => {
            logger.info('✅ WebSocket server closed');
          });
        }

        // Close database connection
        await databaseManager.disconnect();

        logger.info('✅ Graceful shutdown completed');
        process.exit(0);

      } catch (error) {
        logger.error('❌ Error during graceful shutdown:', error);
        process.exit(1);
      }
    };

    // Handle shutdown signals
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.error('💥 Uncaught Exception:', error);
      gracefulShutdown('UNCAUGHT_EXCEPTION');
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('💥 Unhandled Rejection:', { reason, promise });
      gracefulShutdown('UNHANDLED_REJECTION');
    });

    logger.info('✅ Graceful shutdown handlers configured');
  }

  /**
   * Start the server
   */
  async start() {
    try {
      await this.initialize();

      this.server.listen(config.port, () => {
        logger.info('🚀 Server started successfully', {
          port: config.port,
          environment: config.env,
          pid: process.pid,
          nodeVersion: process.version,
          platform: process.platform,
          memory: process.memoryUsage()
        });

        // Log server URLs
        const urls = [
          `http://localhost:${config.port}`,
          `http://localhost:${config.port}/api`,
          `http://localhost:${config.port}/health`
        ];

        logger.info('📍 Server URLs:', { urls });
      });

    } catch (error) {
      logger.error('❌ Failed to start server:', error);
      process.exit(1);
    }
  }

  /**
   * Get server instance
   * @returns {Object} Express app instance
   */
  getApp() {
    return this.app;
  }

  /**
   * Get HTTP server instance
   * @returns {Object} HTTP server instance
   */
  getServer() {
    return this.server;
  }

  /**
   * Get WebSocket instance
   * @returns {Object} Socket.IO instance
   */
  getIO() {
    return this.io;
  }
}

// Create and start server if this file is run directly
if (require.main === module) {
  const server = new ChatServer();
  server.start().catch((error) => {
    logger.error('💥 Failed to start server:', error);
    process.exit(1);
  });
}

module.exports = ChatServer;
