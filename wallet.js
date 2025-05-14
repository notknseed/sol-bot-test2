// wallet.js
const { Keypair } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');
const bs58 = require('bs58');
const prompt = require('prompt-sync')({ sigint: true });
const crypto = require('crypto');

// Function to create a new wallet
function createWallet(walletPath = 'wallet.json', withPassword = true) {
  try {
    // Check if wallet already exists
    if (fs.existsSync(walletPath)) {
      console.log(`Wallet already exists at ${walletPath}`);
      const overwrite = prompt('Do you want to overwrite it? (y/n): ').toLowerCase();
      if (overwrite !== 'y') {
        console.log('Wallet creation cancelled.');
        return null;
      }
    }

    // Generate a new keypair
    const keypair = Keypair.generate();
    
    // Convert to storable format
    const walletData = {
      publicKey: keypair.publicKey.toString(),
      secretKey: bs58.encode(keypair.secretKey),
    };

    // Use a hardcoded default password instead of prompting
    const defaultPassword = "solana-meme-trader-password";
    const encryptedWallet = encryptWallet(walletData, defaultPassword);
    fs.writeFileSync(walletPath, JSON.stringify(encryptedWallet, null, 2));
    console.log(`\nWallet created successfully at ${walletPath}`);
    console.log(`Your public key: ${walletData.publicKey}`);
    
    return keypair;
  } catch (error) {
    console.error('Error creating wallet:', error.message);
    return null;
  }
}

// Function to import a wallet from private key
function importWallet(privateKeyString, walletPath = 'wallet.json', withPassword = true) {
  try {
    let secretKey;
    
    // Handle different private key formats
    if (privateKeyString.startsWith('[') && privateKeyString.endsWith(']')) {
      // Handle array format [1,2,3,...]
      try {
        secretKey = Uint8Array.from(JSON.parse(privateKeyString));
      } catch (e) {
        console.error('Invalid private key format. Expected array of numbers.');
        return null;
      }
    } else {
      // Handle base58 encoded string
      try {
        secretKey = bs58.decode(privateKeyString);
      } catch (e) {
        console.error('Invalid private key format. Could not decode as base58.');
        return null;
      }
    }
    
    // Validate key length
    if (secretKey.length !== 64) {
      console.error('Invalid private key. Expected 64 bytes.');
      return null;
    }
    
    // Create keypair
    const keypair = Keypair.fromSecretKey(secretKey);
    
    // Convert to storable format
    const walletData = {
      publicKey: keypair.publicKey.toString(),
      secretKey: bs58.encode(keypair.secretKey),
    };
    
    // Check if wallet already exists
    if (fs.existsSync(walletPath)) {
      console.log(`Wallet already exists at ${walletPath}`);
      const overwrite = prompt('Do you want to overwrite it? (y/n): ').toLowerCase();
      if (overwrite !== 'y') {
        console.log('Wallet import cancelled.');
        return null;
      }
    }

    // Use a hardcoded default password instead of prompting
    const defaultPassword = "solana-meme-trader-password";
    const encryptedWallet = encryptWallet(walletData, defaultPassword);
    fs.writeFileSync(walletPath, JSON.stringify(encryptedWallet, null, 2));
    console.log(`\nWallet imported successfully at ${walletPath}`);
    console.log(`Your public key: ${walletData.publicKey}`);
    
    return keypair;
  } catch (error) {
    console.error('Error importing wallet:', error.message);
    return null;
  }
}

// Function to load a wallet with password verification
function loadWallet(walletPath = 'wallet.json') {
  try {
    if (!fs.existsSync(walletPath)) {
      console.log(`Wallet not found at ${walletPath}`);
      const createNew = prompt('Do you want to create a new wallet? (y/n): ').toLowerCase();
      if (createNew === 'y') {
        return createWallet(walletPath);
      } else {
        console.log('Wallet loading cancelled.');
        return null;
      }
    }
    
    const walletData = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
    
    // Check if wallet is encrypted
    if (walletData.iv && walletData.encrypted) {
      // This is an encrypted wallet - use hardcoded password
      const defaultPassword = "solana-meme-trader-password";
      
      try {
        const decryptedWallet = decryptWallet(walletData, defaultPassword);
        const secretKey = bs58.decode(decryptedWallet.secretKey);
        return Keypair.fromSecretKey(secretKey);
      } catch (error) {
        console.error('Failed to decrypt wallet. Wallet file might be corrupted or using a different password format.');
        return null;
      }
    } else if (walletData.secretKey) {
      // This is an unencrypted wallet
      console.log('Loading unencrypted wallet.');
      const secretKey = bs58.decode(walletData.secretKey);
      return Keypair.fromSecretKey(secretKey);
    } else {
      console.error('Invalid wallet format.');
      return null;
    }
  } catch (error) {
    console.error('Error loading wallet:', error.message);
    return null;
  }
}

// Helper functions for encryption/decryption
function encryptWallet(walletData, password) {
  const algorithm = 'aes-256-cbc';
  const key = crypto.scryptSync(password, 'salt', 32);
  const iv = crypto.randomBytes(16);
  
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  let encrypted = cipher.update(JSON.stringify(walletData), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  return {
    iv: iv.toString('hex'),
    encrypted: encrypted
  };
}

function decryptWallet(encryptedData, password) {
  const algorithm = 'aes-256-cbc';
  const key = crypto.scryptSync(password, 'salt', 32);
  const iv = Buffer.from(encryptedData.iv, 'hex');
  
  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return JSON.parse(decrypted);
}

// Export functions
module.exports = {
  createWallet,
  importWallet,
  loadWallet
};
