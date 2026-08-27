# AI Browser Runtime — Development & Testing Guide

## 1. Prerequisites
- Node.js >= 20.0.0
- Google Chrome (latest stable)
- PowerShell 7+ / Bash

## 2. Directory Layout
- `host/`: Core TypeScript runtime engine, MCP adapter, and tests.
- `extension/`: Manifest V3 Chrome Extension.
- `docs/`: Architecture, security, and milestone specs.
- `tests/fixtures/`: Deterministic test HTML pages.

## 3. Running Tests
```bash
cd host
npm test
```

## 4. Building the Project
```bash
cd host
npm run build
```
