import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import child_process from 'child_process';
import { execSync } from 'child_process';
import ora from 'ora';
import chalk from 'chalk';

// Path to the installed CPD binary
const getExecutablePath = () => {
  // On Windows, use the installed location or the current file location
  if (os.platform() === 'win32') {
    try {
      // First check global npm installs
      const npmGlobal = execSync('npm root -g').toString().trim();
      const possiblePath = path.join(npmGlobal, '..', 'cpd.cmd');
      if (fs.existsSync(possiblePath)) {
        return possiblePath;
      }
    } catch (e) {
      // Ignore error if npm not found
    }
    
    // Fallback to current directory executable
    const currentDir = path.resolve(process.cwd());
    return path.join(currentDir, 'bin', 'cpd.js');
  }
  
  // On macOS and Linux, we expect it to be in the PATH
  return 'cpd';
};

// Windows implementation using registry
const windowsIntegration = {
  install: async () => {
    const spinner = ora('Adding Windows Explorer context menu integration...').start();
    
    try {
      const filezapPath = getExecutablePath();
      
      // Use a more direct approach with vbscript to avoid PowerShell window showing at all
      const registryContent = `Windows Registry Editor Version 5.00

; FileZap Share menu for files
[HKEY_CURRENT_USER\\Software\\Classes\\*\\shell\\FileZapShare]
@="Share via FileZap"
"Icon"="%SystemRoot%\\System32\\shell32.dll,133"

[HKEY_CURRENT_USER\\Software\\Classes\\*\\shell\\FileZapShare\\command]
@="wscript.exe //nologo //e:vbscript \\"Dim shell\\nSet shell = CreateObject(\\\\\\"WScript.Shell\\\\\\")\\nshell.Run \\\\\\""${filezapPath.replace(/\\/g, '\\\\')}"\\\\\\" share-ui \\\\\\""\\"%1\\"\\\\\\"\\", 0, false\\n\\""

; FileZap Share menu for folders
[HKEY_CURRENT_USER\\Software\\Classes\\Directory\\shell\\FileZapShare]
@="Share via FileZap"
"Icon"="%SystemRoot%\\System32\\shell32.dll,133"

[HKEY_CURRENT_USER\\Software\\Classes\\Directory\\shell\\FileZapShare\\command]
@="wscript.exe //nologo //e:vbscript \\"Dim shell\\nSet shell = CreateObject(\\\\\\"WScript.Shell\\\\\\")\\nshell.Run \\\\\\""${filezapPath.replace(/\\/g, '\\\\')}"\\\\\\" share-ui \\\\\\""\\"%1\\"\\\\\\"\\", 0, false\\n\\""
`;

      // Write registry file
      const regFilePath = path.join(os.tmpdir(), 'filezap_shell_integration.reg');
      fs.writeFileSync(regFilePath, registryContent);
      
      // Execute the registry file
      execSync(`regedit /s "${regFilePath}"`);
      spinner.succeed('Windows Explorer integration installed successfully!');
      console.log(chalk.cyan('\nYou can now right-click on any file or folder and select "Share via FileZap"'));
      
      return true;
    } catch (error) {
      spinner.fail(`Failed to install Windows Explorer integration: ${error.message}`);
      console.log(chalk.red('\nYou may need to run this command with administrator privileges'));
      return false;
    }
  },
  
  uninstall: async () => {
    const spinner = ora('Removing Windows Explorer context menu integration...').start();
    
    try {
      const registryContent = `Windows Registry Editor Version 5.00

; Remove FileZap Share menu for files
[-HKEY_CURRENT_USER\\Software\\Classes\\*\\shell\\FileZapShare]

; Remove FileZap Share menu for folders
[-HKEY_CURRENT_USER\\Software\\Classes\\Directory\\shell\\FileZapShare]
`;

      // Write registry file
      const regFilePath = path.join(os.tmpdir(), 'filezap_shell_uninstall.reg');
      fs.writeFileSync(regFilePath, registryContent);
      
      // Execute the registry file
      execSync(`regedit /s "${regFilePath}"`);
      spinner.succeed('Windows Explorer integration removed successfully!');
      return true;
    } catch (error) {
      spinner.fail(`Failed to remove Windows Explorer integration: ${error.message}`);
      console.log(chalk.red('\nYou may need to run this command with administrator privileges'));
      return false;
    }
  }
};

// macOS implementation using Automator Service
const macosIntegration = {
  install: async () => {
    const spinner = ora('Adding macOS Finder context menu integration...').start();
    
    try {
      const cpdPath = getExecutablePath();
      const servicesDir = path.join(os.homedir(), 'Library', 'Services');
      fs.ensureDirSync(servicesDir);
      
      // Create the workflow directory
      const workflowName = 'Share via FileZap.workflow';
      const workflowDir = path.join(servicesDir, workflowName);
      const contentsDir = path.join(workflowDir, 'Contents');
      const infoDir = path.join(contentsDir, 'Info.plist');
      const documentDir = path.join(contentsDir, 'document.wflow');
      
      fs.ensureDirSync(workflowDir);
      fs.ensureDirSync(contentsDir);
      
      // Create Info.plist
      const infoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>NSServices</key>
    <array>
        <dict>
            <key>NSMenuItem</key>
            <dict>
                <key>default</key>
                <string>Share via FileZap</string>
            </dict>
            <key>NSMessage</key>
            <string>runWorkflowAsService</string>
            <key>NSRequiredContext</key>
            <dict>
                <key>NSApplicationIdentifier</key>
                <string>com.apple.finder</string>
            </dict>
            <key>NSSendFileTypes</key>
            <array>
                <string>public.item</string>
            </array>
        </dict>
    </array>
</dict>
</plist>`;

      // Create document.wflow that opens browser instead of terminal
      const documentWflow = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>AMApplicationBuild</key>
    <string>523</string>
    <key>AMApplicationVersion</key>
    <string>2.10</string>
    <key>AMDocumentVersion</key>
    <string>2</string>
    <key>actions</key>
    <array>
        <dict>
            <key>action</key>
            <dict>
                <key>AMAccepts</key>
                <dict>
                    <key>Container</key>
                    <string>List</string>
                    <key>Optional</key>
                    <true/>
                    <key>Types</key>
                    <array>
                        <string>com.apple.cocoa.string</string>
                    </array>
                </dict>
                <key>AMActionVersion</key>
                <string>2.0.3</string>
                <key>AMApplication</key>
                <array>
                    <string>Automator</string>
                </array>
                <key>AMParameterProperties</key>
                <dict>
                    <key>COMMAND_STRING</key>
                    <dict/>
                    <key>CheckedForUserDefaultShell</key>
                    <dict/>
                    <key>inputMethod</key>
                    <dict/>
                    <key>shell</key>
                    <dict/>
                    <key>source</key>
                    <dict/>
                </dict>
                <key>AMProvides</key>
                <dict>
                    <key>Container</key>
                    <string>List</string>
                    <key>Types</key>
                    <array>
                        <string>com.apple.cocoa.string</string>
                    </array>
                </dict>
                <key>ActionBundlePath</key>
                <string>/System/Library/Automator/Run Shell Script.action</string>
                <key>ActionName</key>
                <string>Run Shell Script</string>
                <key>ActionParameters</key>
                <dict>
                    <key>COMMAND_STRING</key>
                    <string>for f in "$@"
do
    ${filezapPath} share-ui "$f" &
    exit 0
done
</string>
                    <key>CheckedForUserDefaultShell</key>
                    <true/>
                    <key>inputMethod</key>
                    <string>0</string>
                    <key>shell</key>
                    <string>/bin/bash</string>
                    <key>source</key>
                    <string></string>
                </dict>
                <key>BundleIdentifier</key>
                <string>com.apple.RunShellScript</string>
                <key>CFBundleVersion</key>
                <string>2.0.3</string>
                <key>CanShowSelectedItemsWhenRun</key>
                <false/>
                <key>CanShowWhenRun</key>
                <true/>
                <key>Category</key>
                <array>
                    <string>AMCategoryUtilities</string>
                </array>
                <key>Class Name</key>
                <string>RunShellScriptAction</string>
                <key>InputUUID</key>
                <string>72AE4080-2A1E-4A33-8AE9-4911427DFC2E</string>
                <key>Keywords</key>
                <array>
                    <string>Shell</string>
                    <string>Script</string>
                    <string>Command</string>
                    <string>Run</string>
                    <string>Unix</string>
                </array>
                <key>OutputUUID</key>
                <string>7F88CACD-F784-4551-9A42-51B732C2BDA9</string>
                <key>UUID</key>
                <string>3D637299-A1D0-4A81-A9BC-929C2DAEF400</string>
                <key>UnlocalizedApplications</key>
                <array>
                    <string>Automator</string>
                </array>
                <key>arguments</key>
                <dict>
                    <key>0</key>
                    <dict>
                        <key>default value</key>
                        <string>/bin/sh</string>
                        <key>name</key>
                        <string>shell</string>
                        <key>required</key>
                        <string>0</string>
                        <key>type</key>
                        <string>0</string>
                        <key>uuid</key>
                        <string>0</string>
                    </dict>
                    <key>1</key>
                    <dict>
                        <key>default value</key>
                        <string></string>
                        <key>name</key>
                        <string>COMMAND_STRING</string>
                        <key>required</key>
                        <string>0</string>
                        <key>type</key>
                        <string>0</string>
                        <key>uuid</key>
                        <string>1</string>
                    </dict>
                    <key>2</key>
                    <dict>
                        <key>default value</key>
                        <false/>
                        <key>name</key>
                        <string>CheckedForUserDefaultShell</string>
                        <key>required</key>
                        <string>0</string>
                        <key>type</key>
                        <string>0</string>
                        <key>uuid</key>
                        <string>2</string>
                    </dict>
                    <key>3</key>
                    <dict>
                        <key>default value</key>
                        <string>0</string>
                        <key>name</key>
                        <string>inputMethod</string>
                        <key>required</key>
                        <string>0</string>
                        <key>type</key>
                        <string>0</string>
                        <key>uuid</key>
                        <string>3</string>
                    </dict>
                    <key>4</key>
                    <dict>
                        <key>default value</key>
                        <string>0</string>
                        <key>name</key>
                        <string>source</string>
                        <key>required</key>
                        <string>0</string>
                        <key>type</key>
                        <string>0</string>
                        <key>uuid</key>
                        <string>4</string>
                    </dict>
                </dict>
                <key>isViewVisible</key>
                <true/>
                <key>location</key>
                <string>309.000000:368.000000</string>
                <key>nibPath</key>
                <string>/System/Library/Automator/Run Shell Script.action/Contents/Resources/Base.lproj/main.nib</string>
            </dict>
            <key>isViewVisible</key>
            <true/>
        </dict>
    </array>
    <key>connectors</key>
    <dict/>
    <key>workflowMetaData</key>
    <dict>
        <key>applicationBundleIDsByPath</key>
        <dict/>
        <key>applicationPaths</key>
        <array/>
        <key>inputTypeIdentifier</key>
        <string>com.apple.Automator.fileSystemObject</string>
        <key>outputTypeIdentifier</key>
        <string>com.apple.Automator.nothing</string>
        <key>presentationMode</key>
        <integer>15</integer>
        <key>processesInput</key>
        <integer>0</integer>
        <key>serviceInputTypeIdentifier</key>
        <string>com.apple.Automator.fileSystemObject</string>
        <key>serviceOutputTypeIdentifier</key>
        <string>com.apple.Automator.nothing</string>
        <key>serviceProcessesInput</key>
        <integer>0</integer>
        <key>systemImageName</key>
        <string>NSActionTemplate</string>
        <key>useAutomaticInputType</key>
        <integer>0</integer>
        <key>workflowTypeIdentifier</key>
        <string>com.apple.Automator.servicesMenu</string>
    </dict>
</dict>
</plist>`;

      fs.writeFileSync(infoDir, infoPlist);
      fs.writeFileSync(documentDir, documentWflow);
      
      // Refresh macOS services cache
      try {
        execSync('/System/Library/CoreServices/pbs -flush');
      } catch (e) {
        // Older macOS versions may not have the pbs command
        try {
          execSync('killall Finder');
        } catch (err) {
          // Ignore if it fails
        }
      }
      
      spinner.succeed('macOS Finder integration installed successfully!');
      console.log(chalk.cyan('\nYou can now right-click on any file and select "Services > Share via CPD"'));
      console.log(chalk.gray('You may need to restart Finder or log out and back in for changes to take effect'));
      
      return true;
    } catch (error) {
      spinner.fail(`Failed to install macOS Finder integration: ${error.message}`);
      console.log(chalk.red('\nYou may need to check permissions or try again with admin privileges'));
      return false;
    }
  },
  
  uninstall: async () => {
    const spinner = ora('Removing macOS Finder context menu integration...').start();
    
    try {
      const workflowPath = path.join(os.homedir(), 'Library', 'Services', 'Share via FileZap.workflow');
      
      if (fs.existsSync(workflowPath)) {
        fs.removeSync(workflowPath);
      }
      
      // Refresh macOS services cache
      try {
        execSync('/System/Library/CoreServices/pbs -flush');
      } catch (e) {
        // Older macOS versions may not have the pbs command
        try {
          execSync('killall Finder');
        } catch (err) {
          // Ignore if it fails
        }
      }
      
      spinner.succeed('macOS Finder integration removed successfully!');
      return true;
    } catch (error) {
      spinner.fail(`Failed to remove macOS Finder integration: ${error.message}`);
      return false;
    }
  }
};

// Update Linux integration to open a browser window
const linuxIntegration = {
  install: async () => {
    const spinner = ora('Adding Linux file manager context menu integration...').start();
    
    try {
      const filezapPath = getExecutablePath();
      const localShareDir = path.join(os.homedir(), '.local', 'share');
      
      // Create Nautilus scripts directory (GNOME)
      const nautilusDir = path.join(localShareDir, 'nautilus', 'scripts');
      fs.ensureDirSync(nautilusDir);
      
      const scriptPath = path.join(nautilusDir, 'Share via FileZap');
      const scriptContent = `#!/bin/bash
# Nautilus script to share files using FileZap

for f in "$@"; do
  # Open browser directly instead of terminal
  ${filezapPath} share-ui "$f" &
done
`;
      
      fs.writeFileSync(scriptPath, scriptContent);
      fs.chmodSync(scriptPath, 0o755); // Make executable
      
      // Create desktop service file (for KDE and other environments)
      const applicationsDir = path.join(localShareDir, 'applications');
      fs.ensureDirSync(applicationsDir);
      
      const desktopFilePath = path.join(applicationsDir, 'filezap-share.desktop');
      const desktopFileContent = `[Desktop Entry]
Version=1.0
Type=Service
Name=Share via FileZap
Exec=bash -c "${filezapPath} send %F --debug; echo 'Press Enter to close'; read"
Terminal=true
Icon=network-transmit
MimeType=all/all;
X-KDE-Priority=TopLevel
`;
      
      fs.writeFileSync(desktopFilePath, desktopFileContent);
      fs.chmodSync(desktopFilePath, 0o755); // Make executable
      
      // Update desktop database
      try {
        execSync('update-desktop-database ~/.local/share/applications');
      } catch (e) {
        // Command might not exist, ignore
      }
      
      spinner.succeed('Linux file manager integration installed successfully!');
      console.log(chalk.cyan('\nFor GNOME/Nautilus: Right-click > Scripts > Share via FileZap'));
      console.log(chalk.cyan('For other file managers: Look for "Share via FileZap" in the context menu'));
      console.log(chalk.gray('You may need to restart your file manager for changes to take effect'));
      
      return true;
    } catch (error) {
      spinner.fail(`Failed to install Linux file manager integration: ${error.message}`);
      return false;
    }
  },
  
  uninstall: async () => {
    const spinner = ora('Removing Linux file manager context menu integration...').start();
    
    try {
      // Remove Nautilus script
      const nautilusScriptPath = path.join(os.homedir(), '.local', 'share', 'nautilus', 'scripts', 'Share via FileZap');
      if (fs.existsSync(nautilusScriptPath)) {
        fs.unlinkSync(nautilusScriptPath);
      }
      
      // Remove desktop service file
      const desktopFilePath = path.join(os.homedir(), '.local', 'share', 'applications', 'filezap-share.desktop');
      if (fs.existsSync(desktopFilePath)) {
        fs.unlinkSync(desktopFilePath);
      }
      
      // Update desktop database
      try {
        execSync('update-desktop-database ~/.local/share/applications');
      } catch (e) {
        // Command might not exist, ignore
      }
      
      spinner.succeed('Linux file manager integration removed successfully!');
      return true;
    } catch (error) {
      spinner.fail(`Failed to remove Linux file manager integration: ${error.message}`);
      return false;
    }
  }
};

// Main function to install shell integration based on platform
export async function installShellIntegration() {
  const platform = os.platform();
  
  if (platform === 'win32') {
    return windowsIntegration.install();
  } else if (platform === 'darwin') {
    return macosIntegration.install();
  } else if (platform === 'linux') {
    return linuxIntegration.install();
  } else {
    console.log(chalk.yellow(`Shell integration is not supported on ${platform}`));
    return false;
  }
}

// Main function to uninstall shell integration based on platform
export async function uninstallShellIntegration() {
  const platform = os.platform();
  
  if (platform === 'win32') {
    return windowsIntegration.uninstall();
  } else if (platform === 'darwin') {
    return macosIntegration.uninstall();
  } else if (platform === 'linux') {
    return linuxIntegration.uninstall();
  } else {
    console.log(chalk.yellow(`Shell integration is not supported on ${platform}`));
    return false;
  }
}
