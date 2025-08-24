#!/usr/bin/env node

/**
 * Test Server Script
 * Tests the backend server functionality with graceful error handling
 */

const axios = require('axios');
const { spawn } = require('child_process');
const path = require('path');

const BASE_URL = 'http://localhost:5000';
const SERVER_SCRIPT = path.join(__dirname, 'src', 'server.js');

class ServerTester {
  constructor() {
    this.serverProcess = null;
    this.isServerRunning = false;
  }

  /**
   * Start the server process
   */
  async startServer() {
    return new Promise((resolve, reject) => {
      console.log('🚀 Starting test server...');
      
      this.serverProcess = spawn('node', [SERVER_SCRIPT], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, NODE_ENV: 'development' }
      });

      let startupOutput = '';

      this.serverProcess.stdout.on('data', (data) => {
        const output = data.toString();
        startupOutput += output;
        
        // Check if server started successfully
        if (output.includes('Server started successfully')) {
          this.isServerRunning = true;
          console.log('✅ Server started successfully');
          resolve();
        }
      });

      this.serverProcess.stderr.on('data', (data) => {
        const output = data.toString();
        startupOutput += output;
        
        // Still resolve even if there are warnings (like MongoDB connection issues)
        if (output.includes('Server started successfully') || output.includes('Maximum database connection attempts exceeded')) {
          this.isServerRunning = true;
          console.log('✅ Server started (with warnings)');
          resolve();
        }
      });

      this.serverProcess.on('error', (error) => {
        console.error('❌ Failed to start server:', error.message);
        reject(error);
      });

      this.serverProcess.on('exit', (code) => {
        this.isServerRunning = false;
        if (code !== 0 && code !== null) {
          console.error(`❌ Server exited with code ${code}`);
          reject(new Error(`Server exited with code ${code}`));
        }
      });

      // Timeout after 30 seconds
      setTimeout(() => {
        if (!this.isServerRunning) {
          console.log('⏰ Server startup timeout - checking if it\'s running anyway...');
          this.checkServerHealth().then(() => {
            this.isServerRunning = true;
            resolve();
          }).catch(() => {
            reject(new Error('Server startup timeout'));
          });
        }
      }, 30000);
    });
  }

  /**
   * Stop the server process
   */
  async stopServer() {
    if (this.serverProcess && this.isServerRunning) {
      console.log('🛑 Stopping server...');
      
      return new Promise((resolve) => {
        this.serverProcess.on('exit', () => {
          console.log('✅ Server stopped');
          resolve();
        });
        
        this.serverProcess.kill('SIGTERM');
        
        // Force kill after 5 seconds if graceful shutdown fails
        setTimeout(() => {
          if (this.serverProcess && !this.serverProcess.killed) {
            this.serverProcess.kill('SIGKILL');
            resolve();
          }
        }, 5000);
      });
    }
  }

  /**
   * Test server health endpoint
   */
  async checkServerHealth() {
    try {
      const response = await axios.get(`${BASE_URL}/health`, {
        timeout: 5000,
        validateStatus: () => true
      });

      return {
        success: response.status >= 200 && response.status < 400,
        status: response.status,
        data: response.data
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Test API endpoints
   */
  async testEndpoints() {
    const endpoints = [
      { url: '/health', method: 'GET', description: 'Health Check' },
      { url: '/api', method: 'GET', description: 'API Documentation' },
      { url: '/api/auth/session-status', method: 'GET', description: 'Session Status' }
    ];

    console.log('\n📊 Testing API endpoints...');
    const results = [];

    for (const endpoint of endpoints) {
      try {
        const response = await axios({
          method: endpoint.method,
          url: `${BASE_URL}${endpoint.url}`,
          timeout: 5000,
          validateStatus: () => true
        });

        const result = {
          ...endpoint,
          status: response.status,
          success: response.status >= 200 && response.status < 400,
          responseTime: response.headers['x-response-time'] || 'N/A'
        };

        results.push(result);
        
        if (result.success) {
          console.log(`  ✅ ${endpoint.description}: ${result.status} (${result.responseTime})`);
        } else {
          console.log(`  ❌ ${endpoint.description}: ${result.status}`);
        }
      } catch (error) {
        const result = {
          ...endpoint,
          status: 0,
          success: false,
          error: error.message
        };
        
        results.push(result);
        console.log(`  ❌ ${endpoint.description}: Connection Failed - ${error.message}`);
      }
    }

    return results;
  }

  /**
   * Run comprehensive test suite
   */
  async runTests() {
    console.log('🧪 Chat Application Backend Test Suite');
    console.log('=====================================\n');

    try {
      // Start server
      await this.startServer();
      
      // Wait a moment for server to fully initialize
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Test health check
      console.log('🏥 Testing server health...');
      const health = await this.checkServerHealth();
      
      if (health.success) {
        console.log('✅ Server is healthy');
        console.log(`   Response: ${JSON.stringify(health.data, null, 2)}`);
      } else {
        console.log('❌ Server health check failed');
        if (health.error) {
          console.log(`   Error: ${health.error}`);
        }
      }
      
      // Test endpoints
      const endpointResults = await this.testEndpoints();
      
      // Summary
      console.log('\n📋 Test Summary');
      console.log('===============');
      
      const successCount = endpointResults.filter(r => r.success).length;
      const totalCount = endpointResults.length;
      
      if (successCount === totalCount) {
        console.log('🎉 All tests passed!');
        console.log('   The chat application backend is working correctly.');
      } else {
        console.log(`⚠️  ${successCount}/${totalCount} tests passed.`);
        console.log('   Some endpoints may not be working as expected.');
      }
      
      console.log('\n🔗 Server Information:');
      console.log(`   Base URL: ${BASE_URL}`);
      console.log(`   Health Check: ${BASE_URL}/health`);
      console.log(`   API Docs: ${BASE_URL}/api`);
      
      return successCount === totalCount;
      
    } catch (error) {
      console.error('❌ Test failed:', error.message);
      return false;
    } finally {
      await this.stopServer();
    }
  }
}

// Run tests if called directly
if (require.main === module) {
  const tester = new ServerTester();
  
  tester.runTests()
    .then(success => {
      console.log('\n' + (success ? '✅ All tests completed successfully' : '❌ Some tests failed'));
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('\n❌ Test suite failed:', error.message);
      process.exit(1);
    });
}

module.exports = ServerTester;
