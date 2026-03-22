# WAT Framework - Getting Started

This guide shows you how to use the Workflows, Agents, Tools architecture with a real example.

## The Pattern

### Layer 1: You write a Workflow (Instructions)
📄 File: `workflows/export-user-data.md`

A Markdown guide that defines:
- **What** you're trying to accomplish
- **How** to get inputs ready
- **Which tool** to run and with what parameters
- **Where** to find outputs
- **Examples** for common scenarios

**Key principle**: Written like you're briefing a team member. No code.

### Layer 2: AI coordinates (That's me)
I read your workflow and decide:
- Are all inputs ready?
- Should we run the tool now or gather more data first?
- How to handle errors
- When to update the workflow based on what we learn

### Layer 3: Python tool executes (Deterministic)
🐍 File: `tools/export_user_data.py`

A Python script that:
- Takes clear parameters
- Queries databases / APIs
- Processes data deterministically
- Returns structured output
- Can be tested independently

**Key principle**: One tool = one job. Tested, reliable, version-controlled.

---

## Real Example: Exporting User Data

### Step 1: Read the workflow

```
cat workflows/export-user-data.md
```

You'll see:
- Objective: Export user data to CSV/JSON
- Inputs needed: `workspace_id`, optional flags
- Tool to use: `tools/export_user_data.py`
- Expected outputs: File in `.tmp/export_[timestamp].csv`

### Step 2: Set up credentials

Copy template and fill in your secrets:
```bash
cp .env.example .env
nano .env  # Add SUPABASE_URL and SUPABASE_KEY
```

### Step 3: Run the tool

Follow the workflow steps on the VPS:
```bash
cd /opt/squadhub
python tools/export_user_data.py --workspace-id abc123-uuid --format csv
```

The tool runs, queries database, writes to `.tmp/`, returns file path.

### Step 4: Use the output

```bash
# Download the file
scp root@72.61.245.97:/opt/squadhub/.tmp/export_*.csv ~/Downloads/

# Use in spreadsheet, database, analytics, etc.
```

---

## Creating Your Own Workflow + Tool

When you have a repetitive task, create both:

### 1. Write the workflow (`.md` template)

**File**: `workflows/my-task-name.md`

```markdown
# My Task Name

## Objective
What does this accomplish?

## Inputs
- param1: description
- param2: description

## Tools Used
- `tools/my_tool.py`

## Steps
1. Prepare inputs
2. Run tool: `python tools/my_tool.py --param1 value1`
3. Verify outputs
4. Clean up

## Outputs
Where does the result go?

## Examples
Real usage examples
```

### 2. Write the tool (`.py` file)

**File**: `tools/my_tool.py`

```python
#!/usr/bin/env python3
"""
Tool description.
What does it do? What are inputs? Where do outputs go?
"""

import argparse
import os
from pathlib import Path

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--param1", required=True)
    parser.add_argument("--param2", default="value")
    args = parser.parse_args()
    
    # Do work here
    # Use environment variables from .env for credentials
    
    print("Done!")

if __name__ == "__main__":
    main()
```

### 3. Test it

```bash
python tools/my_tool.py --help
python tools/my_tool.py --param1 test_value
```

### 4. Document in the workflow

If you discover constraints, rate limits, or better methods, **update the workflow**.

---

## Best Practices

### ✅ DO:
- **Store secrets in `.env`** — never hardcode API keys
- **One tool = one responsibility** — don't build god-tools
- **Test tools independently** — they should work in isolation
- **Update workflows when you learn** — better methods, new constraints, error handling
- **Use `.tmp/` for temporary files** — they're disposable

### ❌ DON'T:
- **Hardcode credentials** — use environment variables
- **Mix AI thinking with tool execution** — workflows are for thinking, tools are for doing
- **Skip tool error handling** — assume inputs might be wrong
- **Commit `.env`** — it's gitignored for a reason
- **Keep old workflows around** — delete or update them, don't bury them

---

## File Structure Reference

```
squadhub/
├── .env                    # Your secrets (gitignored)
├── .env.example           # Template for .env
├── .tmp/                  # Temporary files (gitignored, disposable)
│   ├── export_20260323_120000.csv
│   └── ... (auto-cleanup safe)
│
├── workflows/             # Markdown SOPs (instructions)
│   ├── README.md
│   ├── export-user-data.md
│   └── [more workflows]
│
├── tools/                 # Python execution scripts
│   ├── README.md
│   ├── export_user_data.py
│   └── [more tools]
│
├── CLAUDE.md             # Agent instructions (this system)
└── WAT_FRAMEWORK.md      # Architecture overview
```

---

## Next Steps

1. **Try the example** — Run `export_user_data.py` to see it in action
2. **Create your first workflow** — Pick a repetitive task, write a workflow for it
3. **Write a tool** — Implement that workflow as a Python script
4. **Test and refine** — Update the workflow as you learn
5. **Share learnings** — Update workflows so the system improves

The more you use this, the stronger your system becomes. Every workflow you write, every tool you create, every constraint you document—it all makes the next person's job easier.

---

## Questions?

- Can't remember what a tool does? Read its docstring: `python tools/name.py --help`
- Need to add secrets? Update `.env.example` first, then `.env`
- Found a better way? Update the workflow and tool, commit, push
- Hit an error? Check the workflow troubleshooting section first
