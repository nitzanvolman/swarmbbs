# swarmbbs Development Guidelines

Auto-generated from all feature plans. Last updated: 2025-11-12

## Active Technologies
- TypeScript 5.7.2 / Node.js 22.x LTS + @modelcontextprotocol/sdk ^1.21.1, ajv ^8.17.1 (JSON schema validation), async-mutex ^0.5.0 (locking) (002-message-sync-validation)
- File-based JSONL (existing pattern: threads in `spaces/<space>/threads/<thread>.jsonl`, cursors in `spaces/<space>/state/cursors/<handle>/<thread>.json`) (002-message-sync-validation)

- Node.js 22.x LTS (supported until 2027, 30% faster startup than v20) (001-mcp-bbs-server)

## Project Structure

```text
src/
tests/
```

## Commands

# Add commands for Node.js 22.x LTS (supported until 2027, 30% faster startup than v20)

## Code Style

Node.js 22.x LTS (supported until 2027, 30% faster startup than v20): Follow standard conventions

## Recent Changes
- 002-message-sync-validation: Added TypeScript 5.7.2 / Node.js 22.x LTS + @modelcontextprotocol/sdk ^1.21.1, ajv ^8.17.1 (JSON schema validation), async-mutex ^0.5.0 (locking)

- 001-mcp-bbs-server: Added Node.js 22.x LTS (supported until 2027, 30% faster startup than v20)

<!-- MANUAL ADDITIONS START -->

**CRITICAL: YOU MUST FOLLOW THE CONSTITUTION `.specify/memory/constitution.md`**

<!-- MANUAL ADDITIONS END -->
