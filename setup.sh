#!/bin/bash

echo "🐟 Welcome to Nomu: Eat or Get Eaten Setup"
echo "========================================="
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 14+ first."
    exit 1
fi

echo "✅ Node.js $(node --version) detected"

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install npm first."
    exit 1
fi

echo "✅ npm $(npm --version) detected"

# Install dependencies
echo ""
echo "📦 Installing dependencies..."
npm install

# Copy environment file
if [ ! -f .env ]; then
    echo ""
    echo "🔧 Creating .env file from env.example..."
    cp env.example .env
    echo "✅ .env file created. Please update it with your configuration."
else
    echo ""
    echo "ℹ️  .env file already exists, skipping..."
fi

# Run prepare script
echo ""
echo "🏗️  Preparing frontend assets..."
npm run prepare

echo ""
echo "✨ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Edit .env file with your configuration"
echo "2. Set up MongoDB database"
echo "3. Create a Telegram bot via @BotFather"
echo "4. Run 'npm run dev' to start development server"
echo ""
echo "Happy coding! 🎮" 