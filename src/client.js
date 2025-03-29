import WebSocket from 'ws';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import ora from 'ora';
import chalk from 'chalk';

const CONFIG_DIR = path.join(os.homedir(), '.cpd');

export async function receiveFile(serverIp, serverPort, fileName) {
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
    
    // Connect to WebSocket server
    const ws = new WebSocket(`ws://${serverIp}:${serverPort}`);
    
    // Set a connection timeout
    const connectionTimeout = setTimeout(() => {
      spinner.fail('Connection timed out. Server may be unreachable.');
      ws.terminate();
      process.exit(1);
    }, 10000);
    
    ws.on('open', () => {
      clearTimeout(connectionTimeout);
      spinner.text = 'Connected to server. Waiting for file...';
      
      // After connection, send ready message
      ws.send(JSON.stringify({ type: 'ready', clientName: os.hostname() }));
    });
    
    // Track download progress
    let totalSize = 0;
    let receivedSize = 0;
    let fileStartTime = 0;
    
    ws.on('message', (data) => {
      // Check if this is a metadata message
      try {
        const message = JSON.parse(data.toString());
        
        if (message.type === 'metadata') {
          totalSize = message.fileSize;
          fileStartTime = Date.now();
          spinner.text = `Receiving: ${message.fileName} (${(message.fileSize / 1024).toFixed(2)} KB)`;
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
      process.exit(1);
    });
    
  } catch (error) {
    spinner.fail(`Failed to receive file: ${error.message}`);
    process.exit(1);
  }
}