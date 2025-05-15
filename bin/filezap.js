#!/usr/bin/env node

import fs from 'fs-extra';
import path from 'path';
import readline from 'readline';
import chalk from 'chalk';
import { exec } from 'child_process';
import { promisify } from 'util';
import { startFileServer } from '../src/server.js';

// Import commander for CLI commands
import '../commander/commands.js';

// Return true if running in an interactive terminal
function isInteractive() {
  return process.stdin.isTTY && process.stdout.isTTY;
}

// Handle keyboard shortcuts only in interactive mode
if (isInteractive()) {
  // Only show shortcuts tip in normal mode, not for share-ui command
  if (!process.argv.includes('share-ui')) {
    console.log(chalk.cyan('💡 Tip: Press Alt+S or Ctrl+S for quick file sharing'));
  }

  // Set up keyboard event handling
  readline.emitKeypressEvents(process.stdin);
  
  // Try to set raw mode - this is required for keyboard shortcuts
  try {
    if (process.stdin.setRawMode) {
      process.stdin.setRawMode(true);
      
      // Listen for keyboard shortcuts
      process.stdin.on('keypress', async (str, key) => {
        // Check for Alt+S or Ctrl+S (Alt key is represented as 'meta' in some terminals)
        if ((key && key.ctrl && key.name === 's') || 
            (key && key.meta && key.name === 's')) {
          console.log(chalk.green('\n🔍 Quick Share activated. Opening file selector...'));
          
          try {
            // Different file picker approach based on platform
            let filePath;
            const execAsync = promisify(exec);
            
            if (process.platform === 'win32') {
              // For Windows - use a more reliable PowerShell script
              const script = `
                Add-Type -AssemblyName System.Windows.Forms
                $openFileDialog = New-Object System.Windows.Forms.OpenFileDialog
                $openFileDialog.Title = "FileZap - Select a file to share"
                $openFileDialog.Filter = "All files (*.*)|*.*"
                if($openFileDialog.ShowDialog() -eq 'OK') {
                  $openFileDialog.FileName
                }
              `;
              
              const { stdout } = await execAsync(`powershell -Command "${script}"`);
              filePath = stdout.trim();
            } 
            else if (process.platform === 'darwin') {
              // For macOS
              const { stdout } = await execAsync('osascript -e \'tell application "System Events" to POSIX path of (choose file)\'');
              filePath = stdout.trim();
            }
            else {
              // For Linux - try zenity first
              try {
                const { stdout } = await execAsync('zenity --file-selection --title="FileZap - Select a file to share"');
                filePath = stdout.trim();
              } catch (e) {
                // Fallback to manual input if zenity not available
                console.log(chalk.yellow('File selector not available. Please enter a path manually:'));
                const rl = readline.createInterface({
                  input: process.stdin,
                  output: process.stdout
                });
                
                filePath = await new Promise((resolve) => {
                  rl.question('Enter file path: ', (answer) => {
                    rl.close();
                    resolve(answer);
                  });
                });
              }
            }
            
            if (filePath && fs.existsSync(filePath)) {
              console.log(`\nSharing file: ${filePath}`);
              
              // Start sharing with browser UI
              await startFileServer(filePath, { 
                webOnly: false,
                openBrowser: true
              });
            } else {
              console.log(chalk.yellow('No file selected or file not found. Cancelling quick share.'));
            }
          } catch (error) {
            console.error(chalk.red(`Error: ${error.message}`));
          }
        }
        
        // Ctrl+C to exit
        if (key && key.ctrl && key.name === 'c') {
          process.exit(0);
        }
      });
    } else {
      console.log(chalk.yellow('Keyboard shortcuts not available in this environment.'));
    }
  } catch (error) {
    console.log(chalk.yellow(`Keyboard shortcuts disabled: ${error.message}`));
  }
}
