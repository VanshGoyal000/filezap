# CPD - Cross-Platform File Sharing CLI

A simple yet powerful command-line tool for sharing files across devices on the same network.

## Features

- 🔑 Generate secure user keys for identification
- 📂 Copy files to specific users
- 📋 List files shared with you
- 🌐 Real-time file transfer over WebSockets
- 💻 Works on Windows, macOS, and Linux

## Installation

### Global Installation

```bash
npm install -g cpd
```

### From Source

```bash
git clone https://github.com/yourusername/cpd.git
cd cpd
npm install
npm install -g .
```

## Usage

### Generate a Key

```bash
cpd key
```

This generates a unique key for your user that others will need to share files with you.

### Copy a File to Another User

```bash
cpd copy /path/to/file.txt username:key
```

or just using the key if the system knows the username:

```bash
cpd copy /path/to/file.txt key
```

### List Files Shared with You

```bash
cpd list
```

### Send a File Over the Network

```bash
cpd send /path/to/file.txt
```

This starts a WebSocket server and displays a command for the recipient to use.

### Receive a File

```bash
cpd receive 192.168.1.5 49152 file.txt
```

Use the command provided by the sender to receive the file.

## System Information

Running `cpd` without any arguments will display system information.

## License

ISC