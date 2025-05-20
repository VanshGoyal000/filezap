import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import child_process from 'child_process';
import { execSync } from 'child_process';
import ora from 'ora';
import chalk from 'chalk';

// Improved path to the installed FileZap binary
const getExecutablePath = () => {
  // On Windows, use the installed location or the current file location
  if (os.platform() === 'win32') {
    try {
      // First check if we need to ensure Node.js runs the command
      const isJsFile = true; // Assume it's a JS file by default
      
      // First check global npm installs
      const npmGlobal = execSync('npm root -g').toString().trim();
      const possiblePath = path.join(npmGlobal, '..', 'filezap.cmd');
      if (fs.existsSync(possiblePath)) {
        return { path: possiblePath, isJsFile: false }; // .cmd file is executable directly
      }
      
      // Also check for cpd.cmd
      const cpdPath = path.join(npmGlobal, '..', 'cpd.cmd');
      if (fs.existsSync(cpdPath)) {
        return { path: cpdPath, isJsFile: false }; // .cmd file is executable directly
      }
      
      // Check for node_modules filezap.js
      const jsPath = path.join(npmGlobal, 'filezap', 'bin', 'filezap.js');
      if (fs.existsSync(jsPath)) {
        return { path: jsPath, isJsFile: true }; // .js file needs node
      }
    } catch (e) {
      // Ignore error if npm not found
    }
    
    // Fallback to current directory executable
    const currentDir = path.resolve(process.cwd());
    return { path: path.join(currentDir, 'bin', 'filezap.js'), isJsFile: true };
  }
  
  // On macOS, be more specific about where to find the executable
  if (os.platform() === 'darwin') {
    try {
      // Check for global npm installs
      const npmGlobal = execSync('npm root -g').toString().trim();
      const possiblePath = path.join(npmGlobal, '..', 'bin', 'filezap');
      if (fs.existsSync(possiblePath)) {
        return possiblePath;
      }
    } catch (e) {
      // Ignore error if npm not found
    }
    
    // Try checking in standard paths
    const standardPaths = [
      '/usr/local/bin/filezap',
      '/usr/bin/filezap',
      path.join(os.homedir(), '.npm-global', 'bin', 'filezap')
    ];
    
    for (const stdPath of standardPaths) {
      if (fs.existsSync(stdPath)) {
        return stdPath;
      }
    }
    
    // Last resort: use which command
    try {
      const whichPath = execSync('which filezap').toString().trim();
      if (whichPath) {
        return whichPath;
      }
    } catch (e) {
      // Command not found
    }
  }
  
  // On Linux or as a fallback, we expect it to be in the PATH
  return 'filezap';
};

// Windows implementation using registry
const windowsIntegration = {
  install: async () => {
    const spinner = ora('Adding Windows Explorer context menu integration...').start();
    
    try {
      // Get the path and whether it's a JS file
      const { path: filezapPath, isJsFile } = getExecutablePath();
      
      spinner.text = `Using FileZap at: ${filezapPath}`;
      
      // Find Node.js executable path if needed
      let nodePath = '';
      if (isJsFile) {
        try {
          nodePath = execSync('where node').toString().split('\n')[0].trim();
          spinner.text = `Using Node.js at: ${nodePath}`;
        } catch (e) {
          spinner.warn('Could not find Node.js. Will try to use the system default.');
          nodePath = 'node'; // Hope it's in PATH
        }
      }
      
      // Create a batch script to handle the execution properly
      const batchDir = path.join(os.tmpdir(), 'filezap-launcher');
      fs.ensureDirSync(batchDir);
      
      const batchPath = path.join(batchDir, 'filezap-launcher.bat');
      
      // The batch file will handle proper execution with error handling
      const batchContent = isJsFile ? 
        `@echo off
rem FileZap Launcher Script
if not exist "${filezapPath.replace(/\\/g, '\\\\')}" (
  echo FileZap executable not found: ${filezapPath.replace(/\\/g, '\\\\')}
  echo Please reinstall FileZap or run 'npm install -g filezap'
  pause
  exit /b 1
)

"${nodePath}" "${filezapPath.replace(/\\/g, '\\\\')}" share-ui %1
if errorlevel 1 (
  echo Error launching FileZap. Please check your installation.
  pause
)
` :
        `@echo off
rem FileZap Launcher Script
if not exist "${filezapPath.replace(/\\/g, '\\\\')}" (
  echo FileZap executable not found: ${filezapPath.replace(/\\/g, '\\\\')}
  echo Please reinstall FileZap or run 'npm install -g filezap'
  pause
  exit /b 1
)

"${filezapPath.replace(/\\/g, '\\\\')}" share-ui %1
if errorlevel 1 (
  echo Error launching FileZap. Please check your installation.
  pause
)
`;

      fs.writeFileSync(batchPath, batchContent);
      
      // Set the batch file to be executable
      fs.chmodSync(batchPath, 0o755);
      
      // Use a simpler, more reliable registry entry that uses the batch file
      const registryContent = `Windows Registry Editor Version 5.00

; FileZap Share menu for files
[HKEY_CURRENT_USER\\Software\\Classes\\*\\shell\\FileZapShare]
@="Share via FileZap"
"Icon"="%SystemRoot%\\System32\\shell32.dll,133"

[HKEY_CURRENT_USER\\Software\\Classes\\*\\shell\\FileZapShare\\command]
@="\\"${batchPath.replace(/\\/g, '\\\\')}\\\" \\"%1\\""

; FileZap Share menu for folders
[HKEY_CURRENT_USER\\Software\\Classes\\Directory\\shell\\FileZapShare]
@="Share via FileZap"
"Icon"="%SystemRoot%\\System32\\shell32.dll,133"

[HKEY_CURRENT_USER\\Software\\Classes\\Directory\\shell\\FileZapShare\\command]
@="\\"${batchPath.replace(/\\/g, '\\\\')}\\\" \\"%1\\""
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

// Completely rewritten macOS implementation using Automator Service
const macosIntegration = {
  install: async () => {
    const spinner = ora('Adding macOS Finder context menu integration...').start();
    
    try {
      // Get the path to the executable with better error handling
      let filezapPath = getExecutablePath();
      spinner.text = `Using FileZap at: ${filezapPath}`;
      
      // Check if the path exists and is executable
      try {
        const stats = fs.statSync(filezapPath);
        if (!stats.isFile()) {
          spinner.warn(`FileZap not found at ${filezapPath}, using PATH reference`);
          filezapPath = 'filezap'; // Fallback to PATH
        }
      } catch (e) {
        spinner.warn(`FileZap not found at ${filezapPath}, using PATH reference`);
        filezapPath = 'filezap'; // Fallback to PATH
      }
      
      const servicesDir = path.join(os.homedir(), 'Library', 'Services');
      fs.ensureDirSync(servicesDir);
      
      // Create the workflow directory
      const workflowName = 'Share via FileZap.workflow';
      const workflowDir = path.join(servicesDir, workflowName);
      
      // Remove any existing damaged workflow
      if (fs.existsSync(workflowDir)) {
        spinner.text = 'Removing existing workflow...';
        fs.removeSync(workflowDir);
      }
      
      const contentsDir = path.join(workflowDir, 'Contents');
      fs.ensureDirSync(workflowDir);
      fs.ensureDirSync(contentsDir);
      
      // Paths to required files
      const infoPath = path.join(contentsDir, 'Info.plist');
      const documentPath = path.join(contentsDir, 'document.wflow');
      
      // Create Info.plist with more precise configuration
      spinner.text = 'Creating Info.plist...';
      const infoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>AMApplicationBuild</key>
    <string>521.1</string>
    <key>AMApplicationVersion</key>
    <string>2.10</string>
    <key>AMDocumentVersion</key>
    <string>2</string>
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

      // Create a simpler and more robust document.wflow file
      spinner.text = 'Creating workflow...';
      const documentWflow = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>AMApplicationBuild</key>
    <string>521.1</string>
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
                        <string>com.apple.cocoa.path</string>
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
                    <string>#!/bin/bash
# Simple error handler
function handle_error() {
    osascript -e 'display dialog "Error sharing file with FileZap: $1" buttons {"OK"} default button "OK" with icon caution'
    exit 1
}

# Ensure we have at least one file
if [ $# -eq 0 ]; then
    handle_error "No files selected"
fi

# Process the first file (Automator passes all files as arguments)
FILE="$1"

# Check if file exists
if [ ! -e "$FILE" ]; then
    handle_error "File not found: $FILE"
fi

# Try to find FileZap executable
FILEZAP="${filezapPath}"

# Check if executable exists
if ! command -v "$FILEZAP" &> /dev/null; then
    # Try to locate using which
    FILEZAP=$(which filezap 2>/dev/null || echo "")
    
    if [ -z "$FILEZAP" ]; then
        handle_error "FileZap executable not found"
    fi
fi

# Launch FileZap in the background
"$FILEZAP" share-ui "$FILE" &

# Exit successfully
exit 0
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
            </dict>
            <key>isViewVisible</key>
            <integer>1</integer>
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

      // Write the files
      fs.writeFileSync(infoPath, infoPlist);
      fs.writeFileSync(documentPath, documentWflow);
      
      // Set proper permissions
      spinner.text = 'Setting proper permissions...';
      try {
        fs.chmodSync(workflowDir, 0o755);
        fs.chmodSync(contentsDir, 0o755);
        fs.chmodSync(infoPath, 0o644);
        fs.chmodSync(documentPath, 0o644);
      } catch (permError) {
        spinner.warn('Could not set permissions properly. Integration may not work correctly.');
        console.log(chalk.yellow(`Permission error: ${permError.message}`));
      }
      
      // Refresh macOS services cache
      spinner.text = 'Refreshing macOS services...';
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
      console.log(chalk.cyan('\nYou can now right-click on any file and select:'));
      console.log(chalk.cyan('    Services → Share via FileZap'));
      console.log(chalk.gray('\nYou may need to log out and log back in, or restart your Mac for changes to take effect.'));
      console.log(chalk.gray('If service does not appear, try running:'));
      console.log(chalk.gray('    killall -KILL Finder && /System/Library/CoreServices/pbs -flush\n'));
      
      return true;
    } catch (error) {
      spinner.fail(`Failed to install macOS Finder integration: ${error.message}`);
      console.log(chalk.red('\nYou may need to check permissions or try again with admin privileges'));
      console.log(chalk.yellow('\nTroubleshooting steps:'));
      console.log('1. Make sure FileZap is properly installed: npm list -g filezap');
      console.log('2. Try installing manually:');
      console.log('   - Open Automator.app');
      console.log('   - Create a new Quick Action');
      console.log('   - Set "Workflow receives" to "files or folders" in "Finder"');
      console.log('   - Add a "Run Shell Script" action');
      console.log(`   - Add command: filezap share-ui "$1" &`);
      console.log('   - Save as "Share via FileZap"');
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
