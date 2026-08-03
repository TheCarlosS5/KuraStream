import sys
import subprocess

def run_local_command(cmd_list):
    print(f"\n[RUNNING LOCAL] {' '.join(cmd_list)}")
    result = subprocess.run(cmd_list, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"[ERROR] Command failed with code {result.returncode}")
        print(f"Stdout: {result.stdout}")
        print(f"Stderr: {result.stderr}")
        return False
    print(result.stdout)
    return True

def main():
    ip = "192.168.18.38"
    user = "dserver-calos"
    remote_host = f"{user}@{ip}"
    remote_dir = "/home/dserver-calos/KuraStream"
    
    print("=== Step 1: Installing Node.js & FFmpeg Locally on Remote Host ===")
    setup_commands = (
        "mkdir -p /home/dserver-calos/bin && "
        "mkdir -p /home/dserver-calos/node && "
        "cd /home/dserver-calos/bin && "
        "if [ ! -f /home/dserver-calos/node/bin/node ]; then "
        "  echo 'Downloading Node.js v22.13.1...' && "
        "  wget -q https://nodejs.org/dist/v22.13.1/node-v22.13.1-linux-x64.tar.xz && "
        "  echo 'Extracting Node.js...' && "
        "  tar -xJf node-v22.13.1-linux-x64.tar.xz -C /home/dserver-calos/node --strip-components=1 && "
        "  rm node-v22.13.1-linux-x64.tar.xz; "
        "else "
        "  echo 'Node.js is already installed locally.'; "
        "fi && "
        "if [ ! -f ffmpeg ]; then "
        "  echo 'Downloading FFmpeg static build...' && "
        "  wget -q https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz && "
        "  echo 'Extracting FFmpeg...' && "
        "  tar -xJf ffmpeg-release-amd64-static.tar.xz && "
        "  mv ffmpeg-*-static/ffmpeg ffmpeg-*-static/ffprobe . && "
        "  rm -rf ffmpeg-*-static ffmpeg-release-amd64-static.tar.xz; "
        "else "
        "  echo 'FFmpeg is already installed locally.'; "
        "fi && "
        "if ! grep -q 'export PATH=$HOME/node/bin' /home/dserver-calos/.bashrc; then "
        "  echo 'export PATH=$HOME/node/bin:$HOME/bin:$PATH' >> /home/dserver-calos/.bashrc; "
        "fi"
    )
    
    if not run_local_command(["ssh", "-o", "StrictHostKeyChecking=no", remote_host, setup_commands]):
        sys.exit(1)

    print("\n=== Step 2: Streaming Project Files via SSH Pipeline (9GB - please wait) ===")
    # Direct streaming pipeline: tar local | ssh extraction remote
    # This prevents creating heavy temporary files locally or on remote /tmp/
    sync_pipeline = (
        f"tar -cf - "
        f"--exclude=.git "
        f"--exclude=node_modules "
        f"--exclude=backend/kurastream.db-journal "
        f"--exclude=backend/kurastream.db-wal "
        f"--exclude=backend/kurastream.db-shm "
        f"-C /home/carlossgr/Escritorio/KuraStream . | "
        f"ssh -o StrictHostKeyChecking=no {remote_host} \"mkdir -p {remote_dir} && tar -xf - -C {remote_dir}\""
    )
    
    print("Streaming files...")
    # Since this is a piped shell command, we run it through shell=True
    result = subprocess.run(sync_pipeline, shell=True, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"[ERROR] Streaming failed with code {result.returncode}")
        print(f"Stderr: {result.stderr}")
        sys.exit(1)
    print("Files successfully streamed and extracted.")

    print("\n=== Step 3: Running npm install on Remote Server ===")
    build_commands = (
        f"export PATH=/home/dserver-calos/node/bin:/home/dserver-calos/bin:\\$PATH && "
        f"cd {remote_dir} && "
        "npm install"
    )
    if not run_local_command(["ssh", "-o", "StrictHostKeyChecking=no", remote_host, build_commands]):
        sys.exit(1)

    print("\n=== Step 4: Starting KuraStream Server on Remote Server ===")
    start_command = (
        f"export PATH=/home/dserver-calos/node/bin:/home/dserver-calos/bin:\\$PATH && "
        f"cd {remote_dir} && "
        "nohup node --env-file=.env backend/server.js > server.log 2>&1 & "
        "echo 'KuraStream server is now running in the background on the remote server.'"
    )
    if not run_local_command(["ssh", "-o", "StrictHostKeyChecking=no", remote_host, start_command]):
        sys.exit(1)

    print("\n=== Remote Deployment Completed Successfully! ===")

if __name__ == "__main__":
    main()
