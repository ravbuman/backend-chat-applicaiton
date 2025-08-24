#!/usr/bin/env node

/**
 * Environment Setup Script
 * Generates secure keys and sets up environment configuration
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class EnvironmentSetup {
  constructor() {
    this.envExamplePath = path.join(__dirname, '.env.example');
    this.envPath = path.join(__dirname, '.env');
  }

  /**
   * Generate a secure random key
   * @param {number} length - Key length in bytes
   * @returns {string} - Hex encoded key
   */
  generateSecureKey(length = 32) {
    return crypto.randomBytes(length).toString('hex');
  }

  /**
   * Generate all required keys
   * @returns {Object} - Object containing all generated keys
   */
  generateKeys() {
    console.log('🔐 Generating secure keys...');
    
    const keys = {
      JWT_SECRET: this.generateSecureKey(32),
      JWT_REFRESH_SECRET: this.generateSecureKey(32),
      COOKIE_SECRET: this.generateSecureKey(32)
    };

    console.log('✅ Keys generated successfully');
    return keys;
  }

  /**
   * Read the .env.example file
   * @returns {string} - Content of .env.example
   */
  readEnvExample() {
    if (!fs.existsSync(this.envExamplePath)) {
      throw new Error('.env.example file not found');
    }
    
    return fs.readFileSync(this.envExamplePath, 'utf8');
  }

  /**
   * Replace placeholder keys in environment content
   * @param {string} content - Environment file content
   * @param {Object} keys - Generated keys
   * @returns {string} - Updated content
   */
  replaceKeys(content, keys) {
    console.log('🔄 Updating environment configuration...');
    
    let updatedContent = content;
    
    // Replace placeholder keys
    updatedContent = updatedContent.replace(
      /JWT_SECRET=.*/,
      `JWT_SECRET=${keys.JWT_SECRET}`
    );
    
    updatedContent = updatedContent.replace(
      /JWT_REFRESH_SECRET=.*/,
      `JWT_REFRESH_SECRET=${keys.JWT_REFRESH_SECRET}`
    );
    
    updatedContent = updatedContent.replace(
      /COOKIE_SECRET=.*/,
      `COOKIE_SECRET=${keys.COOKIE_SECRET}`
    );

    return updatedContent;
  }

  /**
   * Write the updated environment file
   * @param {string} content - Updated environment content
   */
  writeEnvFile(content) {
    fs.writeFileSync(this.envPath, content);
    console.log('✅ .env file created successfully');
  }

  /**
   * Check if .env file already exists
   * @returns {boolean}
   */
  envFileExists() {
    return fs.existsSync(this.envPath);
  }

  /**
   * Backup existing .env file
   */
  backupEnvFile() {
    if (this.envFileExists()) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = path.join(__dirname, `.env.backup.${timestamp}`);
      
      fs.copyFileSync(this.envPath, backupPath);
      console.log(`📦 Existing .env file backed up to: .env.backup.${timestamp}`);
    }
  }

  /**
   * Display security warnings
   */
  displaySecurityWarnings() {
    console.log('\n⚠️  SECURITY WARNINGS:');
    console.log('====================');
    console.log('1. 🔐 Keep your .env file secure and never commit it to version control');
    console.log('2. 🚨 Change all keys before deploying to production');
    console.log('3. 📝 Set appropriate MONGODB_URI for your environment');
    console.log('4. 🌐 Update CORS_ORIGIN to match your frontend URL');
    console.log('5. 🔒 Enable HTTPS and secure cookies in production');
    console.log('');
  }

  /**
   * Display next steps
   */
  displayNextSteps() {
    console.log('📋 NEXT STEPS:');
    console.log('==============');
    console.log('1. 📝 Review and update .env file with your specific configuration');
    console.log('2. 🗄️  Install and start MongoDB on your system');
    console.log('3. 🚀 Start the server with: npm start');
    console.log('4. 🏥 Check server health: curl http://localhost:5000/health');
    console.log('5. 🔍 View API docs: http://localhost:5000/api');
    console.log('');
  }

  /**
   * Validate MongoDB URI format
   * @param {string} uri - MongoDB URI
   * @returns {boolean}
   */
  validateMongoUri(uri) {
    const mongoUriRegex = /^mongodb:\/\/.*$/;
    return mongoUriRegex.test(uri);
  }

  /**
   * Interactive setup (for future enhancement)
   */
  async interactiveSetup() {
    // This could be enhanced with prompts for custom configuration
    console.log('📝 Using default configuration...');
    console.log('💡 Tip: Edit .env file manually for custom settings');
  }

  /**
   * Setup environment configuration
   * @param {Object} options - Setup options
   */
  async setup(options = {}) {
    const { force = false, interactive = false } = options;
    
    console.log('🛠️  Chat Application Environment Setup');
    console.log('=====================================\n');

    try {
      // Check if .env already exists
      if (this.envFileExists() && !force) {
        console.log('⚠️  .env file already exists');
        console.log('💡 Use --force to overwrite or delete the existing file');
        console.log('✨ Current .env file is ready to use!');
        return;
      }

      // Backup existing file if forcing update
      if (force) {
        this.backupEnvFile();
      }

      // Interactive setup (future enhancement)
      if (interactive) {
        await this.interactiveSetup();
      }

      // Generate keys
      const keys = this.generateKeys();

      // Read template
      const envTemplate = this.readEnvExample();

      // Replace keys
      const updatedContent = this.replaceKeys(envTemplate, keys);

      // Write new file
      this.writeEnvFile(updatedContent);

      console.log('\n🎉 Environment setup completed successfully!');
      
      // Display security warnings
      this.displaySecurityWarnings();
      
      // Display next steps
      this.displayNextSteps();

    } catch (error) {
      console.error('❌ Environment setup failed:', error.message);
      process.exit(1);
    }
  }

  /**
   * Display current configuration status
   */
  checkStatus() {
    console.log('🔍 Environment Configuration Status');
    console.log('===================================\n');

    if (this.envFileExists()) {
      console.log('✅ .env file exists');
      
      try {
        const envContent = fs.readFileSync(this.envPath, 'utf8');
        
        // Check for placeholder values
        const hasPlaceholders = envContent.includes('your-super-secret') || 
                               envContent.includes('change-this-in-production');
        
        if (hasPlaceholders) {
          console.log('⚠️  .env file contains placeholder values');
          console.log('💡 Run setup again to generate secure keys');
        } else {
          console.log('✅ .env file appears to be configured');
        }

        // Check MongoDB URI
        const mongoMatch = envContent.match(/MONGODB_URI=(.+)/);
        if (mongoMatch && this.validateMongoUri(mongoMatch[1])) {
          console.log('✅ MongoDB URI format is valid');
        } else {
          console.log('⚠️  MongoDB URI may need configuration');
        }

      } catch (error) {
        console.log('❌ Error reading .env file:', error.message);
      }
    } else {
      console.log('❌ .env file does not exist');
      console.log('💡 Run setup to create the environment configuration');
    }
  }
}

// Command line interface
if (require.main === module) {
  const args = process.argv.slice(2);
  const setup = new EnvironmentSetup();

  const command = args[0] || 'setup';
  const force = args.includes('--force');
  const interactive = args.includes('--interactive');

  switch (command) {
    case 'setup':
      setup.setup({ force, interactive });
      break;
    
    case 'status':
      setup.checkStatus();
      break;
    
    case 'keys':
      console.log('🔐 Generated Keys:');
      console.log('==================');
      const keys = setup.generateKeys();
      Object.entries(keys).forEach(([key, value]) => {
        console.log(`${key}=${value}`);
      });
      break;
    
    case 'help':
    default:
      console.log('🛠️  Environment Setup Commands:');
      console.log('===============================');
      console.log('  setup                 - Setup environment configuration');
      console.log('  setup --force         - Force overwrite existing .env');
      console.log('  setup --interactive   - Interactive setup (future)');
      console.log('  status               - Check configuration status');
      console.log('  keys                 - Generate keys only');
      console.log('  help                 - Show this help');
      break;
  }
}

module.exports = EnvironmentSetup;
