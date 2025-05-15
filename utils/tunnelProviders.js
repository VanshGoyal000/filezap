import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { logDebug } from './logger.js';
import axios from 'axios';

const execAsync = promisify(exec);
const TUNNEL_DIR = path.join(os.homedir(), '.filezap', 'tunnels');
const TUNNEL_INFO_PATH = path.join(TUNNEL_DIR, 'active_tunnels.json');

/**
 * Initialize the tunnel manager
 */
export function initTunnelManager() {
  try {
    fs.ensureDirSync(TUNNEL_DIR);
    if (!fs.existsSync(TUNNEL_INFO_PATH)) {
      saveTunnelInfo([]);
    }
  } catch (error) {
    logDebug(`Error initializing tunnel manager: ${error.message}`);
  }
}

/**
 * Save tunnel information to disk
 * @param {Array} tunnels - List of active tunnel URLs
 */
function saveTunnelInfo(tunnels) {
  try {
    fs.writeJSONSync(TUNNEL_INFO_PATH, {
      tunnels,
      lastUpdated: new Date().toISOString()
    }, { spaces: 2 });
  } catch (error) {
    logDebug(`Error saving tunnel info: ${error.message}`);
  }
}

/**
 * Load tunnel information from disk
 * @returns {Array} List of active tunnel URLs
 */
function loadTunnelInfo() {
  try {
    if (fs.existsSync(TUNNEL_INFO_PATH)) {
      const data = fs.readJSONSync(TUNNEL_INFO_PATH);
      return data.tunnels || [];
    }
  } catch (error) {
    logDebug(`Error loading tunnel info: ${error.message}`);
  }
  return [];
}

/**
 * Class to manage SSH-based tunnels with Serveo
 */
class ServeoTunnelManager {
  constructor() {
    this.activeTunnels = new Map();
    this.sshProcesses = new Map();
  }

  /**
   * Create a tunnel using Serveo
   * @param {number} port - Port to tunnel
   * @returns {Promise<Object>} - Tunnel details
   */
  async createTunnel(port) {
    logDebug(`Creating Serveo tunnel for port ${port}`);
    
    try {
      // Create a unique subdomain for this tunnel
      const subdomain = `cpd-${Date.now().toString(36).substring(2, 8)}`;
      logDebug(`Using subdomain: ${subdomain}`);
      
      return await this.createServeoTunnel(port, subdomain);
    } catch (error) {
      logDebug(`Serveo tunnel failed: ${error.message}`);
      
      // If first attempt fails, try without a subdomain
      try {
        logDebug('Retrying without specific subdomain...');
        return await this.createServeoTunnel(port);
      } catch (retryError) {
        logDebug(`Serveo retry failed: ${retryError.message}`);
        return {
          success: false,
          error: retryError.message
        };
      }
    }
  }
  
  /**
   * Create a Serveo tunnel with specific options
   * @param {number} port - Port to tunnel
   * @param {string} subdomain - Optional subdomain
   * @returns {Promise<Object>} - Tunnel details
   */
  createServeoTunnel(port, subdomain = null) {
    return new Promise((resolve, reject) => {
      try {
        // Prepare SSH args
        const args = ['-oStrictHostKeyChecking=accept-new'];
        
        // Add forwarding options
        if (subdomain) {
          args.push(`-R${subdomain}:80:localhost:${port}`);
        } else {
          args.push(`-R80:localhost:${port}`);
        }
        
        // Add server address
        args.push('serveo.net');
        
        logDebug(`Running SSH with args: ${args.join(' ')}`);
        
        // Spawn SSH process
        const sshProcess = spawn('ssh', args, {
          stdio: ['ignore', 'pipe', 'pipe']
        });
        
        let stdoutData = '';
        let stderrData = '';
        let resolved = false;
        
        // Set timeout for tunnel creation
        const timeout = setTimeout(() => {
          if (!resolved) {
            logDebug('Serveo tunnel creation timed out');
            sshProcess.kill();
            reject(new Error('Serveo tunnel creation timed out after 20 seconds'));
          }
        }, 20000);
        
        // Listen for stdout to extract tunnel URL
        sshProcess.stdout.on('data', (data) => {
          const output = data.toString();
          stdoutData += output;
          logDebug(`SSH stdout: ${output}`);
          
          // Extract URL from serveo output - use more precise regex
          const urlMatch = output.match(/https?:\/\/[a-zA-Z0-9]+\.serveo\.net/);
          if (urlMatch && urlMatch[0] && !resolved) {
            const url = urlMatch[0];
            logDebug(`Found URL in stdout: ${url}`);
            
            clearTimeout(timeout);
            resolved = true;
            
            // Save process for later cleanup
            this.sshProcesses.set(url, sshProcess);
            
            // Register tunnel
            this.activeTunnels.set(url, {
              provider: 'serveo',
              port,
              created: new Date().toISOString()
            });
            
            // Save to registry
            const tunnels = loadTunnelInfo();
            if (!tunnels.includes(url)) {
              tunnels.push(url);
              saveTunnelInfo(tunnels);
            }
            
            // Create shortened URL
            this.shortenUrl(url).then(shortenedUrl => {
              resolve({
                url,
                shortenedUrl,
                provider: 'serveo',
                success: true
              });
            }).catch(() => {
              // If URL shortening fails, just use the original URL
              resolve({
                url,
                shortenedUrl: url,
                provider: 'serveo',
                success: true
              });
            });
          }
        });
        
        // Listen for stderr to extract URL (serveo sometimes outputs to stderr)
        sshProcess.stderr.on('data', (data) => {
          const output = data.toString();
          stderrData += output;
          logDebug(`SSH stderr: ${output}`);
          
          // Extract URL from stderr output with improved pattern
          const urlMatch = output.match(/https?:\/\/[a-zA-Z0-9]+\.serveo\.net/);
          if (urlMatch && urlMatch[0] && !resolved) {
            const url = urlMatch[0];
            logDebug(`Found URL in stderr: ${url}`);
            
            clearTimeout(timeout);
            resolved = true;
            
            // Save process for later cleanup
            this.sshProcesses.set(url, sshProcess);
            
            // Register tunnel
            this.activeTunnels.set(url, {
              provider: 'serveo',
              port,
              created: new Date().toISOString()
            });
            
            // Save to registry
            const tunnels = loadTunnelInfo();
            if (!tunnels.includes(url)) {
              tunnels.push(url);
              saveTunnelInfo(tunnels);
            }
            
            // Create shortened URL
            this.shortenUrl(url).then(shortenedUrl => {
              resolve({
                url,
                shortenedUrl,
                provider: 'serveo',
                success: true
              });
            }).catch(() => {
              // If URL shortening fails, just use the original URL
              resolve({
                url,
                shortenedUrl: url,
                provider: 'serveo',
                success: true
              });
            });
          }
        });
        
        // Handle process exit
        sshProcess.on('close', (code) => {
          if (!resolved) {
            clearTimeout(timeout);
            reject(new Error(`SSH process exited with code ${code}, stdout: ${stdoutData}, stderr: ${stderrData}`));
          }
        });
        
        // Handle process error
        sshProcess.on('error', (error) => {
          if (!resolved) {
            clearTimeout(timeout);
            reject(new Error(`SSH process error: ${error.message}`));
          }
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Shorten URL using TinyURL
   * @param {string} url - URL to shorten
   * @returns {Promise<string>} - Shortened URL
   */
  async shortenUrl(url) {
    try {
      const response = await axios.get(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`);
      return response.data;
    } catch (error) {
      logDebug(`URL shortening failed: ${error.message}`);
      return url;
    }
  }

  /**
   * Close a specific tunnel
   * @param {string} url - The tunnel URL to close
   * @returns {Promise<boolean>} - Success status
   */
  async closeTunnel(url) {
    logDebug(`Closing tunnel: ${url}`);
    
    try {
      // Kill the SSH process if we have it
      if (this.sshProcesses.has(url)) {
        const process = this.sshProcesses.get(url);
        process.kill();
        this.sshProcesses.delete(url);
        logDebug(`Killed SSH process for ${url}`);
      }
      
      // Remove from active tunnels
      this.activeTunnels.delete(url);
      
      // Remove from registry
      const tunnels = loadTunnelInfo();
      const updatedTunnels = tunnels.filter(t => t !== url);
      saveTunnelInfo(updatedTunnels);
      
      return true;
    } catch (error) {
      logDebug(`Error closing tunnel: ${error.message}`);
      return false;
    }
  }

  /**
   * Close all tunnels
   * @returns {Promise<Object>} - Results of the operation
   */
  async closeAllTunnels() {
    logDebug('Closing all tunnels');
    
    const results = {
      closed: 0,
      failed: 0,
      errors: []
    };
    
    // Close each active tunnel
    for (const [url] of this.activeTunnels.entries()) {
      try {
        const success = await this.closeTunnel(url);
        if (success) {
          results.closed++;
        } else {
          results.failed++;
        }
      } catch (error) {
        results.failed++;
        results.errors.push(`Error closing ${url}: ${error.message}`);
      }
    }
    
    // Kill any remaining SSH processes to serveo.net
    try {
      if (os.platform() === 'win32') {
        await execAsync('taskkill /F /IM ssh.exe /FI "WINDOWTITLE eq *serveo.net*"', { timeout: 5000 });
      } else {
        await execAsync('pkill -f "ssh.*serveo.net"', { timeout: 5000 });
      }
    } catch (error) {
      // Ignore errors - likely means no processes were found
    }
    
    // Clear registry
    saveTunnelInfo([]);
    
    return results;
  }
}

// Export a singleton instance
export const tunnelManager = new ServeoTunnelManager();

// Export utility functions for CLI tools
export async function listActiveTunnels() {
  return {
    active: true,
    fromRegistry: loadTunnelInfo()
  };
}

export async function closeAllTunnels() {
  const result = await tunnelManager.closeAllTunnels();
  return {
    closedFromRegistry: result.closed,
    errors: result.errors
  };
}
