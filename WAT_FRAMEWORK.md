# SquadHub - WAT Framework Implementation

This project follows the **WAT framework** (Workflows, Agents, Tools) architecture for reliable AI-assisted development.

## Architecture Overview

### Layer 1: Workflows (Instructions)
Located in `workflows/` - Markdown SOPs that define objectives, required tools, and execution steps.
- See [workflows/README.md](workflows/README.md) for details
- Document all processes, constraints, and learnings
- Update workflows as you discover better methods

### Layer 2: Agents (Decision-Making)
You (the AI assistant) coordinate between instructions and execution.
- Read relevant workflow
- Execute tools in correct sequence  
- Handle failures and ask clarifying questions
- Keep workflows current with learnings

### Layer 3: Tools (Execution)  
Located in `tools/` - Python scripts for deterministic, reliable work.
- See [tools/README.md](tools/README.md) for details
- One responsibility per tool
- Use `.env` for credentials
- Can be tested independently

## Project Structure

```
squadhub/
├── .env                  # Credentials and config (never commit)
├── .env.example          # Template for .env
├── .tmp/                 # Temporary processing files (gitignored, disposable)
├── tools/                # Python execution scripts
├── workflows/            # Markdown SOPs
├── admin/                # Admin web app
├── web/                  # Main web app
├── server/               # Backend server
├── shared/               # Shared code
├── mobile/               # Mobile app
├── desktop/              # Desktop app
└── supabase/             # Database migrations
```

## Key Principles

1. **Separation of Concerns**: Workflows guide thinking, tools handle execution
2. **Reliability**: Deterministic tools + good instructions = consistent results
3. **Learning Loop**: Fix failures, update workflows, improve the system
4. **Cloud Delivery**: Final outputs go to cloud services (Sheets, Slides, etc.)
5. **Temporary Storage**: Use `.tmp/` for intermediate files only

## Getting Started

1. Define a new workflow in `workflows/[name].md`
2. Create supporting tools in `tools/` as needed
3. Store credentials safely in `.env` (copy from `.env.example`)
4. Update workflows as you learn what works

## Reference

- See [CLAUDE.md](CLAUDE.md) for detailed instructions
- See [tools/README.md](tools/README.md) for tool guidelines
- See [workflows/README.md](workflows/README.md) for workflow guidance
