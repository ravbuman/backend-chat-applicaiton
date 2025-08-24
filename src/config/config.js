/**
 * Application Configuration
 * Centralized configuration management following industry best practices
 * 
 * @description Configuration loader with environment validation
 * @author Chat App Team
 * @version 1.0.0
 */

const dotenv = require('dotenv');
const joi = require('joi');

// Load environment variables
dotenv.config();

/**
 * Environment validation schema
 * Ensures all required environment variables are present and valid
 */
const envSchema = joi.object({
  NODE_ENV: joi.string().valid('development', 'production', 'test').default('development'),
  PORT: joi.number().default(5000),
  
  // Database Configuration
  MONGODB_URI: joi.string().required(),
  MONGODB_TEST_URI: joi.string().when('NODE_ENV', {
    is: 'test',
    then: joi.required(),
    otherwise: joi.optional()
  }),
  
  // JWT Configuration
  JWT_SECRET: joi.string().min(32).required(),
  JWT_EXPIRE: joi.string().default('24h'),
  JWT_REFRESH_SECRET: joi.string().min(32).required(),
  JWT_REFRESH_EXPIRE: joi.string().default('7d'),
  
  // Cookie Configuration
  COOKIE_SECRET: joi.string().min(32).required(),
  COOKIE_DOMAIN: joi.string().default('localhost'),
  COOKIE_SECURE: joi.boolean().default(false),
  
  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: joi.number().default(900000), // 15 minutes
  RATE_LIMIT_MAX_REQUESTS: joi.number().default(100),
  
  // Session Configuration
  SESSION_TIMEOUT_MINUTES: joi.number().default(5),
  PIN_RETRY_LIMIT: joi.number().default(5),
  PIN_RETRY_WINDOW_MINUTES: joi.number().default(15),
  
  // CORS Configuration
  CORS_ORIGIN: joi.string().default('http://localhost:3000'),
  
  // Logging Configuration
  LOG_LEVEL: joi.string().valid('error', 'warn', 'info', 'debug').default('info'),
  LOG_FILE: joi.string().default('logs/app.log'),
  
  // WebSocket Configuration
  WS_CORS_ORIGIN: joi.string().default('http://localhost:3000'),
  WS_HEARTBEAT_INTERVAL: joi.number().default(25000),
  WS_HEARTBEAT_TIMEOUT: joi.number().default(60000)
}).unknown();

/**
 * Validate environment variables
 */
const { error, value: envVars } = envSchema.validate(process.env);

if (error) {
  throw new Error(`Config validation error: ${error.message}`);
}

/**
 * Application configuration object
 */
const config = {
  // Environment
  env: envVars.NODE_ENV,
  port: envVars.PORT,
  isDevelopment: envVars.NODE_ENV === 'development',
  isProduction: envVars.NODE_ENV === 'production',
  isTest: envVars.NODE_ENV === 'test',
  
  // Database
  database: {
    uri: envVars.NODE_ENV === 'test' ? envVars.MONGODB_TEST_URI : envVars.MONGODB_URI,
    options: {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 10000,
      heartbeatFrequencyMS: 30000,
      maxIdleTimeMS: 30000,
      retryWrites: true,
      writeConcern: {
        w: 'majority'
      }
    }
  },
  
  // JWT
  jwt: {
    secret: envVars.JWT_SECRET,
    expire: envVars.JWT_EXPIRE,
    refreshSecret: envVars.JWT_REFRESH_SECRET,
    refreshExpire: envVars.JWT_REFRESH_EXPIRE,
    algorithm: 'HS256'
  },
  
  // Cookies
  cookies: {
    secret: envVars.COOKIE_SECRET,
    domain: envVars.COOKIE_DOMAIN,
    secure: envVars.COOKIE_SECURE,
    httpOnly: true,
    sameSite: 'strict',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  },
  
  // Rate Limiting
  rateLimit: {
    windowMs: envVars.RATE_LIMIT_WINDOW_MS,
    max: envVars.RATE_LIMIT_MAX_REQUESTS,
    message: {
      error: 'Too many requests from this IP, please try again later.'
    }
  },
  
  // Session Management
  session: {
    timeoutMinutes: envVars.SESSION_TIMEOUT_MINUTES,
    pinRetryLimit: envVars.PIN_RETRY_LIMIT,
    pinRetryWindowMinutes: envVars.PIN_RETRY_WINDOW_MINUTES
  },
  
  // CORS
  cors: {
    origin: envVars.CORS_ORIGIN.split(','),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
  },
  
  // Logging
  logging: {
    level: envVars.LOG_LEVEL,
    file: envVars.LOG_FILE,
    format: envVars.NODE_ENV === 'production' ? 'json' : 'simple'
  },
  
  // WebSocket
  websocket: {
    corsOrigin: envVars.WS_CORS_ORIGIN.split(','),
    heartbeatInterval: envVars.WS_HEARTBEAT_INTERVAL,
    heartbeatTimeout: envVars.WS_HEARTBEAT_TIMEOUT,
    pingTimeout: 60000,
    pingInterval: 25000
  },
  
  // Security Headers
  security: {
    helmet: {
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"]
        }
      },
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
      }
    }
  }
};

module.exports = config;
