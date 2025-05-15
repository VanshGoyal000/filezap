import fs from 'fs-extra';
import ora from 'ora';
import path from 'path';
import os from 'os';

// Common constants (should match generateKey.js)
const CONFIG_DIR = path.join(os.homedir(), '.filezap');
const KEY_FILE = path.join(CONFIG_DIR, 'keys.json');

export function copyCmd(filepath, userKey) {
    const spinner = ora(`Copying ${filepath} to user with key ${userKey}`).start();
    
    try {
        // Check if file exists
        if (!fs.existsSync(filepath)) {
            spinner.fail(`File not found: ${filepath}`);
            return;
        }
        
        // Normalize filepath to handle different path formats
        filepath = path.normalize(filepath);
        
        // Extract username and key
        let username, key;
        
        if (userKey.includes(':')) {
            [username, key] = userKey.split(':');
        } else {
            key = userKey;
            // Try to find username for this key
            const keys = fs.readJSONSync(KEY_FILE, { throws: false }) || {};
            const entry = Object.entries(keys).find(([_, val]) => val === key);
            
            if (!entry) {
                spinner.fail('Invalid key - no matching user found');
                return;
            }
            username = entry[0];
        }
        
        if (!username || !key) {
            spinner.fail('Invalid key format');
            return;
        }
        
        // Load keys for validation
        const keys = fs.readJSONSync(KEY_FILE, { throws: false }) || {};
        
        // Validate the key
        if (keys[username] !== key) {
            spinner.fail('Invalid key for specified user');
            return;
        }
        
        // Create the destination directory
        const userDir = path.join(CONFIG_DIR, 'shared', username);
        fs.ensureDirSync(userDir);
        
        // Get the filename from the path
        const filename = path.basename(filepath);
        const destPath = path.join(userDir, filename);
        
        // Copy the file
        fs.copySync(filepath, destPath);
        
        spinner.succeed(`File copied successfully to ${username}'s shared folder`);
        console.log(`Location: ${destPath}`);
    } catch (error) {
        spinner.fail("Unable to copy the file");
        console.error("Error:", error.message);
    }
}