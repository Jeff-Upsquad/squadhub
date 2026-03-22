# Export User Data to CSV

## Objective
Export user activity, workspace memberships, and permissions to a CSV file for analytics, reporting, or backup purposes.

## Inputs
- **workspace_id** (UUID): The workspace to export data from
- **include_chat_history** (boolean, optional): Whether to include message data (default: false)
- **output_format** (string, optional): 'csv' or 'json' (default: 'csv')

## Tools Used
- `tools/export_user_data.py` — Queries database and formats output

## Estimated Time
- Small workspace (<100 users): 30 seconds
- Large workspace (1000+ users): 2-3 minutes

## Steps

### 1. Prepare inputs
Gather required parameters:
- workspace_id from your database or URL
- Decide if you need chat history (larger file, takes longer)
- Choose output format (CSV for spreadsheets, JSON for APIs)

### 2. Run the tool
```bash
cd /opt/squadhub
python tools/export_user_data.py \
  --workspace-id abc123-def456 \
  --include-chat \
  --format csv
```

The tool will:
1. Query Supabase for user data + workspace memberships
2. Join with permissions + roles
3. Format and write to `.tmp/export_[timestamp].csv`
4. Return file path and record count

### 3. Retrieve the export
```bash
# Find the file
ls -lh .tmp/export_*.csv

# Download to your machine
scp root@72.61.245.97:/opt/squadhub/.tmp/export_*.csv ~/Downloads/
```

### 4. Verify and use
- Open CSV in Excel/Sheets
- Verify row counts match your expectations
- Delete from `.tmp/` after using (it's disposable)

## Outputs

**File**: `.tmp/export_[timestamp].[csv|json]`  
**Location**: VPS in `/opt/squadhub/.tmp/`

**CSV Columns**:
- user_id
- email
- display_name
- workspace_id
- workspace_name
- role
- is_admin
- created_at
- last_active

**JSON Structure**:
```json
{
  "metadata": {
    "exported_at": "2026-03-23T12:34:56Z",
    "workspace_id": "abc123",
    "record_count": 42
  },
  "users": [...]
}
```

## Examples

### Export all users from a workspace as CSV
```bash
python tools/export_user_data.py --workspace-id xyz789
```

### Export with chat history as JSON
```bash
python tools/export_user_data.py \
  --workspace-id xyz789 \
  --include-chat \
  --format json
```

### Scheduled daily export
Run via cron (add to `/etc/crontab`):
```bash
0 2 * * * cd /opt/squadhub && python tools/export_user_data.py --workspace-id xyz789 >> .tmp/exports.log 2>&1
```

## Troubleshooting

**"Database connection failed"**
- Check `.env` has `SUPABASE_URL` and `SUPABASE_KEY`
- Verify network connectivity to Supabase

**"No such file or directory: tools/export_user_data.py"**
- Run from `/opt/squadhub` directory
- Check script exists: `ls tools/export_user_data.py`

**"Permission denied writing to .tmp/"**
- Verify `.tmp/` exists: `mkdir -p .tmp`
- Check permissions: `ls -ld .tmp/`

**Large file taking too long**
- Consider filtering by date range (future enhancement)
- Run during off-peak hours
- Split into smaller workspaces if possible

## Notes

- All temporary files are in `.tmp/` and can be safely deleted
- Sensitive data: ensure files are handled securely
- Chat history exports are write-only (no PII filtering yet)
- For production use, consider adding encryption
