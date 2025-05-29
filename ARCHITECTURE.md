# Nomu: Eat or Get Eaten - Architecture Overview

## System Architecture

### Overview

Nomu is built as a Telegram Mini App with a Node.js backend and HTML5 Canvas frontend. The architecture prioritizes security, scalability, and a seamless user experience within the Telegram ecosystem.

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│                 │     │                  │     │                 │
│  Telegram App   │────▶│   Node.js API    │────▶│    MongoDB      │
│  (Mini App)     │◀────│   (Express)      │◀────│   Database      │
│                 │     │                  │     │                 │
└─────────────────┘     └──────────────────┘     └─────────────────┘
         │                       │
         │                       │
         ▼                       ▼
┌─────────────────┐     ┌──────────────────┐
│                 │     │                  │
│  HTML5 Canvas   │     │  Telegram Bot    │
│   Game Client   │     │      API         │
│                 │     │                  │
└─────────────────┘     └──────────────────┘
```

## Backend Architecture

### Core Components

#### 1. Express Server (`index.js`)

- **Purpose**: Main application server
- **Responsibilities**:
  - API endpoint management
  - Middleware configuration
  - Request routing
  - Session management

#### 2. Security Layer

- **Helmet.js**: Security headers and CSP configuration
- **Rate Limiting**: API abuse prevention
- **Telegram Auth**: Init data validation
- **API Password**: Additional authentication layer

#### 3. Database Layer (`repositories/`)

- **scoreRepository.js**: User scores and leaderboard management
- **sessionRepository.js**: Game session lifecycle management

#### 4. Game Logic (`helpers/`)

- **verify-replay.js**: Anti-cheat replay verification system

### API Endpoints

```
GET  /                    → Serve game client
GET  /health             → Health check endpoint
GET  /api/scores         → Public leaderboard

POST /api/session        → Create game session (protected)
POST /api/scores         → Submit score (protected)
```

### Security Architecture

#### Authentication Flow

1. Telegram Mini App sends init data in Authorization header
2. Server validates init data signature with bot token
3. Session created with unique ID and seed
4. Client uses session for gameplay
5. Score submission includes replay data for verification

#### Anti-Cheat System

```
Client                          Server
  │                               │
  ├─ Start Game ─────────────────▶├─ Create Session
  │                               ├─ Generate Seed
  │◀──────────── Session ID ──────┤
  │                               │
  ├─ Play Game                    │
  ├─ Record Actions               │
  │                               │
  ├─ Submit Score ────────────────▶├─ Verify Session
  ├─ Include Replay Data          ├─ Validate Replay
  │                               ├─ Check Timing
  │◀──────────── Result ──────────├─ Store/Reject Score
```

## Frontend Architecture

### Game Client Structure

- **HTML5 Canvas**: Main game rendering
- **Vanilla JavaScript**: Game logic and physics
- **Telegram Web App SDK**: Platform integration
- **Obfuscation**: Code protection against tampering

### Game Loop

```javascript
Initialize → Load Assets → Game Loop {
  Handle Input → Update Physics →
  Check Collisions → Update Score →
  Render Frame → Record Actions
} → Game Over → Submit Score
```

## Data Flow

### Score Submission Process

1. **Client**: Completes game, prepares submission data
2. **Client**: Sends score + replay data + session ID
3. **Server**: Validates Telegram auth
4. **Server**: Verifies session exists and is valid
5. **Server**: Runs replay verification
6. **Server**: Validates timing constraints
7. **Server**: Updates database or flags suspicious activity
8. **Server**: Returns result to client

### Session Management

- Sessions expire after use or timeout
- Each session has unique seed for deterministic randomness
- Sessions tied to Telegram user ID

## Database Schema

### Users Collection

```javascript
{
  userId: String,           // Telegram user ID
  username: String,         // Telegram username
  scores: {
    [eventName]: {
      highScore: Number,
      lastScore: Number,
      lastPlayed: Date,
      totalGames: Number
    }
  }
}
```

### Sessions Collection

```javascript
{
  sessionId: String,        // Unique session ID
  userId: String,           // Telegram user ID
  seed: String,            // Random seed for game
  createdAt: Date,         // Session creation time
  used: Boolean            // Whether session was used
}
```

### Scores Collection

```javascript
{
  userId: String,
  username: String,
  score: Number,
  gameTime: Number,
  event: String,
  sessionId: String,
  createdAt: Date,
  isFlagged: Boolean,      // Suspicious activity flag
  flaggedFor: [String]     // Reasons for flagging
}
```

## Deployment Considerations

### Scalability

- Stateless API design allows horizontal scaling
- MongoDB can be clustered for high availability
- Session-based architecture prevents replay attacks
- Rate limiting prevents API abuse

### Performance Optimizations

- HTML minification and obfuscation at build time
- Efficient database indexing
- Caching strategy for leaderboards
- Lightweight game assets

### Monitoring

- Health endpoint for uptime monitoring
- Error logging for debugging
- Flagged scores for anti-cheat analysis
- Bot polling error handling

## Technology Decisions

### Why Telegram Mini Apps?

- Native integration with Telegram ecosystem
- Built-in user authentication
- Social features and sharing
- No app store approval needed

### Why Node.js/Express?

- JavaScript throughout the stack
- Excellent Telegram SDK support
- Fast development cycle
- Good performance for real-time games

### Why MongoDB?

- Flexible schema for game data
- Good performance for leaderboards
- Easy horizontal scaling
- Native JavaScript integration

### Security Considerations

- Replay verification prevents score manipulation
- Session-based gameplay prevents automation
- Obfuscation deters casual cheating
- Rate limiting prevents API abuse

## Future Enhancements

### Planned Features

- WebSocket support for real-time multiplayer
- Redis caching for leaderboards
- Advanced anti-cheat with ML detection
- Tournament system
- Achievement system

### Scalability Roadmap

- Microservices architecture
- Kubernetes deployment
- CDN for static assets
- Regional database replicas
- Load balancing
