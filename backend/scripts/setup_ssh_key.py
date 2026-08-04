import os
import subprocess
import pexpect
import sys

def main():
    ip = "192.168.18.38"
    user = "dserver-calos"
    pw = "0101"
    
    # 1. Generate SSH key locally if it doesn't exist
    ssh_dir = os.path.expanduser("~/.ssh")
    key_path = os.path.join(ssh_dir, "id_rsa")
    pub_path = key_path + ".pub"
    
    if not os.path.exists(key_path):
        print("Generating local SSH key pair...")
        os.makedirs(ssh_dir, exist_ok=True)
        subprocess.run([
            "ssh-keygen", "-t", "rsa", "-N", "", "-f", key_path
        ], check=True)
        # Ensure permissions are correct
        os.chmod(ssh_dir, 0o700)
        os.chmod(key_path, 0o600)
    else:
        print("Local SSH key pair already exists.")
        
    with open(pub_path, "r") as f:
        pub_key = f.read().strip()
        
    # 2. Copy the public key to the remote authorized_keys file
    print("Setting up passwordless SSH on remote server...")
    
    # Remote shell command to register the key and fix permissions
    remote_cmd = (
        "mkdir -p ~/.ssh && "
        f"echo '{pub_key}' >> ~/.ssh/authorized_keys && "
        "chmod 700 ~/.ssh && "
        "chmod 600 ~/.ssh/authorized_keys && "
        "echo 'SSH Key successfully registered on remote server.'"
    )
    
    ssh_setup_cmd = f"ssh -o StrictHostKeyChecking=no {user}@{ip} \"{remote_cmd}\""
    
    child = pexpect.spawn(ssh_setup_cmd, encoding='utf-8', timeout=30)
    child.logfile = sys.stdout
    
    while True:
        index = child.expect([
            r'(?i)are you sure you want to continue connecting',
            r'(?i)password:',
            pexpect.EOF,
            pexpect.TIMEOUT
        ], timeout=20)
        
        if index == 0:
            child.sendline('yes')
        elif index == 1:
            child.sendline(pw)
        else:
            break
            
    child.close()
    if child.exitstatus == 0:
        print("\n=== Passwordless SSH configured successfully! ===")
    else:
        print(f"\nWarning: Setup failed with status code {child.exitstatus}")

if __name__ == '__main__':
    main()
