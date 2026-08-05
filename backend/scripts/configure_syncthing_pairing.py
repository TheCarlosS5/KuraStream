import os
import sys
import subprocess
import xml.etree.ElementTree as ET

LOCAL_ID = "MVO7T23-OXV7N2I-5XX5ZXG-4M7TAIV-KGVT2NQ-WSQ4Q6P-KVP6YSH-BHICOQU"
REMOTE_ID = "DZHR5VT-DRUGXT5-YENYY7X-CU64RE4-5Y3KM6N-2GBREGR-225RBNI-2FLIRAT"

REMOTE_HOST = "dserver-calos@192.168.18.4"
LOCAL_PATH = "/home/carlossgr/Escritorio/KuraStream"
REMOTE_PATH = "/home/dserver-calos/KuraStream"

def configure_xml_content(xml_text, own_id, peer_id, folder_path, peer_name="PeerDevice"):
    tree = ET.ElementTree(ET.fromstring(xml_text))
    root = tree.getroot()
    
    # 1. Add peer device if not present
    device_exists = False
    for dev in root.findall("device"):
        if dev.get("id") == peer_id:
            device_exists = True
            break
            
    if not device_exists:
        dev_elem = ET.Element("device", {
            "id": peer_id,
            "name": peer_name,
            "compression": "metadata",
            "introducer": "false",
            "skipIntroductionRemovals": "false",
            "introducedBy": ""
        })
        dev_elem.append(ET.Element("address", {"value": "dynamic"}))
        root.append(dev_elem)
        
    # 2. Add or update kurastream-sync folder
    folder_elem = None
    for f in root.findall("folder"):
        if f.get("id") == "kurastream-sync":
            folder_elem = f
            break
            
    if folder_elem is None:
        folder_elem = ET.Element("folder", {
            "id": "kurastream-sync",
            "label": "KuraStream Code Sync",
            "path": folder_path,
            "type": "sendreceive",
            "rescanIntervalS": "10",
            "fsWatcherEnabled": "true",
            "fsWatcherDelayS": "1",
            "ignorePerms": "false",
            "autoNormalize": "true"
        })
        root.append(folder_elem)
    else:
        folder_elem.set("path", folder_path)
        
    # Ensure both devices are assigned to folder
    dev_ids_in_folder = [d.get("id") for d in folder_elem.findall("device")]
    if own_id not in dev_ids_in_folder:
        folder_elem.append(ET.Element("device", {"id": own_id, "introducedBy": ""}))
    if peer_id not in dev_ids_in_folder:
        folder_elem.append(ET.Element("device", {"id": peer_id, "introducedBy": ""}))
        
    return ET.tostring(root, encoding="utf-8").decode("utf-8")

def main():
    print("=== Step 1: Configuring Local Syncthing config.xml ===")
    local_config_path = os.path.expanduser("~/.config/syncthing/config.xml")
    with open(local_config_path, "r", encoding="utf-8") as f:
        local_xml = f.read()
        
    updated_local_xml = configure_xml_content(local_xml, LOCAL_ID, REMOTE_ID, LOCAL_PATH, "DebianServer-Calos")
    with open(local_config_path, "w", encoding="utf-8") as f:
        f.write(updated_local_xml)
    print("Local config.xml updated successfully.")
    
    print("\n=== Step 2: Configuring Remote Syncthing config.xml via SSH ===")
    ssh_cat = subprocess.run(["ssh", "-o", "StrictHostKeyChecking=no", REMOTE_HOST, "cat /home/dserver-calos/.config/syncthing/config.xml"], capture_output=True, text=True, check=True)
    remote_xml = ssh_cat.stdout
    
    updated_remote_xml = configure_xml_content(remote_xml, REMOTE_ID, LOCAL_ID, REMOTE_PATH, "Local-Workstation")
    
    # Push updated XML back to remote
    push_process = subprocess.Popen(["ssh", "-o", "StrictHostKeyChecking=no", REMOTE_HOST, "cat > /home/dserver-calos/.config/syncthing/config.xml"], stdin=subprocess.PIPE, text=True)
    push_process.communicate(input=updated_remote_xml)
    if push_process.returncode == 0:
        print("Remote config.xml updated successfully.")
    else:
        print("Error updating remote config.xml")
        sys.exit(1)

if __name__ == "__main__":
    main()
