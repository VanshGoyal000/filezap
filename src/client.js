import WebSocket from 'ws';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import ora from 'ora';
import chalk from 'chalk';
import axios from 'axios';
import readline from 'readline';

// Fix the inconsistent directory path (.cpd to .filezap)
const CONFIG_DIR = path.join(os.homedir(), '.filezap');

// Function to resolve shortened URLs
async function resolveUrl(url) {
  try {
    const response = await axios.get(url, {
      maxRedirects: 0,
      validateStatus: status => status >= 200 && status < 400
    });
    return url; // URL is not redirecting, it's the final URL
  } catch (error) {
    if (error.response && error.response.headers.location) {
      return error.response.headers.location;
    }
    return url; // If can't resolve, return original
  }
}

// Function to prompt for password if needed
async function promptForPassword() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  return new Promise((resolve) => {
    rl.question('Enter password to access file: ', (password) => {
      rl.close();
      resolve(password);
    });
  });
}

export async function receiveFile(serverIp, serverPort, fileName, password = null) {
  const spinner = ora(`Connecting to file server at ${serverIp}:${serverPort}...`).start();
  
  try {
    // Create user directory if it doesn't exist
    const username = os.userInfo().username;
    const userDir = path.join(CONFIG_DIR, 'shared', username);
    fs.ensureDirSync(userDir);
    
    const filePath = path.join(userDir, fileName);
    
    // If file already exists, create a unique name
    let finalFilePath = filePath;
    let counter = 1;
    while (fs.existsSync(finalFilePath)) {
      const ext = path.extname(filePath);
      const baseName = path.basename(filePath, ext);
      finalFilePath = path.join(userDir, `${baseName}_${counter}${ext}`);
      counter++;
    }
    
    // If URL is shortened, try to resolve it
    if (serverIp.startsWith('http://tinyurl.com/') || 
        serverIp.startsWith('https://tinyurl.com/') ||
        serverIp.includes('bit.ly')) {
      spinner.text = 'Resolving shortened URL...';
      serverIp = await resolveUrl(serverIp);
    }
    
    // Figure out if we're connecting to a local or ngrok URL
    let wsUrl;
    if (serverIp.startsWith('http://') || serverIp.startsWith('https://')) {
      // Convert HTTP URL to WebSocket URL
      const url = new URL(serverIp);
      wsUrl = `ws://${url.hostname}:${serverPort}`;
      spinner.text = `Connecting to remote server via tunnel...`;
    } else {
      // Standard connection
      wsUrl = `ws://${serverIp}:${serverPort}`;
    }
    
    // Connect to WebSocket server
    const ws = new WebSocket(wsUrl);
    
    // Set a connection timeout
    const connectionTimeout = setTimeout(() => {
      spinner.fail('Connection timed out. Server may be unreachable.');
      ws.terminate();
      process.exit(1);
    }, 10000);
    
    ws.on('open', () => {
      clearTimeout(connectionTimeout);
      spinner.text = 'Connected to server. Waiting for file...';
      
      // After connection, send ready message with password if provided
      ws.send(JSON.stringify({ 
        type: 'ready', 
        clientName: os.hostname(),
        password: password // Include password if provided
      }));
    });
    
    // Track download progress
    let totalSize = 0;
    let receivedSize = 0;
    let fileStartTime = 0;
    
    ws.on('message', async (data) => {
      // Check if this is a metadata message
      try {
        const message = JSON.parse(data.toString());
        
        if (message.type === 'metadata') {
          totalSize = message.fileSize;
          fileStartTime = Date.now();
          spinner.text = `Receiving: ${message.fileName} (${(message.fileSize / 1024).toFixed(2)} KB)`;
          return;
        }
        
        // Handle error messages (like password failures)
        if (message.type === 'error') {
          spinner.fail(`Error: ${message.message}`);
          
          // If it's a password error, prompt for password
          if (message.message === 'Invalid password') {
            console.log(chalk.yellow('\nThe file is password protected.'));
            
            // Prompt for password
            const enteredPassword = await promptForPassword();
            
            // Try reconnecting with the password
            console.log('Reconnecting with password...');
            ws.close();
            setTimeout(() => {
              receiveFile(serverIp, serverPort, fileName, enteredPassword);
            }, 1000);
          } else {
            process.exit(1);
          }
          return;
        }
        
        // Handle ping messages to keep connection alive
        if (message.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
          return;
        }
      } catch (e) {
        // Not JSON, so it's file content
        receivedSize = data.length;
        
        // Calculate transfer speed
        const elapsedSeconds = (Date.now() - fileStartTime) / 1000;
        const speedKBps = ((receivedSize / 1024) / elapsedSeconds).toFixed(2);
        
        // Calculate percentage and display progress
        const percent = Math.floor((receivedSize / totalSize) * 100);
        spinner.text = `Receiving: ${fileName} | ${percent}% complete | ${speedKBps} KB/s`;
        
        // Write file
        fs.writeFileSync(finalFilePath, data);
        spinner.succeed(`File received and saved to: ${finalFilePath}`);
        
        // Acknowledge receipt
        ws.send(JSON.stringify({ 
          type: 'received',
          clientName: os.hostname(),
          savePath: finalFilePath
        }));
        
        console.log('\n' + chalk.green('✓') + ' Transfer successful!');
        console.log(chalk.cyan('File saved to:') + ' ' + finalFilePath);
        
        // Open file option based on platform
        if (os.platform() === 'win32') {
          console.log('\nTo open the file: ' + chalk.yellow(`start "${finalFilePath}"`));
        } else if (os.platform() === 'darwin') {
          console.log('\nTo open the file: ' + chalk.yellow(`open "${finalFilePath}"`));
        } else {
          console.log('\nTo open the file: ' + chalk.yellow(`xdg-open "${finalFilePath}"`));
        }
        
        setTimeout(() => {
          ws.close();
          process.exit(0);
        }, 1000);
      }
    });
    
    ws.on('error', (error) => {
      clearTimeout(connectionTimeout);
      spinner.fail(`Connection error: ${error.message}`);
      console.log(chalk.yellow('\nTips:'));
      console.log('1. Make sure both devices are on the same network');
      console.log('2. Try another IP address if multiple were provided');
      console.log('3. Check if firewalls are blocking the connection');
      console.log('4. If using a shortened URL, it might have expired');
      console.log('5. Try using the full ngrok URL if available');
      process.exit(1);
    });
    
  } catch (error) {
    spinner.fail(`Failed to receive file: ${error.message}`);
    process.exit(1);
  }
}