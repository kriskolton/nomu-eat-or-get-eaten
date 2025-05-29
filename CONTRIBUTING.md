# Contributing to Nomu: Eat or Get Eaten

First off, thank you for considering contributing to Nomu! It's people like you that make this game a great tool for the Telegram community.

## Code of Conduct

By participating in this project, you are expected to uphold our values of respect, inclusivity, and collaboration. Please be kind and considerate in all interactions.

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check existing issues to avoid duplicates. When you create a bug report, include as many details as possible:

- **Use a clear and descriptive title**
- **Describe the exact steps to reproduce the problem**
- **Provide specific examples**
- **Describe the behavior you observed and what you expected**
- **Include screenshots if possible**
- **Include your environment details** (OS, Node version, etc.)

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. When creating an enhancement suggestion:

- **Use a clear and descriptive title**
- **Provide a detailed description of the proposed enhancement**
- **Explain why this enhancement would be useful**
- **List any alternatives you've considered**

### Pull Requests

1. Fork the repo and create your branch from `main`
2. If you've added code that should be tested, add tests
3. If you've changed APIs, update the documentation
4. Ensure the test suite passes (when available)
5. Make sure your code follows the existing style
6. Issue that pull request!

## Development Process

### Setting Up Your Development Environment

1. Fork and clone the repository
2. Install dependencies: `npm install`
3. Copy `.env.example` to `.env` and configure your environment
4. Set up a local MongoDB instance
5. Create a Telegram bot for testing
6. Run the development server: `npm run dev`

### Code Style

- Use 2 spaces for indentation
- Use semicolons
- Use `const` or `let` instead of `var`
- Follow existing naming conventions
- Add comments for complex logic
- Keep functions small and focused

### Testing

Currently, the project doesn't have automated tests. This is an area where contributions are especially welcome! When adding tests:

- Place unit tests in a `__tests__` directory
- Use descriptive test names
- Test both success and failure cases
- Mock external dependencies

### Commit Messages

- Use the present tense ("Add feature" not "Added feature")
- Use the imperative mood ("Move cursor to..." not "Moves cursor to...")
- Limit the first line to 72 characters or less
- Reference issues and pull requests liberally after the first line

### Security

If you discover a security vulnerability, please email the maintainers directly instead of creating a public issue. We take security seriously and will respond promptly.

## Project Structure

Understanding the project structure will help you make better contributions:

- `index.js` - Main server file with Express routes
- `repositories/` - Database interaction layer
- `helpers/` - Utility functions and game logic
- `public/` - Frontend game files
- `config/` - Configuration files

## Questions?

Feel free to open an issue with the label "question" if you need clarification on anything.

Thank you for contributing! 🐟
