/**
 * Database Connection Manager
 * MongoDB connection with connection pooling, error handling, and monitoring
 * 
 * @description Enterprise-grade database connection management
 * @author Chat App Team
 * @version 1.0.0
 */

const mongoose = require('mongoose');
const dotenv = require('dotenv');
const config = require('../config/config');
const logger = require('../utils/logger');
dotenv.config();

class DatabaseManager {
  constructor() {
    this.isConnected = false;
    this.connectionAttempts = 0;
    this.maxRetryAttempts = 5;
    this.retryDelay = 5000; // 5 seconds
  }

  /**
   * Initialize database connection
   * @returns {Promise<void>}
   */
  async connect() {
    try {
      // Set mongoose options for better performance and reliability
      mongoose.set('strictQuery', false);
      
      // Connection event handlers
      this.setupEventHandlers();
      
      // Connect to MongoDB
      await mongoose.connect(config.database.uri, config.database.options);
      
      this.isConnected = true;
      this.connectionAttempts = 0;
      
      logger.info('✅ Database connected successfully', {
        uri: this.getMaskedUri(config.database.uri),
        environment: config.env
      });
      
    } catch (error) {
      this.handleConnectionError(error);
    }
  }

  /**
   * Setup mongoose event handlers
   * @private
   */
  setupEventHandlers() {
    mongoose.connection.on('connected', () => {
      this.isConnected = true;
      logger.info('🔗 Database connection established');
    });

    mongoose.connection.on('error', (error) => {
      this.isConnected = false;
      logger.error('❌ Database connection error:', error);
    });

    mongoose.connection.on('disconnected', () => {
      this.isConnected = false;
      logger.warn('⚠️ Database disconnected');
      
      // Attempt to reconnect if not in test environment
      if (!config.isTest) {
        this.handleReconnection();
      }
    });

    mongoose.connection.on('reconnected', () => {
      this.isConnected = true;
      logger.info('🔄 Database reconnected');
    });

    // Handle process termination
    process.on('SIGINT', () => {
      this.gracefulShutdown('SIGINT');
    });

    process.on('SIGTERM', () => {
      this.gracefulShutdown('SIGTERM');
    });
  }

  /**
   * Handle connection errors with retry logic
   * @param {Error} error 
   * @private
   */
  async handleConnectionError(error) {
    this.connectionAttempts++;
    this.isConnected = false;
    
    logger.error(`❌ Database connection failed (attempt ${this.connectionAttempts}/${this.maxRetryAttempts}):`, {
      error: error.message,
      stack: error.stack
    });

    if (this.connectionAttempts < this.maxRetryAttempts) {
      logger.info(`🔄 Retrying database connection in ${this.retryDelay / 1000} seconds...`);
      
      setTimeout(() => {
        this.connect();
      }, this.retryDelay);
      
      // Exponential backoff
      this.retryDelay *= 1.5;
    } else {
      logger.error('💥 Maximum database connection attempts exceeded. Exiting...');
      process.exit(1);
    }
  }

  /**
   * Handle reconnection attempts
   * @private
   */
  async handleReconnection() {
    if (!this.isConnected && this.connectionAttempts < this.maxRetryAttempts) {
      setTimeout(() => {
        logger.info('🔄 Attempting to reconnect to database...');
        this.connect();
      }, this.retryDelay);
    }
  }

  /**
   * Graceful shutdown of database connection
   * @param {string} signal 
   * @private
   */
  async gracefulShutdown(signal) {
    logger.info(`📴 Received ${signal}. Closing database connection...`);
    
    try {
      await mongoose.connection.close();
      logger.info('✅ Database connection closed successfully');
      process.exit(0);
    } catch (error) {
      logger.error('❌ Error during database shutdown:', error);
      process.exit(1);
    }
  }

  /**
   * Check if database is connected
   * @returns {boolean}
   */
  isHealthy() {
    return this.isConnected && mongoose.connection.readyState === 1;
  }

  /**
   * Get database connection statistics
   * @returns {Object}
   */
  getStats() {
    const state = mongoose.connection.readyState;
    const stateMap = {
      0: 'disconnected',
      1: 'connected',
      2: 'connecting',
      3: 'disconnecting'
    };

    return {
      state: stateMap[state] || 'unknown',
      host: mongoose.connection.host,
      port: mongoose.connection.port,
      name: mongoose.connection.name,
      collections: Object.keys(mongoose.connection.collections).length,
      models: Object.keys(mongoose.models).length
    };
  }

  /**
   * Mask sensitive information in URI
   * @param {string} uri 
   * @returns {string}
   * @private
   */
  getMaskedUri(uri) {
    return uri.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@');
  }

  /**
   * Disconnect from database (mainly for testing)
   * @returns {Promise<void>}
   */
  async disconnect() {
    if (this.isConnected) {
      await mongoose.connection.close();
      this.isConnected = false;
      logger.info('📴 Database connection closed');
    }
  }

  /**
   * Clear database (for testing purposes)
   * @returns {Promise<void>}
   */
  async clearDatabase() {
    if (!config.isTest) {
      throw new Error('Database clearing is only allowed in test environment');
    }

    const collections = mongoose.connection.collections;
    
    for (const key in collections) {
      const collection = collections[key];
      await collection.deleteMany({});
    }
    
    logger.info('🧹 Test database cleared');
  }
}

// Create singleton instance
const databaseManager = new DatabaseManager();

module.exports = databaseManager;
