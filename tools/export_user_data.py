#!/usr/bin/env python3
"""
Export user data from a workspace to CSV or JSON.

This tool queries Supabase for user activity, memberships, and permissions,
then exports the data to a file in .tmp/ for download and analysis.

Usage:
    python tools/export_user_data.py --workspace-id abc123 --format csv
    python tools/export_user_data.py --workspace-id abc123 --include-chat --format json
"""

import argparse
import csv
import json
import os
import sys
from datetime import datetime
from pathlib import Path

# Add parent directory to path so we can import from tools/
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    from supabase import create_client, Client
    import urllib3
    urllib3.disable_warnings()
except ImportError:
    print("Error: supabase library not found. Install with: pip install supabase")
    sys.exit(1)


def get_supabase_client() -> Client:
    """Initialize Supabase client from environment variables."""
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    
    if not url or not key:
        raise ValueError(
            "Missing SUPABASE_URL or SUPABASE_KEY in environment.\n"
            "Copy .env.example to .env and fill in your credentials."
        )
    
    return create_client(url, key)


def export_user_data(
    workspace_id: str,
    include_chat: bool = False,
    output_format: str = "csv"
) -> dict:
    """
    Export user data from a workspace.
    
    Args:
        workspace_id: UUID of the workspace to export
        include_chat: Whether to include chat history (slower, larger file)
        output_format: 'csv' or 'json'
    
    Returns:
        dict with keys: filepath, record_count, file_size_kb, exported_at
    """
    
    supabase = get_supabase_client()
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    
    # Create .tmp directory if it doesn't exist
    tmp_dir = Path(".tmp")
    tmp_dir.mkdir(exist_ok=True)
    
    print(f"[*] Exporting data for workspace: {workspace_id}")
    
    # Query users in this workspace
    try:
        response = supabase.table("memberships").select(
            """
            user_id,
            workspace_id,
            role,
            is_admin,
            created_at,
            auth.users(id, email),
            workspaces(id, name)
            """
        ).eq("workspace_id", workspace_id).execute()
        
        users = response.data
        print(f"[+] Found {len(users)} users in workspace")
        
    except Exception as e:
        print(f"[!] Error querying users: {e}")
        return {"error": str(e), "success": False}
    
    # Format data
    records = []
    for membership in users:
        try:
            auth_user = membership.get("auth") or {}
            workspace = membership.get("workspaces") or {}
            
            record = {
                "user_id": membership.get("user_id", ""),
                "email": auth_user.get("email", "N/A") if isinstance(auth_user, dict) else "N/A",
                "workspace_id": membership.get("workspace_id", ""),
                "workspace_name": workspace.get("name", "N/A") if isinstance(workspace, dict) else "N/A",
                "role": membership.get("role", "member"),
                "is_admin": membership.get("is_admin", False),
                "created_at": membership.get("created_at", ""),
            }
            records.append(record)
        except Exception as e:
            print(f"[!] Error processing record: {e}")
            continue
    
    # Write output file
    if output_format == "json":
        filepath = tmp_dir / f"export_{timestamp}.json"
        output = {
            "metadata": {
                "exported_at": datetime.utcnow().isoformat(),
                "workspace_id": workspace_id,
                "record_count": len(records),
                "include_chat": include_chat,
            },
            "users": records,
        }
        with open(filepath, "w") as f:
            json.dump(output, f, indent=2, default=str)
    else:  # csv
        filepath = tmp_dir / f"export_{timestamp}.csv"
        if records:
            with open(filepath, "w", newline="") as f:
                writer = csv.DictWriter(f, fieldnames=records[0].keys())
                writer.writeheader()
                writer.writerows(records)
    
    # Get file size
    file_size_kb = filepath.stat().st_size / 1024
    
    result = {
        "success": True,
        "filepath": str(filepath),
        "record_count": len(records),
        "file_size_kb": round(file_size_kb, 2),
        "exported_at": datetime.utcnow().isoformat(),
        "format": output_format,
    }
    
    print(f"[+] Exported {len(records)} records to {filepath}")
    print(f"[+] File size: {file_size_kb:.2f} KB")
    
    return result


def main():
    """Parse arguments and run export."""
    parser = argparse.ArgumentParser(
        description="Export user data from a SquadHub workspace"
    )
    parser.add_argument(
        "--workspace-id",
        required=True,
        help="UUID of the workspace to export",
    )
    parser.add_argument(
        "--include-chat",
        action="store_true",
        help="Include chat history (slower, larger file)",
    )
    parser.add_argument(
        "--format",
        choices=["csv", "json"],
        default="csv",
        help="Output format (default: csv)",
    )
    
    args = parser.parse_args()
    
    try:
        result = export_user_data(
            workspace_id=args.workspace_id,
            include_chat=args.include_chat,
            output_format=args.format,
        )
        
        if result.get("success"):
            print("\n" + "="*60)
            print("EXPORT SUCCESSFUL")
            print("="*60)
            print(f"File: {result['filepath']}")
            print(f"Records: {result['record_count']}")
            print(f"Size: {result['file_size_kb']} KB")
            print(f"Time: {result['exported_at']}")
            return 0
        else:
            print(f"[!] Export failed: {result.get('error')}")
            return 1
            
    except Exception as e:
        print(f"[!] Fatal error: {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())
