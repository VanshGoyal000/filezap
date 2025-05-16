import {program} from 'commander';
import { generateKey } from '../commander/utils/generateKey.js';
import { copyCmd } from '../commander/utils/copyCmd.js';
import { listSharedFiles } from '../commander/utils/listSharedFiles.js';
import { startFileServer } from '../src/server.js';
import { receiveFile } from '../src/client.js';
import { installShellIntegration, uninstallShellIntegration } from '../commander/utils/shellIntegration.js';
import { listActiveTunnels, closeAllTunnels } from '../utils/tunnelManager.js';
import { diagnoseNgrok, fixNgrokIssues, displayNgrokReport } from '../utils/ngrokDiagnostics.js';
import { tunnelManager } from '../utils/tunnelProviders.js';
import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import readline from 'readline';
import chalk from 'chalk';
import ora from 'ora';

program
  .version('1.0.0')
  .description('FileZap - Cross-platform command-line file sharing tool\n' +
               'Keyboard shortcuts:\n' + 
               '  Ctrl+S: Quick share (prompts for file)\n' + 
               '  Ctrl+C: Exit program');

program
  .command('key')
  .alias('-key')
  .description('Generate a new key')
  .action(() => {generateKey()});

program
  .command('copy <filepath> <userKey>')
  .description("Copy file to the user (key)")
  .action((filepath, userKey) => {
    copyCmd(filepath, userKey);
  });

program
  .command('list')
  .description("List all files shared with you")
  .action(() => {
    listSharedFiles();
  });

// New WebSocket commands
program
  .command('send <filepath>')
  .description("Start a file sharing server to send a file over network")
  .option('-p, --password <password>', 'Set a password for file protection')
  .option('-s, --secure', 'Enable password protection with auto-generated password')
  .option('-d, --debug', 'Enable debug mode with detailed logging')
  .option('-t, --tunnel', 'Force enable tunneling (even if it failed before)')
  .action((filepath, options) => {
    try {
      // Resolve and normalize the filepath
      let normalizedPath = filepath;
      
      // Remove outer quotes that might be present
      if ((normalizedPath.startsWith('"') && normalizedPath.endsWith('"')) ||
          (normalizedPath.startsWith("'") && normalizedPath.endsWith("'"))) {
        normalizedPath = normalizedPath.substring(1, normalizedPath.length - 1);
      }
      
      // Handle duplicated paths (Windows context menu issue)
      const match = normalizedPath.match(/^([A-Z]:\\.*?)\\?"[A-Z]:\\/i);
      if (match) {
        // The file path was duplicated, extract the part after the quotes
        const pathAfterQuotes = normalizedPath.match(/"([A-Z]:\\.*?)"/i);
        if (pathAfterQuotes && pathAfterQuotes[1]) {
          normalizedPath = pathAfterQuotes[1];
        }
      }
      
      // Resolve to absolute path if relative
      if (!path.isAbsolute(normalizedPath)) {
        normalizedPath = path.resolve(process.cwd(), normalizedPath);
      }
      
      console.log(`File to share: ${normalizedPath}`);
      
      // Check if file exists before proceeding
      if (!fs.existsSync(normalizedPath)) {
        console.error(chalk.red(`Error: File not found: ${normalizedPath}`));
        process.exit(1);
      }
      
      // Handle password options
      const passwordProtect = options.password || options.secure || false;
      const password = options.password || null;
      const debug = options.debug || false;
      const forceTunnel = options.tunnel || false;
      
      startFileServer(normalizedPath, { 
        passwordProtect, 
        password,
        debug,
        forceTunnel
      });
    } catch (error) {
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
  });

program
  .command('receive <serverIp> <serverPort> <fileName>')
  .description("Connect to a file sharing server and receive a file")
  .option('-p, --password <password>', 'Password for protected file')
  .option('-d, --debug', 'Enable debug mode with detailed logging')
  .action((serverIp, serverPort, fileName, options) => {
    receiveFile(serverIp, serverPort, fileName, options.password, options.debug);
  });

// Add new commands for shell integration
program
  .command('integrate')
  .description("Add CPD to your system's right-click menu")
  .action(() => {
    installShellIntegration();
  });

program
  .command('unintegrate')
  .description("Remove CPD from your system's right-click menu")
  .action(() => {
    uninstallShellIntegration();
  });

// Add new command for easier ngrok URL handling
program
  .command('get <url> <fileName>')
  .description("Receive a file from a global sharing URL")
  .option('-p, --password <password>', 'Password for protected file')
  .action((url, fileName, options) => {
    // Extract hostname from URL and use default WebSocket port
    try {
      const parsedUrl = new URL(url);
      receiveFile(url, 80, fileName, options.password);
    } catch (e) {
      console.error('Invalid URL format. Please provide a valid http:// or https:// URL');
      process.exit(1);
    }
  });

// Add tunnel management commands
program
  .command('tunnels')
  .description("List active tunnels and connection status")
  .action(async () => {
    const spinner = ora('Checking active tunnels...').start();
    
    try {
      const tunnelInfo = await listActiveTunnels();
      spinner.stop();
      
      console.log(chalk.cyan('\n📡 TUNNEL STATUS'));
      
      if (tunnelInfo.active) {
        console.log(chalk.green('✓ Ngrok service is active'));
        if (tunnelInfo.ngrokVersion) {
          console.log(chalk.gray(`  Version: ${tunnelInfo.ngrokVersion}`));
        }
      } else {
        console.log(chalk.yellow('⚠️ Could not connect to ngrok service'));
        if (tunnelInfo.error) {
          console.log(chalk.gray(`   Error: ${tunnelInfo.error}`));
        }
      }
      
      console.log(chalk.cyan('\nActive Tunnels:'));
      
      if (tunnelInfo.fromRegistry.length > 0) {
        console.log(chalk.yellow(`${tunnelInfo.fromRegistry.length} tunnels in local registry:`));
        tunnelInfo.fromRegistry.forEach((url, i) => {
          console.log(`  ${i+1}. ${url}`);
        });
      } else {
        console.log(chalk.gray('  No active tunnels in registry'));
      }
      
      console.log(chalk.cyan('\nTo close all tunnels: ') + chalk.yellow('cpd tunnels-close'));
    } catch (error) {
      spinner.fail(`Error checking tunnels: ${error.message}`);
    }
  });

program
  .command('tunnels-close')
  .description("Close all active tunnels")
  .action(async () => {
    const spinner = ora('Closing all active tunnels...').start();
    
    try {
      const result = await closeAllTunnels();
      
      if (result.closedFromNgrok > 0 || result.closedFromRegistry > 0) {
        spinner.succeed(`Closed ${result.closedFromNgrok + result.closedFromRegistry} tunnels successfully`);
      } else if (result.errors.length > 0) {
        spinner.warn('Attempted to close tunnels with some errors');
        result.errors.forEach(err => console.log(chalk.yellow(`  - ${err}`)));
      } else {
        spinner.info('No active tunnels found to close');
      }
    } catch (error) {
      spinner.fail(`Error closing tunnels: ${error.message}`);
    }
  });

// Add specific ngrok diagnostics command
program
  .command('ngrok-diagnose')
  .description("Diagnose ngrok issues and show a detailed report")
  .action(async () => {
    const spinner = ora('Running ngrok diagnostics...').start();
    try {
      const results = await diagnoseNgrok();
      spinner.stop();
      displayNgrokReport(results);
    } catch (error) {
      spinner.fail(`Diagnostics failed: ${error.message}`);
    }
  });

program
  .command('ngrok-fix')
  .description("Attempt to fix common ngrok issues")
  .action(async () => {
    try {
      await fixNgrokIssues();
    } catch (error) {
      console.error(chalk.red(`Error: ${error.message}`));
    }
  });

// Add new command for web UI sharing from context menu
program
  .command('share-ui <filepath>')
  .description("Start a file sharing server with web UI")
  .action(async (filepath) => {
    try {
      // Get available port for the status UI
      const getPort = (await import('get-port')).default;
      const port = await getPort();
      
      // Normalize filepath
      let normalizedPath = filepath;
      
      // Remove quotes if present
      if ((normalizedPath.startsWith('"') && normalizedPath.endsWith('"')) ||
          (normalizedPath.startsWith("'") && normalizedPath.endsWith("'"))) {
        normalizedPath = normalizedPath.substring(1, normalizedPath.length - 1);
      }
      
      // Handle duplicated paths (Windows context menu issue)
      const match = normalizedPath.match(/^([A-Z]:\\.*?)\\?"[A-Z]:\\/i);
      if (match) {
        const pathAfterQuotes = normalizedPath.match(/"([A-Z]:\\.*?)"/i);
        if (pathAfterQuotes && pathAfterQuotes[1]) {
          normalizedPath = pathAfterQuotes[1];
        }
      }
      
      // Resolve to absolute path if relative
      if (!path.isAbsolute(normalizedPath)) {
        normalizedPath = path.resolve(process.cwd(), normalizedPath);
      }
      
      // Check if file exists
      if (!fs.existsSync(normalizedPath)) {
        console.error(chalk.red(`Error: File not found: ${normalizedPath}`));
        process.exit(1);
      }
      
      // Check if path is a directory - prevent directory sharing
      const stats = fs.statSync(normalizedPath);
      if (stats.isDirectory()) {
        console.error(chalk.red(`Error: ${normalizedPath} is a directory. FileZap only supports sharing individual files.`));
        console.error(chalk.yellow(`Tip: You can compress the directory into a zip file first and then share it.`));
        process.exit(1);
      }
      
      // Start the server in UI mode - hide terminal output but show browser
      const serverOptions = { 
        webOnly: true,       // Hide terminal output
        openBrowser: true,   // But show browser
        httpPort: port
      };
      
      // Start sharing
      startFileServer(normalizedPath, serverOptions);
    } catch (error) {
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
  });

program.parse(process.argv);

// Handle command execution
if (!process.argv.slice(2).length) {
  const commandName = path.basename(process.argv[1]).replace(/\.js$/, '');
  
  // Show system info on empty command
  console.log(`${commandName} - File sharing tool`);
  console.log(`Running on: ${os.type()} (${os.platform()}) ${os.release()}`);
  console.log(`Hostname: ${os.hostname()}`);
  console.log(`Username: ${os.userInfo().username}`);
  console.log(`Network interfaces: ${Object.keys(os.networkInterfaces()).join(', ')}`);
  console.log(`\nType '${commandName} --help' for available commands`);
  console.log(chalk.cyan(`\nKeyboard shortcuts:`));
  console.log(chalk.yellow(`  Ctrl+S: Quick share (prompts for file)`));
  console.log(chalk.yellow(`  Ctrl+C: Exit program`));
}