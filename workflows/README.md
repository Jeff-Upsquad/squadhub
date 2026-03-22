# Workflows

This directory contains Markdown SOPs (Standard Operating Procedures) that define how to accomplish objectives.

## Purpose

Workflows are the instruction layer of the WAT framework. Each workflow:
- Defines a clear objective
- Specifies required inputs
- Lists which tools to use and in what sequence
- Describes expected outputs
- Includes edge case handling and troubleshooting

## Structure

```
workflows/
├── README.md                    # This file
├── [workflow_name].md           # Example: scrape_website.md, export_to_sheets.md
└── ...
```

## Workflow Template

Each workflow should include:

### Header
- **Objective**: What this workflow accomplishes
- **Inputs**: What data or configuration is needed before starting
- **Tools Used**: Which scripts from `../tools/` are called
- **Estimated Time**: How long this typically takes

### Steps
- Numbered, clear instructions for the agent
- Tool calls with specific parameters
- Error handling and recovery steps

### Outputs
- What gets produced
- Where outputs are stored (cloud services, `.tmp/`, etc.)
- Format and structure of the output data

### Examples
- Real usage examples
- Common scenarios and variations

## Updating Workflows

When you:
- Find a better method → update the workflow
- Discover rate limits or constraints → document them
- Hit a recurring error → add troubleshooting steps
- Improve a tool → update the workflow to reflect the change

Always preserve workflow improvements so the system gets stronger over time.

## Important Notes

- **Never overwrite workflows without asking** unless explicitly instructed
- Workflows should evolve as you learn what works
- Document failures so they don't happen again
- Share learnings through workflow updates
