import ngrok from 'ngrok';
import os from 'os';
import fs from 'fs-extra';
import path from 'path';
import ora from 'ora';
import chalk from 'chalk';
import { exec } from 'child_process';
import { promisify } from 'util';
import axios from 'axios';

const execPromise = promisify(exec);

const NGROK_BIN_PATH = ngrok.getPath ? ngrok.getPath() : null;
const NGROK_CONFIG_PATH = path.join(os.homedir(), '.ngrok2', 'ngrok.yml');
const REPORT_PATH = path.join(os.homedir(), '.filezap', 'logs', 'ngrok_diagnostics.json');

/**
 * Run diagnostics on ngrok
 * @returns {Promise<Object>} Diagnostic results
 */
export async function diagnoseNgrok() {
  const spinner = ora('Running ngrok diagnostics...').start();
  const results = {
    timestamp: new Date().toISOString(),
    os: {
      platform: os.platform(),
      release: os.release(),
      type: os.type()
    },
    ngrok: {
      installed: false,
      version: null,
      binary: null,
      config: null,
      authtoken: false,
      connection: false,
      errors: []
    },
    network: {
      internet: false,
      canReachNgrokApi: false,
      ports: {}
    }
  };

  try {
    // 1. Check if ngrok binary exists
    if (NGROK_BIN_PATH && fs.existsSync(NGROK_BIN_PATH)) {
      results.ngrok.installed = true;
      results.ngrok.binary = NGROK_BIN_PATH;
    } else {
      results.ngrok.errors.push('Ngrok binary not found');
    }

    // 2. Check ngrok config
    try {
      if (fs.existsSync(NGROK_CONFIG_PATH)) {
        const configContent = fs.readFileSync(NGROK_CONFIG_PATH, 'utf8');
        results.ngrok.config = NGROK_CONFIG_PATH;
        // Check if auth token exists in config (don't extract it for security)
        if (configContent.includes('authtoken:')) {
          results.ngrok.authtoken = true;
        }
      }
    } catch (configError) {
      results.ngrok.errors.push(`Config error: ${configError.message}`);
    }

    // 3. Check internet connectivity
    try {
      await axios.get('https://api.ngrok.com', { timeout: 5000 });
      results.network.internet = true;
      results.network.canReachNgrokApi = true;
    } catch (netError) {
      if (netError.response) {
        // Got a response, so internet works but might not have API access
        results.network.internet = true;
      }
      results.ngrok.errors.push(`API connectivity error: ${netError.message}`);
    }

    // 4. Try to get ngrok version
    if (results.ngrok.installed) {
      try {
        const { stdout } = await execPromise(`"${NGROK_BIN_PATH}" --version`);
        results.ngrok.version = stdout.trim();
      } catch (versionError) {
        results.ngrok.errors.push(`Version check error: ${versionError.message}`);
      }
    }

    // 5. Test ngrok connection briefly
    try {
      spinner.text = 'Testing ngrok connection...';
      const url = await ngrok.connect({ addr: 9999, onStatusChange: status => {
        if (status === 'connected') {
          results.ngrok.connection = true;
        }
      }});
      
      if (url) {
        results.ngrok.connection = true;
        // Disconnect immediately after test
        await ngrok.disconnect(url);
      }
    } catch (connError) {
      results.ngrok.errors.push(`Connection test error: ${connError.message}`);
    }

    // Save diagnostic results
    fs.ensureDirSync(path.dirname(REPORT_PATH));
    fs.writeJSONSync(REPORT_PATH, results, { spaces: 2 });
    
    spinner.succeed('Ngrok diagnostics completed');
    return results;
  } catch (error) {
    spinner.fail(`Diagnostics failed: ${error.message}`);
    results.ngrok.errors.push(`General error: ${error.message}`);
    return results;
  }
}

/**
 * Fix common ngrok issues
 * @returns {Promise<Object>} Results of the fix attempts
 */
export async function fixNgrokIssues() {
  const spinner = ora('Attempting to fix ngrok issues...').start();
  const results = {
    actions: [],
    fixed: false,
    errors: []
  };

  try {
    // 1. Check for existing processes and kill them
    spinner.text = 'Checking for orphaned ngrok processes...';
    
    try {
      if (os.platform() === 'win32') {
        await execPromise('taskkill /f /im ngrok.exe', { timeout: 5000 });
        results.actions.push('Terminated existing ngrok processes');
      } else {
        await execPromise('pkill -f ngrok', { timeout: 5000 });
        results.actions.push('Terminated existing ngrok processes');
      }
    } catch (killError) {
      // Ignore errors here, likely means no processes were found
    }
    
    // 2. Try to reinstall ngrok if possible
    spinner.text = 'Reinitializing ngrok...';
    try {
      await ngrok.kill();
      results.actions.push('Killed any running ngrok processes');
    } catch (killError) {
      results.errors.push(`Kill error: ${killError.message}`);
    }

    // 3. Test if we can connect now
    spinner.text = 'Testing connection after fixes...';
    try {
      const url = await ngrok.connect({ addr: 9999 });
      if (url) {
        await ngrok.disconnect(url);
        results.fixed = true;
        results.actions.push('Successfully established test connection');
      }
    } catch (testError) {
      results.errors.push(`Test connection failed: ${testError.message}`);
    }

    spinner.succeed(results.fixed ? 'Successfully fixed ngrok issues' : 'Attempted fixes but issues may remain');
    return results;
  } catch (error) {
    spinner.fail(`Fix attempt failed: ${error.message}`);
    results.errors.push(`General error: ${error.message}`);
    return results;
  }
}

/**
 * Display a human-readable report of ngrok status
 * @param {Object} diagnosticResults - Results from diagnoseNgrok
 */
export function displayNgrokReport(diagnosticResults) {
  console.log(chalk.cyan('\n====== NGROK DIAGNOSTIC REPORT ======'));
  
  // System info
  console.log(chalk.yellow('\n▶ System Information:'));
  console.log(`OS: ${diagnosticResults.os.type} (${diagnosticResults.os.platform} ${diagnosticResults.os.release})`);
  
  // Ngrok status
  console.log(chalk.yellow('\n▶ Ngrok Status:'));
  console.log(`Installation: ${diagnosticResults.ngrok.installed ? chalk.green('✓ Installed') : chalk.red('✗ Not found')}`);
  if (diagnosticResults.ngrok.version) {
    console.log(`Version: ${diagnosticResults.ngrok.version}`);
  }
  console.log(`Auth Token: ${diagnosticResults.ngrok.authtoken ? chalk.green('✓ Found') : chalk.red('✗ Missing')}`);
  console.log(`Test Connection: ${diagnosticResults.ngrok.connection ? chalk.green('✓ Working') : chalk.red('✗ Failed')}`);
  
  // Network status
  console.log(chalk.yellow('\n▶ Network Status:'));
  console.log(`Internet Connectivity: ${diagnosticResults.network.internet ? chalk.green('✓ Connected') : chalk.red('✗ Not connected')}`);
  console.log(`Ngrok API Access: ${diagnosticResults.network.canReachNgrokApi ? chalk.green('✓ Accessible') : chalk.red('✗ Not accessible')}`);
  
  // Errors
  if (diagnosticResults.ngrok.errors.length > 0) {
    console.log(chalk.yellow('\n▶ Detected Issues:'));
    diagnosticResults.ngrok.errors.forEach((error, i) => {
      console.log(`${i+1}. ${chalk.red(error)}`);
    });
    
    // Recommendations
    console.log(chalk.yellow('\n▶ Recommendations:'));
    if (!diagnosticResults.ngrok.installed) {
      console.log('• Run npm reinstall ngrok to reinstall the binary');
    }
    if (!diagnosticResults.ngrok.authtoken) {
      console.log('• Set up an ngrok auth token with: npx ngrok authtoken YOUR_TOKEN');
      console.log('  (Get a token at https://dashboard.ngrok.com/get-started/your-authtoken)');
    }
    if (!diagnosticResults.network.internet) {
      console.log('• Check your internet connection');
    }
    if (diagnosticResults.ngrok.errors.some(e => e.includes('already in use'))) {
      console.log('• Kill existing ngrok processes with: npx ngrok kill');
    }
  } else if (diagnosticResults.ngrok.connection) {
    console.log(chalk.green('\n✓ Ngrok appears to be working correctly!'));
  }
  
  console.log(chalk.cyan('\n===================================='));
}
