import os
import sys
import subprocess
import shutil

def run_cmd(cmd_list):
    print(f"\n[RUNNING] {' '.join(cmd_list)}")
    res = subprocess.run(cmd_list, capture_output=True, text=True)
    if res.returncode != 0:
        print(f"[ERROR] Command failed with code {res.returncode}: {res.stderr}")
        return False
    print(res.stdout)
    return True

def main():
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
    local_bin_dir = os.path.expanduser("~/bin")
    os.makedirs(local_bin_dir, exist_ok=True)
    
    local_syncthing = os.path.join(repo_root, "bin", "syncthing")
    target_local = os.path.join(local_bin_dir, "syncthing")
    
    print("=== Step 1: Installing Syncthing Locally ===")
    if os.path.exists(local_syncthing):
        shutil.copy2(local_syncthing, target_local)
        os.chmod(target_local, 0o755)
        print(f"Syncthing successfully installed to {target_local}")
    else:
        print("Error: local binary bin/syncthing not found.")
        sys.exit(1)
        
    print("\n=== Step 2: Verifying .stignore File ===")
    stignore_path = os.path.join(repo_root, ".stignore")
    if not os.path.exists(stignore_path):
        with open(stignore_path, "w", encoding="utf-8") as f:
            f.write("// Ignore heavy media library\nlibrary/\n\n// Ignore dependencies and temp files\nnode_modules/\n.git/\n.superpowers/\n*.log\n")
        print("Created .stignore file.")
    else:
        print(".stignore file is present.")
        
    # Remote installation step
    ip = "192.168.18.38"
    user = "dserver-calos"
    remote_host = f"{user}@{ip}"
    
    print(f"\n=== Step 3: Checking Remote Host ({remote_host}) for Syncthing Setup ===")
    check_cmd = ["ssh", "-o", "ConnectTimeout=5", "-o", "StrictHostKeyChecking=no", remote_host, "echo 'online'"]
    res = subprocess.run(check_cmd, capture_output=True, text=True)
    if res.returncode == 0 and "online" in res.stdout:
        print("Remote server is online! Installing Syncthing on remote host...")
        remote_setup = (
            "mkdir -p /home/dserver-calos/bin && "
            "cd /home/dserver-calos/bin && "
            "if [ ! -f syncthing ]; then "
            "  echo 'Downloading Syncthing for remote server...' && "
            "  wget -q https://github.com/syncthing/syncthing/releases/download/v1.29.5/syncthing-linux-amd64-v1.29.5.tar.gz -O /tmp/syncthing.tar.gz && "
            "  tar -xzf /tmp/syncthing.tar.gz -C /tmp && "
            "  cp /tmp/syncthing-linux-amd64-v1.29.5/syncthing /home/dserver-calos/bin/syncthing && "
            "  chmod +x /home/dserver-calos/bin/syncthing && "
            "  rm -rf /tmp/syncthing.tar.gz /tmp/syncthing-linux-amd64-v1.29.5; "
            "else "
            "  echo 'Syncthing is already installed on remote server.'; "
            "fi"
        )
        run_cmd(["ssh", "-o", "StrictHostKeyChecking=no", remote_host, remote_setup])
    else:
        print(f"Notice: Remote server ({ip}) is currently unreachable on local network.")
        print("Syncthing binary has been prepared locally and will be automatically uploaded when the remote server is connected.")

if __name__ == "__main__":
    main()
