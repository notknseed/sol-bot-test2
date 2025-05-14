// index.js
const { program } = require('commander');
const { buyToken } = require('./buyToken');
const { sellToken } = require('./sellToken');
const { createWallet, importWallet, loadWallet } = require('./wallet');
const fs = require('fs');

// Main program
async function main() {
  program
    .name('solana-meme-trader')
    .description('A Solana meme token trading bot')
    .version('1.0.0');

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

  // Buy command
  program
    .command('buy')
    .description('Buy a token')
    .argument('<tokenAddress>', 'Token mint address')
    .option('-a, --amount <amount>', 'Amount of SOL to spend')
    .option('-f, --fee-type <feeType>', 'Fee type: low, medium, high, urgent, custom')
    .option('-v, --verbose', 'Verbose output for debugging')
    .option('-w, --wallet <path>', 'Path to wallet file', 'wallet.json')
    .action(async (tokenAddress, options) => {
      try {
        // Load wallet
        const keypair = loadWallet(options.wallet);
        if (!keypair) {
          console.error('Failed to load wallet. Please check your wallet file or create a new one.');
          return;
        }

        console.log(`Using wallet: ${keypair.publicKey.toString()}`);
        
        // Execute buy
        const result = await buyToken(keypair, tokenAddress, options);
        
        if (result.success) {
          console.log('\nBuy transaction succeeded!');
          if (result.amount) {
            console.log(`Tokens purchased: ${result.amount.toLocaleString()}`);
          }
          console.log(`SOL spent: ${result.amountSol}`);
          console.log(`Transaction ID: ${result.txid}`);
          console.log('\nExplorer URL:');
          console.log(`https://solscan.io/tx/${result.txid}`);
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

  // Sell command
  program
    .command('sell')
    .description('Sell a token')
    .argument('<tokenAddress>', 'Token mint address')
    .option('-p, --percentage <percentage>', 'Percentage of tokens to sell (default: 100%)', '100')
    .option('-a, --all', 'Sell all tokens (same as 100%)')
    .option('-f, --fee-type <feeType>', 'Fee type: low, medium, high, urgent, custom')
    .option('-v, --verbose', 'Verbose output for debugging')
    .option('-w, --wallet <path>', 'Path to wallet file', 'wallet.json')
    .action(async (tokenAddress, options) => {
      try {
        // Load wallet
        const keypair = loadWallet(options.wallet);
        if (!keypair) {
          console.error('Failed to load wallet. Please check your wallet file or create a new one.');
          return;
        }

        console.log(`Using wallet: ${keypair.publicKey.toString()}`);
        
        // Execute sell
        const result = await sellToken(keypair, tokenAddress, options);
        
        if (result.success) {
          console.log('\nSell transaction succeeded!');
          console.log(`Tokens sold: ${result.soldAmount.toLocaleString()}`);
          console.log(`SOL received: ${result.soldAmountSol.toFixed(4)}`);
          console.log(`Transaction ID: ${result.txid}`);
          console.log('\nExplorer URL:');
          console.log(`https://solscan.io/tx/${result.txid}`);
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
