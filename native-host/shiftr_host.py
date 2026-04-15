#!/usr/bin/env python3
"""
Shiftr — Native messaging host.
Reads Firefox profiles from profiles.ini and launches Firefox with a given profile.

configparser lowercases keys on write, but Firefox's profiles.ini is case-sensitive.
All write operations use raw text manipulation to preserve casing.
"""

import json
import struct
import sys
import os
import re
import subprocess
import configparser
import platform

VALID_PROFILE_NAME = re.compile(r"^[a-zA-Z0-9 _.\-]+$")


def get_profiles_ini_path():
    system = platform.system()
    if system == "Darwin":
        return os.path.expanduser("~/Library/Application Support/Firefox/profiles.ini")
    elif system == "Linux":
        return os.path.expanduser("~/.mozilla/firefox/profiles.ini")
    elif system == "Windows":
        return os.path.join(os.environ.get("APPDATA", ""), "Mozilla", "Firefox", "profiles.ini")
    return None


def get_firefox_path():
    system = platform.system()
    if system == "Darwin":
        return "/Applications/Firefox.app/Contents/MacOS/firefox"
    elif system == "Linux":
        return "firefox"
    elif system == "Windows":
        candidates = [
            os.path.join(os.environ.get("PROGRAMFILES", ""), "Mozilla Firefox", "firefox.exe"),
            os.path.join(os.environ.get("PROGRAMFILES(X86)", ""), "Mozilla Firefox", "firefox.exe"),
        ]
        for c in candidates:
            if os.path.exists(c):
                return c
        return "firefox.exe"
    return "firefox"


def _read_config(path):
    """Read profiles.ini with a case-preserving ConfigParser (for reads only)."""
    config = configparser.RawConfigParser()
    config.optionxform = str
    config.read(path)
    return config


def _spawn_firefox(*args):
    """Launch Firefox with the given arguments in the background."""
    firefox = get_firefox_path()
    try:
        subprocess.Popen(
            [firefox] + list(args),
            start_new_session=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return {}
    except Exception as e:
        return {"error": str(e)}


def _validate_profile_name(name):
    if not name:
        return "No profile name provided"
    if not VALID_PROFILE_NAME.match(name):
        return "Invalid profile name. Use only letters, numbers, spaces, hyphens, underscores, and dots."
    return None


def list_profiles():
    """Parse profiles.ini once and return (profiles_list, current_profile_name)."""
    path = get_profiles_ini_path()
    if not path:
        return [], None

    config = _read_config(path)

    # Build path->name map from Profile sections in one pass
    profiles = []
    path_to_name = {}
    default_flag_name = None

    for section in config.sections():
        if section.startswith("Profile"):
            name = config.get(section, "Name", fallback=None)
            if name:
                profiles.append({"name": name})
                prof_path = config.get(section, "Path", fallback=None)
                if prof_path:
                    path_to_name[prof_path] = name
                if config.get(section, "Default", fallback="0") == "1":
                    default_flag_name = name

    # Determine current profile from Install section
    current = None
    for section in config.sections():
        if section.startswith("Install"):
            default_path = config.get(section, "Default", fallback=None)
            if default_path and default_path in path_to_name:
                current = path_to_name[default_path]
                break

    if current is None:
        current = default_flag_name

    return profiles, current


def rename_profile(old_name, new_name):
    path = get_profiles_ini_path()
    if not path:
        return {"error": "Cannot find profiles.ini"}

    with open(path, "r") as f:
        content = f.read()

    pattern = re.compile(r"^(Name\s*=\s*)" + re.escape(old_name) + r"$", re.MULTILINE | re.IGNORECASE)
    new_content, count = pattern.subn(r"\g<1>" + new_name, content)

    if count == 0:
        return {"error": f"Profile '{old_name}' not found"}

    with open(path, "w") as f:
        f.write(new_content)

    return {}


def set_default_profile(profile_name):
    path = get_profiles_ini_path()
    if not path:
        return {"error": "Cannot find profiles.ini"}

    # Single read: use configparser to find target path, then read raw lines
    config = _read_config(path)

    target_path = None
    target_section = None
    for section in config.sections():
        if section.startswith("Profile"):
            if config.get(section, "Name", fallback=None) == profile_name:
                target_path = config.get(section, "Path", fallback=None)
                target_section = section
                break

    if not target_path:
        return {"error": f"Profile '{profile_name}' not found"}

    with open(path, "r") as f:
        lines = f.readlines()

    result = []
    in_section = None
    added_default = False

    for line in lines:
        stripped = line.strip()

        if stripped.startswith("["):
            # Before leaving the target section, insert Default=1 if not yet added
            if in_section == target_section and not added_default:
                result.append("Default=1\n")
                added_default = True
            in_section = stripped.strip("[]")

        # Strip Default= from all Profile sections
        if in_section and in_section.startswith("Profile"):
            if stripped.lower().startswith("default="):
                continue

        # Rewrite Default= in Install sections to point to target
        if in_section and in_section.startswith("Install"):
            if stripped.lower().startswith("default="):
                result.append(f"Default={target_path}\n")
                continue

        result.append(line)

    # Target section was the last section in file
    if in_section == target_section and not added_default:
        result.append("Default=1\n")

    with open(path, "w") as f:
        f.writelines(result)

    return {}


def create_profile(profile_name):
    firefox = get_firefox_path()
    try:
        result = subprocess.run(
            [firefox, "-CreateProfile", profile_name],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode != 0:
            return {"error": result.stderr.strip() or "Failed to create profile"}
        return {}
    except subprocess.TimeoutExpired:
        return {"error": "Timed out creating profile"}
    except Exception as e:
        return {"error": str(e)}


def open_about_profiles():
    return _spawn_firefox("-url", "about:profiles")


def launch_profile(profile_name):
    return _spawn_firefox("-P", profile_name, "-no-remote")


def read_message():
    raw_length = sys.stdin.buffer.read(4)
    if not raw_length:
        sys.exit(0)
    length = struct.unpack("@I", raw_length)[0]
    message = sys.stdin.buffer.read(length).decode("utf-8")
    return json.loads(message)


def send_message(obj):
    encoded = json.dumps(obj).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("@I", len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()


def main():
    msg = read_message()
    action = msg.get("action")

    if action == "list":
        profiles, current = list_profiles()
        send_message({"profiles": profiles, "current_profile": current})

    elif action == "rename":
        old_name = msg.get("old_name")
        new_name = msg.get("new_name")
        err = _validate_profile_name(old_name) or _validate_profile_name(new_name)
        if err:
            send_message({"error": err})
        else:
            send_message(rename_profile(old_name, new_name))

    elif action == "set_default":
        profile_name = msg.get("profile")
        if not profile_name:
            send_message({"error": "No profile name provided"})
        else:
            send_message(set_default_profile(profile_name))

    elif action == "create":
        profile_name = msg.get("profile")
        err = _validate_profile_name(profile_name)
        if err:
            send_message({"error": err})
        else:
            send_message(create_profile(profile_name))

    elif action == "open_about_profiles":
        send_message(open_about_profiles())

    elif action == "launch":
        profile_name = msg.get("profile")
        if not profile_name:
            send_message({"error": "No profile name provided"})
        else:
            send_message(launch_profile(profile_name))

    else:
        send_message({"error": f"Unknown action: {action}"})


if __name__ == "__main__":
    main()
