#!/bin/bash

# Chat Application Backend Startup Script
# This script sets up and starts the chat application backend

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to check if MongoDB is running
check_mongodb() {
    if command_exists mongosh; then
        if mongosh --eval "db.adminCommand('ping')" >/dev/null 2>&1; then
            return 0
        fi
    elif command_exists mongo; then
        if mongo --eval "db.adminCommand('ping')" >/dev/null 2>&1; then
            return 0
        fi
    fi
    return 1
}

# Function to start MongoDB (if installed locally)
start_mongodb() {
    print_status "Attempting to start MongoDB..."
    
    if command_exists systemctl; then
        sudo systemctl start mongod && print_success "MongoDB started via systemctl"
    elif command_exists brew; then
        brew services start mongodb-community && print_success "MongoDB started via Homebrew"
    elif command_exists mongod; then
        mongod --fork --logpath /tmp/mongodb.log && print_success "MongoDB started manually"
    else
        print_error "Could not start MongoDB. Please start it manually."
        return 1
    fi
}

print_status "🚀 Starting Chat Application Backend Setup..."

# Check Node.js version
if ! command_exists node; then
    print_error "Node.js is not installed. Please install Node.js 18+ and try again."
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2)
REQUIRED_VERSION="18.0.0"

if ! node -p "require('semver').gte('$NODE_VERSION', '$REQUIRED_VERSION')" 2>/dev/null; then
    print_error "Node.js version $NODE_VERSION is not supported. Please install Node.js 18+ and try again."
    exit 1
fi

print_success "Node.js version $NODE_VERSION is supported"

# Check if npm is available
if ! command_exists npm; then
    print_error "npm is not installed. Please install npm and try again."
    exit 1
fi

print_success "npm is available"

# Check if we're in the correct directory
if [ ! -f "package.json" ]; then
    print_error "package.json not found. Please run this script from the backend directory."
    exit 1
fi

# Check if MongoDB is running
print_status "Checking MongoDB connection..."
if ! check_mongodb; then
    print_warning "MongoDB is not running or not accessible"
    print_status "Trying to start MongoDB..."
    
    if ! start_mongodb; then
        print_error "Failed to start MongoDB. Please start MongoDB manually and try again."
        print_status "You can start MongoDB with one of these commands:"
        echo "  - sudo systemctl start mongod (Linux with systemd)"
        echo "  - brew services start mongodb-community (macOS with Homebrew)"
        echo "  - mongod (manual start)"
        exit 1
    fi
    
    # Wait a moment for MongoDB to start
    sleep 3
    
    if ! check_mongodb; then
        print_error "MongoDB is still not accessible after startup attempt."
        exit 1
    fi
fi

print_success "MongoDB is running and accessible"

# Check if .env file exists
if [ ! -f ".env" ]; then
    print_warning ".env file not found"
    
    if [ -f ".env.example" ]; then
        print_status "Copying .env.example to .env..."
        cp .env.example .env
        print_success ".env file created from template"
        print_warning "Please edit .env file with your configuration before starting the server"
    else
        print_error ".env.example file not found. Please create a .env file manually."
        exit 1
    fi
fi

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    print_status "Installing dependencies..."
    npm install
    print_success "Dependencies installed"
else
    print_status "Dependencies already installed"
fi

# Create logs directory if it doesn't exist
if [ ! -d "logs" ]; then
    print_status "Creating logs directory..."
    mkdir -p logs
    print_success "Logs directory created"
fi

# Check if all required environment variables are set
print_status "Validating environment configuration..."

# Source the .env file to check variables
if [ -f ".env" ]; then
    export $(grep -v '^#' .env | xargs)
fi

# Check critical environment variables
MISSING_VARS=""

[ -z "$MONGODB_URI" ] && MISSING_VARS="$MISSING_VARS MONGODB_URI"
[ -z "$JWT_SECRET" ] && MISSING_VARS="$MISSING_VARS JWT_SECRET"
[ -z "$JWT_REFRESH_SECRET" ] && MISSING_VARS="$MISSING_VARS JWT_REFRESH_SECRET"
[ -z "$COOKIE_SECRET" ] && MISSING_VARS="$MISSING_VARS COOKIE_SECRET"

if [ ! -z "$MISSING_VARS" ]; then
    print_error "Missing required environment variables:$MISSING_VARS"
    print_status "Please edit your .env file and set these variables."
    exit 1
fi

print_success "Environment configuration is valid"

# Optionally run tests
if [ "$1" = "--test" ]; then
    print_status "Running tests..."
    npm test
    print_success "All tests passed"
fi

# Start the application
print_success "🎉 Setup complete! Starting the chat application backend..."
print_status "Server will be available at: http://localhost:${PORT:-5000}"
print_status "Health check: http://localhost:${PORT:-5000}/health"
print_status "API documentation: http://localhost:${PORT:-5000}/api"
print_status ""
print_status "Press Ctrl+C to stop the server"
print_status ""

# Start in development mode if requested
if [ "$1" = "--dev" ]; then
    print_status "Starting in development mode with auto-reload..."
    npm run dev
else
    print_status "Starting in production mode..."
    npm start
fi
