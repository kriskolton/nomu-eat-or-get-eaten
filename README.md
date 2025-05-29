# 🐟 Nomu: Eat or Get Eaten

A competitive survival game built as a Telegram Mini App, with a public leaderboard. Players control a fish that must eat smaller fish to grow while avoiding larger predators.

![Game Version](https://img.shields.io/badge/version-1.0.0-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D14.0.0-brightgreen.svg)

## 🎮 Game Overview

**Nomu: Eat or Get Eaten** is an engaging survival game where players navigate an underwater world as a fish. The goal is simple: eat smaller fish to grow larger while avoiding becoming prey yourself. The game features:

- **Real-time gameplay** with smooth controls and physics
- **Progressive difficulty** as you grow larger
- **Leaderboard system** with seasonal competitions
- **Anti-cheat mechanisms** to ensure fair play
- **Telegram integration** for seamless social gaming

## 🚀 Quick Start

For the fastest setup experience, use our setup script:

```bash
# Clone the repository
git clone https://github.com/yourusername/nomu-fish-game.git
cd nomu-fish-game

# Run the setup script
./setup.sh
```

The setup script will:

- Check for Node.js and npm
- Install all dependencies
- Create a `.env` file from the example
- Prepare the frontend assets

## 🚀 Features

### Core Gameplay

- Intuitive controls optimized for mobile devices
- Progressive size-based gameplay mechanics
- Sound effects and visual feedback

### Technical Features

- **Telegram Mini Apps Integration**: Native Telegram app experience
- **Session Management**: Secure game sessions with replay verification
- **Anti-Cheat System**: Server-side validation and replay verification
- **Leaderboards**: Global and seasonal rankings
- **Rate Limiting**: Protection against API abuse
- **Security**: Helmet.js integration and content security policies

### Social Features

- View high scores directly in Telegram
- Check personal statistics
- Compete in seasonal events
- Share achievements with friends

## 🛠️ Technology Stack

### Backend

- **Node.js** - Server runtime
- **Express.js** - Web framework
- **MongoDB** - Database for user scores and sessions
- **Telegram Bot API** - Bot integration
- **Helmet.js** - Security middleware

### Frontend

- **HTML5 Canvas** - Game rendering
- **JavaScript** - Game logic
- **Telegram Mini Apps SDK** - Telegram integration

### Security & Optimization

- **express-rate-limit** - API rate limiting
- **@telegram-apps/init-data-node** - Telegram data validation
- **seedrandom** - Deterministic random number generation
- **HTML Obfuscation** - Client-side code protection

## 📋 Prerequisites

- Node.js (v14.0.0 or higher)
- MongoDB instance
- Telegram Bot Token
- HTTPS endpoint (for production)

## 🔧 Installation

1. **Clone the repository**

   ```bash
   git clone https://github.com/yourusername/nomu-fish-game.git
   cd nomu-fish-game
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Set up environment variables**
   Create a `.env` file in the root directory:

   ```env
   # Server Configuration
   PORT=3000
   ENVIRONMENT=development

   # Database
   MONGODB_URI=mongodb://localhost:27017/nomu-game
   DATABASE_NAME=nomu-game

   # Telegram Integration
   TELEGRAM_BOT_TOKEN=your_bot_token_here
   GAME_URL=https://your-game-url.com
   ```

4. **Prepare the frontend**

   ```bash
   npm run prepare
   ```

5. **Start the server**

   ```bash
   npm start
   ```

   For development with auto-reload:

   ```bash
   npm run dev
   ```

## 🚀 Deployment

### Production Setup

1. **Environment Variables**

   - Set `ENVIRONMENT=production`
   - Configure a secure MongoDB connection string
   - Set up a proper HTTPS endpoint for `GAME_URL`

2. **Security Considerations**

   - Enable rate limiting by uncommenting the rate limiter in `index.js`
   - Ensure HTTPS is properly configured
   - Review and adjust CSP headers as needed

3. **Database Indexes**
   The application automatically creates necessary indexes for optimal performance.

### Telegram Bot Setup

1. Create a new bot via [@BotFather](https://t.me/botfather)
2. Get your bot token
3. Set up the game shortname
4. Configure the `GAME_URL` to point to your HTTPS endpoint

## 📁 Project Structure

```
fish-eater-surf/
├── index.js              # Main server file
├── config/               # Configuration files
│   └── index.js         # Game configuration
├── helpers/             # Utility functions
│   └── verify-replay.js # Anti-cheat replay verification
├── repositories/        # Database layer
│   ├── scoreRepository.js
│   └── sessionRepository.js
├── public/              # Frontend game files
│   ├── index.html       # Game UI
│   ├── img/            # Game assets
│   └── sounds/         # Audio files
├── obfuscate-html.js   # Build script for code protection
├── minify-html.js      # Build script for optimization
└── package.json        # Project metadata
```

## 🎯 API Endpoints

### Public Endpoints

- `GET /` - Serve the game client
- `GET /health` - Server health check
- `GET /api/scores` - Get current leaderboard

### Protected Endpoints

- `POST /api/session` - Start a new game session
- `POST /api/scores` - Submit a game score

All protected endpoints require:

- Telegram Mini App authentication
- API password header

## 🔒 Security Features

- **Telegram Authentication**: All game sessions are validated against Telegram's servers
- **Replay Verification**: Server-side validation of game replays to prevent cheating
- **Session Management**: Time-limited sessions to prevent replay attacks
- **Rate Limiting**: Protection against API abuse
- **Content Security Policy**: XSS protection via Helmet.js
- **Code Obfuscation**: Client-side JavaScript protection

## 🤝 Contributing

We welcome contributions! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines

- Follow existing code style
- Add tests for new features
- Update documentation as needed
- Ensure all security checks pass

## 🙏 Acknowledgments

- Telegram team for the Mini Apps platform
- Contributors and testers
- The gaming community for feedback and support

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/yourusername/nomu-fish-game/issues)
- **Discussions**: [GitHub Discussions](https://github.com/yourusername/nomu-fish-game/discussions)
- **Telegram**: [@nomu_game_support](https://t.me/nomu_game_support)

---

Made with ❤️ for the Telegram gaming community
