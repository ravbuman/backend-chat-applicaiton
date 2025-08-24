# REST Client Test Suite Documentation

This directory contains comprehensive HTTP test files for the Chat Application backend API. All tests use hardcoded `localhost:5000` URLs for easy testing without variables.

## Test Files Overview

### 01-health.http
- **Purpose**: Server health and system status monitoring
- **Tests**: Basic connectivity, database status, server uptime
- **Usage**: Run first to verify server is operational

### 02-authentication.http
- **Purpose**: Complete authentication flow testing
- **Tests**: Registration, login, logout, token refresh, session management
- **Coverage**: Valid scenarios, error cases, edge conditions
- **Key Features**: JWT token handling, PIN verification, phone number validation

### 03-chat.http
- **Purpose**: Core chat functionality testing
- **Tests**: Message sending, receiving, history, search, status updates
- **Coverage**: Text messages, message marking, user search, online status
- **Key Features**: Real-time messaging endpoints, conversation management

### 04-rate-limits.http
- **Purpose**: Rate limiting and abuse prevention testing
- **Tests**: Login attempts, message sending limits, API throttling
- **Coverage**: Burst limits, sustained rate limits, recovery testing
- **Key Features**: Tests protection mechanisms

### 05-error-handling.http
- **Purpose**: Error response and validation testing
- **Tests**: Invalid inputs, malformed requests, missing fields
- **Coverage**: Input validation, error messages, HTTP status codes
- **Key Features**: Comprehensive error scenario coverage

### 06-security.http
- **Purpose**: Security vulnerability testing
- **Tests**: SQL injection, XSS, unauthorized access, token manipulation
- **Coverage**: Authentication bypass, data exposure, input sanitization
- **Key Features**: Penetration testing scenarios

### 07-websocket.http
- **Purpose**: WebSocket functionality documentation and testing
- **Tests**: Connection testing, event documentation, Socket.IO integration
- **Coverage**: Real-time events, connection management, room handling
- **Key Features**: WebSocket endpoint testing and documentation

### 08-performance-tests.http
- **Purpose**: Performance and load testing
- **Tests**: Response times, concurrent requests, bulk operations
- **Coverage**: Stress testing, performance monitoring, resource usage
- **Key Features**: Load testing scenarios with timing

### 09-edge-cases.http
- **Purpose**: Boundary conditions and edge case testing
- **Tests**: Extreme values, unusual inputs, system limits
- **Coverage**: Data boundaries, unicode handling, large payloads
- **Key Features**: Corner case validation

### 10-integration-tests.http
- **Purpose**: End-to-end workflow testing
- **Tests**: Complete user journeys, multi-step processes, workflow validation
- **Coverage**: Full application flows, user scenarios, integration validation
- **Key Features**: Real-world usage patterns

## How to Use

### Prerequisites
1. Start the backend server: `npm run dev` in `/backend` directory
2. Ensure MongoDB is running (optional - server runs without DB for testing)
3. Use REST Client extension in VS Code or similar HTTP client

### Test Execution Order
1. **Health Check**: Run `01-health.http` first to verify server status
2. **Authentication**: Run `02-authentication.http` to test auth flow
3. **Core Features**: Run `03-chat.http` for main functionality
4. **Validation**: Run remaining files for comprehensive testing

### Token Management
- Most tests require JWT tokens from login responses
- Replace placeholder tokens (`YOUR_JWT_TOKEN_FROM_LOGIN_RESPONSE`) with actual tokens
- Tokens expire after 1 hour - re-authenticate as needed

### Response Handling
- Save important response data (user IDs, message IDs, tokens)
- Use response data in subsequent requests
- Check response status codes and error messages

## Test Data Guidelines

### Phone Numbers
- Use format: `3000000XXX` for test users
- Avoid real phone numbers
- Each test user should have unique number

### PINs
- Use 4-digit numeric PINs only
- Examples: `1111`, `2222`, `3333`
- Avoid simple patterns in production

### Message Content
- Use descriptive test messages
- Include special characters for validation testing
- Test various message lengths

## Environment Configuration

### Server Settings
- **Base URL**: `http://localhost:5000`
- **API Prefix**: `/api`
- **Auth Endpoints**: `/api/auth/*`
- **Chat Endpoints**: `/api/chat/*`

### Headers
- **Content-Type**: `application/json` for all requests
- **Authorization**: `Bearer {token}` for authenticated requests
- **Cookies**: Used for refresh tokens in some scenarios

## Troubleshooting

### Common Issues
1. **Server Not Running**: Verify backend is started with `npm run dev`
2. **Token Expired**: Re-authenticate and update tokens in requests
3. **Database Errors**: Check MongoDB connection (optional for testing)
4. **Rate Limiting**: Wait for rate limit reset or use different test data

### Error Codes
- **401**: Authentication required or token invalid
- **400**: Bad request or validation error
- **429**: Rate limit exceeded
- **500**: Server error or database issue

### Best Practices
1. Run health check before other tests
2. Use fresh tokens for each test session
3. Clean up test data periodically
4. Monitor server logs during testing
5. Test error scenarios along with success cases

## API Endpoints Summary

### Authentication Endpoints
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login
- `POST /api/auth/logout` - User logout
- `POST /api/auth/refresh` - Token refresh
- `GET /api/auth/me` - Get user profile
- `POST /api/auth/verify-pin` - PIN verification
- `GET /api/auth/session-status` - Session status

### Chat Endpoints
- `POST /api/chat/send` - Send message
- `GET /api/chat/history/:userId` - Get chat history
- `POST /api/chat/mark-read` - Mark messages as read
- `DELETE /api/chat/message/:messageId` - Delete message
- `GET /api/chat/conversations` - Get recent conversations
- `GET /api/chat/search-users` - Search users
- `POST /api/chat/status` - Update user status
- `GET /api/chat/online-users` - Get online users
- `GET /api/chat/unread-count` - Get unread message count

### Health Endpoints
- `GET /api/health` - Server health check
- `GET /api/health/detailed` - Detailed system status

### WebSocket Events
- `connection` - User connects
- `disconnect` - User disconnects
- `join_room` - Join chat room
- `leave_room` - Leave chat room
- `new_message` - New message received
- `message_read` - Message marked as read
- `user_status_change` - User status updated
- `typing_start` - User started typing
- `typing_stop` - User stopped typing

## Security Notes

### Authentication
- JWT tokens expire after 1 hour
- Refresh tokens have longer expiration
- PIN verification required for sensitive operations

### Rate Limiting
- Login attempts: 5 per 15 minutes per IP
- Messages: 100 per hour per user
- API requests: 1000 per hour per IP

### Data Protection
- Sensitive data is not logged
- Passwords/PINs are hashed
- User data is protected by authentication

## Performance Expectations

### Response Times
- Health checks: < 100ms
- Authentication: < 500ms
- Chat operations: < 300ms
- Database queries: < 200ms

### Throughput
- Concurrent users: 100+
- Messages per second: 50+
- API requests per second: 200+

Use these test files to thoroughly validate the chat application backend functionality and ensure robust operation under various conditions.
