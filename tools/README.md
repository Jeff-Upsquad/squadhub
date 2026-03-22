# Tools

This directory contains Python scripts that handle deterministic execution.

## Purpose

Tools are the execution layer of the WAT framework. Each script in this directory:
- Performs a specific, well-defined task
- Handles API calls, data transformations, file operations, or database queries
- Uses credentials from `.env` or cloud authentication files
- Is consistent, testable, and can be run independently

## Structure

```
tools/
├── README.md              # This file
├── scrape_single_site.py  # Example: scrape a single website
├── export_to_sheets.py    # Example: export data to Google Sheets
└── [tool_name].py         # Add new tools as needed
```

## Before Creating a New Tool

1. Check if a similar tool already exists
2. Define the tool's single responsibility clearly
3. Document its inputs, outputs, and any external dependencies
4. Add error handling and retry logic where appropriate

## Running Tools

Tools are called by the agent (AI coordinator) in `CLAUDE.md`. To run a tool manually:

```bash
python tools/[tool_name].py [arguments]
```

## Credentials

Tools should read credentials from:
- `.env` file for API keys and configuration
- `credentials.json` / `token.json` for Google OAuth (gitignored)
- Environment variables set by the system

Never hardcode secrets in tool scripts.
