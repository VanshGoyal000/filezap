import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import ora from 'ora';

// Fix the inconsistent directory path (.filezap to .filezap)
const CONFIG_DIR = path.join(os.homedir(), '.filezap');

export function listSharedFiles() {
  const spinner = ora('Looking for shared files...').start();
  
  try {
    const username = os.userInfo().username;
    const userDir = path.join(CONFIG_DIR, 'shared', username);
    
    // Create directory if it doesn't exist
    fs.ensureDirSync(userDir);
    
    // Read the files in the directory
    const files = fs.readdirSync(userDir);
    
    spinner.succeed('Found shared files:');
    
    if (files.length === 0) {
      console.log('No files have been shared with you yet.');
    } else {
      console.log(`Files shared with you (${files.length}):\n`);
      
      files.forEach((file, index) => {
        const filePath = path.join(userDir, file);
        const stats = fs.statSync(filePath);
        const fileSizeInKB = (stats.size / 1024).toFixed(2);
        
        console.log(`${index + 1}. ${file} (${fileSizeInKB} KB)`);
        console.log(`   Location: ${filePath}`);
      });
    }
  } catch (error) {
    spinner.fail('Failed to list shared files');
    console.error(error);
  }
}