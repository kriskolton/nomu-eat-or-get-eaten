# Security Policy

## Supported Versions

We take security seriously and currently support the following versions with security updates:

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

We appreciate your efforts to responsibly disclose your findings and will make every effort to acknowledge your contributions.

### How to Report

**Please DO NOT report security vulnerabilities through public GitHub issues.**

Instead, please report them via email to: security@your-domain.com

You should receive a response within 48 hours. If for some reason you do not, please follow up via email to ensure we received your original message.

### What to Include

Please include the following information:

- Type of issue (e.g., buffer overflow, SQL injection, cross-site scripting, etc.)
- Full paths of source file(s) related to the manifestation of the issue
- The location of the affected source code (tag/branch/commit or direct URL)
- Any special configuration required to reproduce the issue
- Step-by-step instructions to reproduce the issue
- Proof-of-concept or exploit code (if possible)
- Impact of the issue, including how an attacker might exploit the issue

### What to Expect

- We will acknowledge receipt of your vulnerability report
- We will confirm the vulnerability and determine its impact
- We will release a fix as soon as possible depending on complexity
- We will communicate with you throughout the process

## Security Measures

This project implements several security measures:

### Authentication & Authorization

- Telegram Mini App authentication for all game sessions
- Server-side validation of Telegram init data
- Session-based authentication with time limits

### Anti-Cheat System

- Server-side replay verification
- Deterministic random number generation with seeds
- Time-based validation of game sessions
- Score submission validation

### API Security

- Rate limiting on all endpoints
- API password protection
- Request size limits

### Code Security

- JavaScript obfuscation for client-side code
- Content Security Policy headers
- Helmet.js for security headers
- Input validation and sanitization

### Data Security

- MongoDB connection security
- No storage of sensitive user data
- Secure session management

## Best Practices for Contributors

When contributing to this project, please:

1. **Never commit credentials** - Use environment variables
2. **Validate all inputs** - Both client and server side
3. **Use prepared statements** - When writing database queries
4. **Escape output** - When rendering user content
5. **Keep dependencies updated** - Regularly check for vulnerabilities
6. **Follow OWASP guidelines** - For web application security

## Security Tools

We recommend using these tools for security testing:

- `npm audit` - Check for known vulnerabilities in dependencies
- `eslint-plugin-security` - Static analysis for security issues
- `helmet` - Already integrated for security headers
- Regular penetration testing

## Responsible Disclosure

We believe in responsible disclosure and will:

- Work with you to understand and fix the issue
- Credit you for your discovery (unless you prefer to remain anonymous)
- Keep you informed about our progress
- Not take legal action against you if you follow these guidelines

Thank you for helping keep Nomu and our users safe!
