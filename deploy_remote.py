#!/usr/bin/env python3
import sys
import pexpect

def run_remote_root(cmd):
    child = pexpect.spawn("ssh -tt -o StrictHostKeyChecking=no dserver-calos@192.168.18.4", encoding='utf-8', timeout=600)
    idx = child.expect(['password:', 'Password:', 'contraseña:', r'\$', '#'], timeout=10)
    if idx in [0, 1, 2]:
        child.sendline('0101')
        child.expect([r'\$', '#'])
    
    child.sendline('su -')
    child.expect(['password:', 'Password:', 'contraseña:', 'Contraseña:'])
    child.sendline('0101')
    child.expect(['#'])
    
    # Run the command and echo exit status
    child.sendline(f"{cmd}; echo RESULT_STATUS_CODE_$?")
    
    while True:
        try:
            line = child.readline()
            if not line:
                break
            if 'RESULT_STATUS_CODE_' in line and 'echo RESULT_STATUS_CODE_' not in line:
                status_str = line.split('RESULT_STATUS_CODE_')[1].strip()
                code = int(status_str) if status_str.isdigit() else 0
                child.sendline('exit')
                child.expect([r'\$', '#'])
                child.sendline('exit')
                child.close()
                return code
            if 'RESULT_STATUS_CODE_' not in line:
                print(line, end='', flush=True)
        except (pexpect.EOF, pexpect.TIMEOUT):
            break
    child.close()
    return 0

if __name__ == '__main__':
    if len(sys.argv) > 1:
        sys.exit(run_remote_root(' '.join(sys.argv[1:])))
    else:
        print("Usage: deploy_remote.py <command>")

