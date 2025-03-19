import WebSocket from 'ws';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import ora from 'ora';

const CONFIG_DIR = path.join(os.homedir(), '.cpd');

export async function receiveFile(serverIp, serverPort, fileName) {
  const spinner = ora(`Connecting to file server at ${serverIp}:${serverPort}...`).start();
  
  try {
    // Create user directory if it doesn't exist
    const username = os.userInfo().username;
    const userDir = path.join(CONFIG_DIR, 'shared', username);
    fs.ensureDirSync(userDir);
    
    const filePath = path.join(userDir, fileName);
    
    // Connect to WebSocket server
    const ws = new WebSocket(`ws://${serverIp}:${serverPort}`);
    
    ws.on('open', () => {
      spinner.text = 'Connected to server. Waiting for file...';
    });
    
    ws.on('message', (data) => {
      // Check if this is a metadata message
      try {
        const message = JSON.parse(data.toString());
        if (message.type === 'metadata') {
          spinner.text = `Receiving: ${message.fileName} (${(message.fileSize / 1024).toFixed(2)} KB)`;
          return;
        }
      } catch (e) {
        // Not JSON, so it's file content
        fs.writeFileSync(filePath, data);
        spinner.succeed(`File received and saved to: ${filePath}`);
        
        // Acknowledge receipt
        ws.send(JSON.stringify({ type: 'received' }));
        setTimeout(() => {
          ws.close();
          process.exit(0);
        }, 1000);
      }
    });
    
    ws.on('error', (error) => {
      spinner.fail(`Connection error: ${error.message}`);
      process.exit(1);
    });
    
  } catch (error) {
    spinner.fail(`Failed to receive file: ${error.message}`);
    process.exit(1);
  }
}