#!/usr/bin/env node
// index.js - Updated with status command
const { program } = require('commander');
const { PublicKey } = require('@solana/web3.js');
const { buyToken } = require('./buyToken');
const { sellToken } = require('./sellToken');
const { createWallet, importWallet, loadWallet } = require('./wallet');
const { getConnection, testConnection, resetConnections } = require('./connectionManager');
const fs = require('fs');
const ora = require('ora');

// Function to load config - duplicated to avoid circular dependencies
function loadConfig(configPath = 'config.json') {
  try {
    const configData = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(configData);
  } catch (error) {
    console.error(`Error loading config from ${configPath}:`, error.message);
    process.exit(1);
  }
}

// Main program
async function main() {
  program
    .name('solana-meme-trader')
    .description('A Solana meme token trading bot')
    .version('1.0.0');

  // Initialize the shared connection at startup
  try {
    const config = loadConfig();
    // This will create the singleton connection that will be reused
    const connection = getConnection(true, 'config.json', 'confirmed');
    await testConnection(false); // Just test it silently
  } catch (error) {
    console.error('Failed to initialize connection:', error.message);
    // Continue anyway, individual commands will retry
  }

  // Wallet commands
  program
    .command('create-wallet')
    .description('Create a new wallet')
    .option('-p, --path <path>', 'Wallet file path', 'wallet.json')
    .action(async (options) => {
      await createWallet(options.path, true);
    });

  program
    .command('import-wallet')
    .description('Import a wallet from private key')
    .argument('<privateKey>', 'Private key to import (base58 encoded or array format)')
    .option('-p, --path <path>', 'Wallet file path', 'wallet.json')
    .action(async (privateKey, options) => {
      await importWallet(privateKey, options.path, true);
    });

  // Buy command - optimized
  program
    .command('buy')
    .description('Buy a token')
    .argument('[tokenAddress]', 'Token mint address')
    .option('-a, --amount <amount>', 'Amount of SOL to spend')
    .option('-f, --fee-type <feeType>', 'Fee type: low, medium, high, urgent, custom')
    .option('-v, --verbose', 'Verbose output for debugging')
    .option('-w, --wallet <path>', 'Path to wallet file', 'wallet.json')
    .action(async (tokenAddress, options) => {
      try {
        // Load wallet first for efficiency
        const keypair = loadWallet(options.wallet);
        if (!keypair) {
          console.error('Failed to load wallet. Please check your wallet file or create a new one.');
          return;
        }

        console.log(`Using wallet: ${keypair.publicKey.toString()}`);
        
        // If tokenAddress is not provided, prompt the user with a simple message
        if (!tokenAddress) {
          const promptSync = require('prompt-sync')({ sigint: true });
          tokenAddress = promptSync('Enter token address: ');
          
          if (!tokenAddress || tokenAddress.trim() === '') {
            console.error('Token address is required.');
            return;
          }
          tokenAddress = tokenAddress.trim();
        }
        
        // Execute buy directly
        const amountDisplay = options.amount ? `${options.amount} SOL` : 'default amount';
        console.log(`Buying token: ${tokenAddress}`);
        console.log(`Amount: ${amountDisplay}`);
        
        const result = await buyToken(keypair, tokenAddress, options);
        
        if (result.success) {
          console.log('\nBuy transaction succeeded!');
          if (result.amount) {
            console.log(`Tokens purchased: ${result.amount.toLocaleString()}`);
          }
          console.log(`SOL spent: ${result.amountSol}`);
          console.log(`Transaction ID: ${result.txid}`);
          console.log(`\nExplorer URL: https://solscan.io/tx/${result.txid}`);
        } else {
          console.error('\nBuy transaction failed!');
          console.error(`Error: ${result.error}`);
          if (result.txid) {
            console.log(`Transaction ID: ${result.txid}`);
            console.log(`Explorer URL: https://solscan.io/tx/${result.txid}`);
          }
        }
      } catch (error) {
        console.error('Error executing buy command:', error.message);
      }
    });

  // Sell command with simplified interactive approach
  program
    .command('sell')
    .description('Sell a token')
    .argument('[tokenAddress]', 'Token mint address')
    .option('-p, --percentage <percentage>', 'Percentage of tokens to sell (default: 100%)', '100')
    .option('-a, --all', 'Sell all tokens (same as 100%)')
    .option('-f, --fee-type <feeType>', 'Fee type: low, medium, high, urgent, custom')
    .option('-v, --verbose', 'Verbose output for debugging')
    .option('-w, --wallet <path>', 'Path to wallet file', 'wallet.json')
    .action(async (tokenAddress, options) => {
      try {
        // Load wallet first
        const keypair = loadWallet(options.wallet);
        if (!keypair) {
          console.error('Failed to load wallet. Please check your wallet file or create a new one.');
          return;
        }

        console.log(`Using wallet: ${keypair.publicKey.toString()}`);
        
        // If tokenAddress is not provided, show a simpler interactive menu
        if (!tokenAddress) {
          // Get the reusable connection from the connection manager
          const connection = getConnection();
          
          // Start spinner to indicate loading
          const spinner = ora('Fetching token holdings...').start();
          
          try {
            // Get token accounts for this public key with minimal data
            const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
              keypair.publicKey,
              { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }
            );
            
            spinner.stop();
            
            // Filter out accounts with zero balance
            const tokenHoldings = tokenAccounts.value
              .filter(account => {
                const info = account.account.data.parsed.info;
                return info.tokenAmount.uiAmount > 0;
              })
              .map((account, index) => {
                const info = account.account.data.parsed.info;
                return {
                  index: index + 1,
                  mint: info.mint,
                  balance: info.tokenAmount.uiAmount
                };
              });
            
            if (tokenHoldings.length === 0) {
              console.log('You don\'t have any tokens with balance > 0.');
              return;
            }
            
            // Display token holdings in a simplified format
            console.log('\nSelect a token to sell:');
            console.log('----------------------');
            
            tokenHoldings.forEach(token => {
              console.log(`${token.index}. ${token.mint} | ${token.balance.toLocaleString()}`);
            });
            
            // Prompt user to select a token with timeout
            const promptSync = require('prompt-sync')({ sigint: true });
            const selectedIndex = parseInt(promptSync('Enter number: '));
            
            if (isNaN(selectedIndex) || selectedIndex < 1 || selectedIndex > tokenHoldings.length) {
              console.error('Invalid selection.');
              return;
            }
            
            // Set the selected token address directly - no additional prompts
            tokenAddress = tokenHoldings[selectedIndex - 1].mint;
            console.log(`Selected: ${tokenAddress}`);
          } catch (error) {
            spinner.stop();
            console.error(`Error fetching token holdings: ${error.message}`);
            console.log('Please enter token address manually:');
            tokenAddress = promptSync();
            
            if (!tokenAddress || tokenAddress.trim() === '') {
              console.error('Token address is required.');
              return;
            }
            tokenAddress = tokenAddress.trim();
          }
        }
        
        // Execute sell without further prompts
        console.log(`Selling token: ${tokenAddress}`);
        console.log(`Percentage: ${options.percentage}%`);
        const result = await sellToken(keypair, tokenAddress, options);
        
        if (result.success) {
          console.log('\nSell transaction succeeded!');
          console.log(`Tokens sold: ${result.soldAmount?.toLocaleString() || 'N/A'}`);
          console.log(`SOL received: ${result.soldAmountSol?.toFixed(4) || 'N/A'}`);
          console.log(`Transaction ID: ${result.txid}`);
          console.log(`\nExplorer URL: https://solscan.io/tx/${result.txid}`);
        } else {
          console.error('\nSell transaction failed!');
          console.error(`Error: ${result.error}`);
          if (result.txid) {
            console.log(`Transaction ID: ${result.txid}`);
            console.log(`Explorer URL: https://solscan.io/tx/${result.txid}`);
          }
        }
      } catch (error) {
        console.error('Error executing sell command:', error.message);
      }
    });

  // Add a new command to check connection status
  program
    .command('status')
    .description('Check connection status and RPC endpoint')
    .action(async () => {
      try {
        const config = loadConfig();
        console.log(`Current RPC URL: ${config.rpcUrl}`);
        
        const spinner = ora('Testing connection to RPC endpoint...').start();
        
        // Force refresh the connection to ensure we're testing the current URL
        const connection = getConnection(true);
        
        try {
          // Test basic connection
          const version = await connection.getVersion();
          spinner.succeed('Connection successful!');
          console.log(`Solana version: ${JSON.stringify(version)}`);
          
          // Test additional metrics
          spinner.text = 'Checking current slot...';
          spinner.start();
          const slot = await connection.getSlot();
          spinner.succeed(`Current slot: ${slot}`);
          
          // Calculate latency
          spinner.text = 'Measuring RPC latency...';
          spinner.start();
          const startTime = Date.now();
          await connection.getRecentBlockhash();
          const endTime = Date.now();
          const latency = endTime - startTime;
          
          if (latency < 500) {
            spinner.succeed(`RPC Latency: ${latency}ms (Good)`);
          } else if (latency < 1000) {
            spinner.succeed(`RPC Latency: ${latency}ms (Acceptable)`);
          } else {
            spinner.warn(`RPC Latency: ${latency}ms (High - Consider upgrading RPC)`);
          }
          
          // Test getting block time
          try {
            spinner.text = 'Checking block time...';
            spinner.start();
            const blockTime = await connection.getBlockTime(slot);
            if (blockTime) {
              const date = new Date(blockTime * 1000);
              spinner.succeed(`Current block time: ${date.toISOString()}`);
              
              // Check if block time is recent
              const now = Date.now() / 1000;
              const timeDiff = now - blockTime;
              if (timeDiff > 60) {
                spinner.warn(`Block time is ${Math.floor(timeDiff)}s behind current time - RPC might be slow to sync`);
              }
            }
          } catch (error) {
            spinner.fail(`Error getting block time: ${error.message}`);
          }
          
          // Test getting a few accounts to check account loading
          try {
            spinner.text = 'Testing account loading...';
            spinner.start();
            const startTimeAccounts = Date.now();
            await connection.getParsedProgramAccounts(
              new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
              { limit: 1 }
            );
            const endTimeAccounts = Date.now();
            const accountLatency = endTimeAccounts - startTimeAccounts;
            
            if (accountLatency < 1000) {
              spinner.succeed(`Account loading latency: ${accountLatency}ms (Good)`);
            } else if (accountLatency < 2000) {
              spinner.succeed(`Account loading latency: ${accountLatency}ms (Acceptable)`);
            } else {
              spinner.warn(`Account loading latency: ${accountLatency}ms (High - Consider upgrading RPC)`);
            }
          } catch (error) {
            spinner.fail(`Error testing account loading: ${error.message}`);
          }
          
          // Summary
          console.log('\nRPC Health Summary:');
          if (latency < 800 && accountLatency < 1500) {
            console.log('✅ RPC appears to be healthy and performing well');
          } else {
            console.log('⚠️ RPC performance could be improved - consider upgrading to a dedicated RPC provider');
            console.log('   Recommended providers:');
            console.log('   - QuickNode: https://www.quicknode.com/chains/sol');
            console.log('   - Helius: https://www.helius.dev/');
            console.log('   - Triton: https://triton.one/');
          }
        } catch (error) {
          spinner.fail(`Connection test failed: ${error.message}`);
          console.log('Consider checking or updating your RPC URL in config.json');
          console.log('Recommended RPC providers:');
          console.log('- QuickNode: https://www.quicknode.com/chains/sol');
          console.log('- Helius: https://www.helius.dev/');
          console.log('- Triton: https://triton.one/');
        }
      } catch (error) {
        console.error('Error checking connection status:', error.message);
      }
    });

  // Add a command to reset connections
  program
    .command('reset')
    .description('Reset all connection instances')
    .action(() => {
      try {
        resetConnections();
        console.log('All connections have been reset');
        console.log('Try checking status with: node index.js status');
      } catch (error) {
        console.error('Error resetting connections:', error.message);
      }
    });

  // Setup config
  program
    .command('init')
    .description('Create a config file with default settings')
    .option('-p, --path <path>', 'Config file path', 'config.json')
    .action((options) => {
      try {
        // Default config
        const defaultConfig = {
          rpcUrl: "https://api.mainnet-beta.solana.com",
          defaultBuyAmount: 0.1,
          defaultFee: "medium",
          slippage: 1,
          antiMEV: true,
          dynamicFee: true,
          priorityFeeMultiplier: 2,
          feeLevels: {
            low: 200000,
            medium: 400000,
            high: 800000,
            urgent: 1200000,
            custom: 0
          }
        };

        // Check if config already exists
        if (fs.existsSync(options.path)) {
          console.log(`Config file already exists at ${options.path}`);
          const overwrite = require('prompt-sync')({ sigint: true })('Do you want to overwrite it? (y/n): ').toLowerCase();
          if (overwrite !== 'y') {
            console.log('Config creation cancelled.');
            return;
          }
        }

        // Write config
        fs.writeFileSync(options.path, JSON.stringify(defaultConfig, null, 2));
        console.log(`Config file created at ${options.path}`);
        console.log('You may want to customize the RPC URL and other settings.');
        
        // Initialize connection with the new config
        const connection = getConnection(true);
      } catch (error) {
        console.error('Error creating config file:', error.message);
      }
    });

  // Parse arguments and execute
  await program.parseAsync(process.argv);
}

// Execute main function
main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
