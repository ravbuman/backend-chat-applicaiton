const axios = require('axios');
const config = require('./src/config/config');

/**
 * Health Check Script
 * Tests if the chat application backend is running and responding correctly
 */

const BASE_URL = `http://localhost:${config.port}`;
const ENDPOINTS = [
  { url: '/health', method: 'GET', description: 'Health Check' },
  { url: '/api', method: 'GET', description: 'API Documentation' },
  { url: '/api/auth/session-status', method: 'GET', description: 'Session Status Check' }
];

async function checkEndpoint(endpoint) {
  try {
    const response = await axios({
      method: endpoint.method,
      url: `${BASE_URL}${endpoint.url}`,
      timeout: 5000,
      validateStatus: () => true // Don't throw on any status code
    });

    return {
      ...endpoint,
      status: response.status,
      success: response.status >= 200 && response.status < 400,
      data: response.data,
      responseTime: response.headers['x-response-time'] || 'N/A'
    };
  } catch (error) {
    return {
      ...endpoint,
      status: 0,
      success: false,
      error: error.message,
      responseTime: 'N/A'
    };
  }
}

async function runHealthCheck() {
  console.log('🏥 Chat Application Backend Health Check');
  console.log('==========================================');
  console.log(`Testing server at: ${BASE_URL}`);
  console.log('');

  const results = [];
  
  for (const endpoint of ENDPOINTS) {
    console.log(`Testing ${endpoint.description}...`);
    const result = await checkEndpoint(endpoint);
    results.push(result);
    
    if (result.success) {
      console.log(`✅ ${endpoint.description}: ${result.status} (${result.responseTime})`);
    } else {
      console.log(`❌ ${endpoint.description}: ${result.status || 'Connection Failed'}`);
      if (result.error) {
        console.log(`   Error: ${result.error}`);
      }
    }
  }

  console.log('');
  console.log('==========================================');
  
  const successCount = results.filter(r => r.success).length;
  const totalCount = results.length;
  
  if (successCount === totalCount) {
    console.log('🎉 All health checks passed!');
    console.log('The chat application backend is running correctly.');
  } else {
    console.log(`⚠️  ${successCount}/${totalCount} health checks passed.`);
    console.log('Some issues were detected with the backend.');
  }

  console.log('');
  console.log('📊 Summary:');
  results.forEach(result => {
    console.log(`   ${result.description}: ${result.success ? '✅' : '❌'} ${result.status}`);
  });

  console.log('');
  console.log('🔗 Quick Links:');
  console.log(`   Health Check: ${BASE_URL}/health`);
  console.log(`   API Docs: ${BASE_URL}/api`);
  console.log(`   Logs: tail -f logs/app.log`);

  return successCount === totalCount;
}

// Run health check if called directly
if (require.main === module) {
  runHealthCheck()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('❌ Health check failed:', error.message);
      process.exit(1);
    });
}

module.exports = { runHealthCheck, checkEndpoint };
