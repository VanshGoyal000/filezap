import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { exec } from 'child_process';
import { promisify } from 'util';
import { logDebug } from './logger.js';

const execAsync = promisify(exec);
const SSH_DIR = path.join(os.homedir(), '.ssh');

/**
 * Configure SSH to accept keys non-interactively for certain hosts
 * @param {string} host - The hostname to configure
 * @returns {Promise<boolean>} - Success status
 */
export async function configureNonInteractiveSsh(host) {
  try {
    const configFile = path.join(SSH_DIR, 'config');
    fs.ensureDirSync(SSH_DIR);
    
    // Check if config already exists for this host
    let configContent = '';
    if (fs.existsSync(configFile)) {
      configContent = fs.readFileSync(configFile, 'utf8');
    }
    
    if (!configContent.includes(`Host ${host}`)) {
      const hostConfig = `
# Added by FileZap for non-interactive tunnels
Host ${host}
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
  BatchMode yes
`;
      fs.appendFileSync(configFile, hostConfig);
      logDebug(`Added ${host} configuration to SSH config`);
    }
    
    return true;
  } catch (error) {
    logDebug(`Failed to configure SSH for ${host}: ${error.message}`);
    return false;
  }
}

/**
 * Create an SSH tunnel with proper non-interactive settings
 * @param {number} localPort - The local port to tunnel
 * @param {string} host - The SSH host
 * @param {string} user - The SSH user
 * @param {number} remotePort - The remote port to use (default: 80)
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise<{url: string, process: object}>} - The tunnel URL and process
 */
export function createSshTunnel(localPort, host, user, remotePort = 80, timeoutMs = 15000) {
  return new Promise(async (resolve, reject) => {
    try {
      // Configure SSH to be non-interactive for this host
      await configureNonInteractiveSsh(host);
      
      // Command for creating reverse tunnel
      const sshArgs = [
        '-o', 'StrictHostKeyChecking=no', 
        '-o', 'UserKnownHostsFile=/dev/null',
        '-o', 'BatchMode=yes',
        '-R', `${remotePort}:localhost:${localPort}`, 
        `${user}@${host}`
      ];
      
      // Set timeout to kill the process if it takes too long
      const tunnelTimeout = setTimeout(() => {
        sshProcess.kill();
        reject(new Error(`SSH tunnel creation timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      
      // Spawn SSH process
      const sshProcess = spawn('ssh', sshArgs, {
        stdio: ['ignore', 'pipe', 'pipe']
      });
      
      let output = '';
      let errorOutput = '';
      
      sshProcess.stdout.on('data', (data) => {
        const chunk = data.toString();
        output += chunk;
        logDebug(`SSH stdout: ${chunk}`);
      });
      
      sshProcess.stderr.on('data', (data) => {
        const chunk = data.toString();
        errorOutput += chunk;
        logDebug(`SSH stderr: ${chunk}`);
      });
      
      // Monitor for URLs in both stdout and stderr
      const checkForUrl = (text, regexPattern) => {
        const match = text.match(regexPattern);
        if (match && match[0]) {
          clearTimeout(tunnelTimeout);
          resolve({ 
            url: match[0],
            process: sshProcess
          });
          return true;
        }
        return false;
      };
      
      // Function to check both streams periodically
      const urlCheckInterval = setInterval(() => {
        // Different hosts might output URLs in different formats
        if (host === 'localhost.run') {
          if (checkForUrl(output, /https?:\/\/[a-zA-Z0-9\-]+\.localhost\.run/i)) {
            clearInterval(urlCheckInterval);
          }
        } else if (host === 'serveo.net') {
          if (checkForUrl(output, /https?:\/\/[a-zA-Z0-9\-]+\.serveo\.net/i) ||
              checkForUrl(errorOutput, /https?:\/\/[a-zA-Z0-9\-]+\.serveo\.net/i)) {
            clearInterval(urlCheckInterval);
          }
        }
      }, 500);
      
      // Handle process exit
      sshProcess.on('exit', (code) => {
        clearTimeout(tunnelTimeout);
        clearInterval(urlCheckInterval);
        
        if (code !== 0) {
          reject(new Error(`SSH process exited with code ${code}: ${errorOutput}`));
        } else if (!output.includes(host)) {
          // If the process exited normally but we never got a URL
          reject(new Error(`SSH process completed but no tunnel URL found: ${output}`));
        }
      });
      
      sshProcess.on('error', (err) => {
        clearTimeout(tunnelTimeout);
        clearInterval(urlCheckInterval);
        reject(new Error(`SSH process error: ${err.message}`));
      });
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Check if SSH is available on the system
 * @returns {Promise<boolean>} - True if SSH is available
 */
export async function isSshAvailable() {
  try {
    await execAsync('ssh -V');
    return true;
  } catch (error) {
    logDebug(`SSH not available: ${error.message}`);
    return false;
  }
}

/**
 * Kill any SSH processes matching a specific pattern
 * @param {string} pattern - Pattern to match in process listing
 * @returns {Promise<boolean>} - Success status
 */
export async function killSshProcesses(pattern) {
  try {
    if (os.platform() === 'win32') {
      await execAsync(`taskkill /F /FI "WINDOWTITLE eq *${pattern}*" /IM ssh.exe`, { timeout: 5000 });
    } else {
      await execAsync(`pkill -f "ssh.*${pattern}"`, { timeout: 5000 });
    }
    return true;
  } catch (error) {
    // Error might just mean no processes found
    return true;
  }
}
