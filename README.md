# Chat Application Backend

Enterprise-grade real-time chat application backend built with Node.js, Express, MongoDB, and Socket.IO following strict 3-tier architecture patterns.

## 🏗️ Architecture

### 3-Tier Architecture
- **Presentation Layer (Controllers)**: HTTP request handlers and WebSocket event management
- **Business Logic Layer (Services)**: Core business logic, authentication, and validation
- **Data Access Layer (Models)**: Database operations and data modeling

### Tech Stack
- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **Database**: MongoDB with Mongoose ODM
- **Real-time**: Socket.IO
- **Authentication**: JWT with HttpOnly cookies
- **Validation**: Joi
- **Logging**: Winston
- **Security**: Helmet, CORS, Rate limiting

## 🚀 Features

### Authentication & Security
- Phone number + 4-digit PIN authentication
- JWT-based session management with refresh tokens
- Session timeout handling (5 minutes inactivity)
- Account lockout protection
- Rate limiting and security headers
- Input validation and sanitization

### Real-time Chat
- One-to-one messaging
- Group chat support (ready for implementation)
- Message delivery and read receipts
- Typing indicators
- Online/offline status tracking
- Message history and pagination

### Enterprise Features
- Comprehensive logging and monitoring
- Error handling and validation
- Database connection pooling
- Graceful shutdown handling
- Health check endpoints
- Request tracing

## 📁 Project Structure

```
backend/
├── src/
│   ├── config/          # Configuration and database setup
│   │   ├── config.js    # Environment configuration
│   │   └── database.js  # MongoDB connection manager
│   ├── controllers/     # Presentation layer
│   │   ├── authController.js
│   │   └── chatController.js
│   ├── services/        # Business logic layer
│   │   ├── authService.js
│   │   ├── chatService.js
│   │   └── sessionService.js
│   ├── models/          # Data access layer
│   │   ├── userModel.js
│   │   └── messageModel.js
│   ├── middleware/      # Express middleware
│   │   ├── authMiddleware.js
│   │   └── errorHandler.js
│   ├── routes/          # Route definitions
│   │   ├── authRoutes.js
│   │   └── chatRoutes.js
│   ├── websocket/       # WebSocket handling
│   │   └── websocketController.js
│   ├── utils/           # Utilities
│   │   ├── logger.js
│   │   └── validator.js
│   └── server.js        # Main server file
├── logs/                # Log files
├── package.json
├── .env                 # Environment variables
├── .env.example         # Environment template
└── README.md
```

## 🛠️ Installation & Setup

### Prerequisites
- Node.js 18+ 
- MongoDB 4.4+
- npm or yarn

### 1. Install Dependencies
```bash
npm install
```

### 2. Environment Setup
```bash
# Copy environment template
cp .env.example .env

# Edit .env file with your configuration
# IMPORTANT: Change all secret keys in production!
```

### 3. Start MongoDB
```bash
# Make sure MongoDB is running
mongod

# Or if using MongoDB service
sudo systemctl start mongod
```

### 4. Start the Server

#### Development Mode
```bash
npm run dev
```

#### Production Mode
```bash
npm start
```

## 🔧 Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `NODE_ENV` | Environment (development/production) | development | No |
| `PORT` | Server port | 5000 | No |
| `MONGODB_URI` | MongoDB connection string | - | Yes |
| `JWT_SECRET` | JWT secret key (min 32 chars) | - | Yes |
| `JWT_REFRESH_SECRET` | Refresh token secret | - | Yes |
| `COOKIE_SECRET` | Cookie signing secret | - | Yes |
| `CORS_ORIGIN` | Allowed CORS origins | https://chat-app-ravi.vercel.app | No |
| `SESSION_TIMEOUT_MINUTES` | Session timeout | 5 | No |

## 📡 API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - User login
- `POST /api/auth/logout` - User logout
- `POST /api/auth/refresh` - Refresh access token
- `POST /api/auth/verify-pin` - Verify PIN for session continuation
- `GET /api/auth/me` - Get current user profile
- `GET /api/auth/session-status` - Check session status

### Chat
- `POST /api/chat/send` - Send message
- `GET /api/chat/history/:userId` - Get chat history
- `POST /api/chat/mark-read` - Mark messages as read
- `GET /api/chat/conversations` - Get recent conversations
- `GET /api/chat/unread-count` - Get unread message count
- `POST /api/chat/status` - Update user status
- `GET /api/chat/online-users` - Get online users
- `GET /api/chat/search-users` - Search users
- `DELETE /api/chat/message/:messageId` - Delete message

### Monitoring
- `GET /health` - Server health check
- `GET /api` - API documentation

## 🔌 WebSocket Events

### Client → Server
- `join-room` - Join chat room
- `send-message` - Send message
- `typing-start` - Start typing indicator
- `typing-stop` - Stop typing indicator
- `user-status` - Update user status

### Server → Client
- `message-received` - New message received
- `message-delivered` - Message delivery confirmation
- `message-read` - Message read confirmation
- `user-online` - User came online
- `user-offline` - User went offline
- `typing-start` - User started typing
- `typing-stop` - User stopped typing
- `session-warning` - Session timeout warning
- `session-timeout` - Session expired

## 🔒 Security Features

### Authentication
- JWT tokens with secure HttpOnly cookies
- Refresh token rotation
- Session timeout after 5 minutes of inactivity
- Account lockout after 5 failed PIN attempts
- PIN retry window protection

### Input Validation
- Joi schema validation for all inputs
- Phone number format validation
- Message content sanitization
- SQL injection prevention
- XSS protection

### Rate Limiting
- Global rate limiting per IP
- User-specific rate limiting
- Authentication endpoint protection
- Message sending limits

## 🧪 Testing

```bash
# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Run linting
npm run lint

# Fix linting issues
npm run lint:fix
```

## 📊 Monitoring & Logging

### Logging Levels
- `error` - Error conditions
- `warn` - Warning conditions
- `info` - Informational messages
- `debug` - Debug-level messages

### Log Files
- `logs/app.log` - General application logs
- `logs/error.log` - Error-specific logs

### Monitoring
- Health check endpoint: `GET /health`
- Session statistics: `GET /api/auth/stats`
- Chat statistics: `GET /api/chat/statistics`

## 🚀 Deployment

### Production Checklist
- [ ] Update all secret keys in `.env`
- [ ] Set `NODE_ENV=production`
- [ ] Configure proper MongoDB connection
- [ ] Set up SSL/TLS certificates
- [ ] Configure reverse proxy (nginx/Apache)
- [ ] Set up log rotation
- [ ] Configure monitoring and alerting
- [ ] Set proper CORS origins
- [ ] Enable security headers

### Docker Deployment
```bash
# Build Docker image
docker build -t chat-app-backend .

# Run container
docker run -p 5000:5000 --env-file .env chat-app-backend
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## 📝 License

This project is licensed under the MIT License.

## 🆘 Support

For support and questions:
- Check the logs: `tail -f logs/app.log`
- Health check: `curl http://localhost:5000/health`
- API documentation: `curl http://localhost:5000/api`

## 🔄 Version History

### v1.0.0
- Initial release
- Phone + PIN authentication
- Real-time messaging
- Session management
- Enterprise security features
