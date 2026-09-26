#!/usr/bin/env python3
"""
Secure Remote Deployment Utility for KuraStream.
Uses key-based SSH authentication and system known_hosts verification.
Credentials must be managed via SSH keys (e.g. ssh-agent or ~/.ssh/id_ed25519).
"""

import os
import sys
import subprocess

def run_remote(cmd: str) -> int:
    remote_host = os.getenv("DEPLOY_HOST", "192.168.18.4")
    remote_user = os.getenv("DEPLOY_USER", "dserver-calos")
    ssh_target = f"{remote_user}@{remote_host}"

    ssh_cmd = [
        "ssh",
        "-o", "BatchMode=yes",
        "-o", "StrictHostKeyChecking=accept-new",
        ssh_target,
        cmd
    ]

    try:
        result = subprocess.run(ssh_cmd, check=False)
        return result.returncode
    except FileNotFoundError:
        print("Error: 'ssh' executable not found in PATH.", file=sys.stderr)
        return 127
    except Exception as e:
        print(f"Error executing remote command: {e}", file=sys.stderr)
        return 1

if __name__ == '__main__':
    if len(sys.argv) > 1:
        sys.exit(run_remote(' '.join(sys.argv[1:])))
    else:
        print("Usage: deploy_remote.py <remote_command>")
        print("Environment overrides: DEPLOY_HOST, DEPLOY_USER")
        sys.exit(1)
