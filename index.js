#!/usr/bin/env node

const { Connection, PublicKey, Keypair, Transaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { Token, TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const { createJupiterApiClient } = require('@jup-ag/api');
const bs58 = require('bs58');
const fs = require('fs');
const readline = require('readline');
const colors = require('colors');
const Table = require('cli-table');
const dotenv = require('dotenv');
const ora = require('ora');

// Load environment variables
dotenv.config();

// Define global constants
const CONFIG_FILE = 'config.json';
const KEYPAIR_FILE = 'keypair.json';
const HOLDINGS_FILE = 'holdings.json';

// Define menu states
const MENU_STATE = {
  MAIN: 'main',
  HOLDINGS: 'holdings',
  CONFIG: 'config',
  SETUP: 'setup',
  BUY: 'buy',
  SELL: 'sell',
  HISTORY: 'history'
};

// Keep track of current menu state
let currentMenuState = MENU_STATE.MAIN;
let breadcrumbPath = ['Main Menu'];

// Default configuration
const DEFAULT_CONFIG = {
  rpcUrl: 'https://api.mainnet-beta.solana.com',
  feeLevels: {
    low: 5000,
    medium: 10000,
    high: 20000
  },
  defaultFee: 'medium',
  antiMEV: true,
  defaultBuyAmount: 0.1, // in SOL
  defaultSellPercentage: 20, // 20%
  slippage: 1, // 1%
};

// Create readline interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Main function
async function main() {
  // Check if wallet is set up
  if (!fs.existsSync(KEYPAIR_FILE)) {
    console.log('No wallet found. Running setup...'.yellow);
    await setupWallet();
  }
  
  // Check if config is set up
  if (!fs.existsSync(CONFIG_FILE)) {
    console.log('No configuration found. Using defaults...'.yellow);
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2));
  }
  
  currentMenuState = MENU_STATE.MAIN;
  breadcrumbPath = ['Main Menu'];
  
  renderCurrentMenu();
}

// Render the current menu based on state
async function renderCurrentMenu() {
  console.clear();
  printBanner();
  printBreadcrumbs();
  
  switch (currentMenuState) {
    case MENU_STATE.MAIN:
      await renderMainMenu();
      break;
    case MENU_STATE.HOLDINGS:
      await renderHoldingsMenu();
      break;
    case MENU_STATE.CONFIG:
      await configureBot();
      break;
    case MENU_STATE.SETUP:
      await setupWallet();
      break;
    case MENU_STATE.BUY:
      await renderBuyMenu();
      break;
    case MENU_STATE.SELL:
      await renderSellMenu();
      break;
    case MENU_STATE.HISTORY:
      await renderHistoryMenu();
      break;
  }
}

// Print breadcrumbs
function printBreadcrumbs() {
  console.log(breadcrumbPath.join(' > ').gray);
  console.log('');
}

// Navigate to a new menu
function navigateTo(menuState, menuName) {
  currentMenuState = menuState;
  
  // Update breadcrumbs
  if (menuState === MENU_STATE.MAIN) {
    breadcrumbPath = ['Main Menu'];
  } else {
    // If we're going back, pop from breadcrumbs
    if (breadcrumbPath[breadcrumbPath.length - 1] !== menuName) {
      breadcrumbPath.push(menuName);
    }
  }
  
  renderCurrentMenu();
}

// Go back to previous menu
function goBack() {
  if (breadcrumbPath.length > 1) {
    breadcrumbPath.pop();
    
    // Determine the menu state based on the last breadcrumb
    const lastBreadcrumb = breadcrumbPath[breadcrumbPath.length - 1];
    
    switch (lastBreadcrumb) {
      case 'Main Menu':
        currentMenuState = MENU_STATE.MAIN;
        break;
      case 'Holdings':
        currentMenuState = MENU_STATE.HOLDINGS;
        break;
      case 'Configuration':
        currentMenuState = MENU_STATE.CONFIG;
        break;
      case 'Setup':
        currentMenuState = MENU_STATE.SETUP;
        break;
      case 'Buy Token':
        currentMenuState = MENU_STATE.BUY;
        break;
      case 'Sell Token':
        currentMenuState = MENU_STATE.SELL;
        break;
      case 'Transaction History':
        currentMenuState = MENU_STATE.HISTORY;
        break;
      default:
        currentMenuState = MENU_STATE.MAIN;
    }
  } else {
    currentMenuState = MENU_STATE.MAIN;
  }
  
  renderCurrentMenu();
}

// Render main menu with dashboard
async function renderMainMenu() {
  // Check wallet balance
  const balance = await getWalletBalance();
  const holdings = loadHoldings();
  
  // Calculate portfolio summary
  let totalTokens = Object.keys(holdings.tokens).length;
  let totalValue = 0;
  let totalProfit = 0;
  
  // If we have tokens, calculate total value and profit
  if (totalTokens > 0) {
    const connection = new Connection(loadConfig().rpcUrl, 'confirmed');
    const jupiterQuoteApi = createJupiterApiClient();
    
    for (const address of Object.keys(holdings.tokens)) {
      const token = holdings.tokens[address];
      
      try {
        // Get current price
        const quoteResponse = await jupiterQuoteApi.quoteGet({
          inputMint: address,
          outputMint: 'So11111111111111111111111111111111111111112', // SOL
          amount: token.amount.toString(),
          slippageBps: loadConfig().slippage * 100
        });
        
        if (quoteResponse && quoteResponse.data) {
          const bestRoute = quoteResponse.data;
          const currentValue = parseFloat(bestRoute.outAmount) / LAMPORTS_PER_SOL;
          
          totalValue += currentValue;
          totalProfit += currentValue - token.buyAmountSol;
        }
      } catch (error) {
        // Skip if error
      }
    }
  }
  
  // Display dashboard
  console.log('╔═════════════════════════════════════════════════╗'.cyan);
  console.log('║                  DASHBOARD                      ║'.cyan);
  console.log('╚═════════════════════════════════════════════════╝'.cyan);
  console.log('');
  
  // Wallet info
  console.log('WALLET INFORMATION:'.green);
  console.log(`Address: ${getWalletAddress().toString()}`);
  console.log(`Balance: ${balance.toFixed(4)} SOL`);
  
  // Network info
  const config = loadConfig();
  console.log('\nNETWORK STATUS:'.green);
  console.log(`RPC: ${config.rpcUrl}`);
  
  // Portfolio summary
  console.log('\nPORTFOLIO SUMMARY:'.green);
  console.log(`Total Tokens: ${totalTokens}`);
  console.log(`Total Value: ${totalValue.toFixed(4)} SOL`);
  
  if (totalValue > 0) {
    const profitColor = totalProfit >= 0 ? 'green' : 'red';
    const profitText = `${totalProfit.toFixed(4)} SOL`;
    console.log(`Total P&L: ${profitText}`[profitColor]);
  }
  
  console.log('\n');
  console.log('MAIN MENU:'.yellow);
  console.log('1. Buy Token - Purchase a new token'.cyan);
  console.log('2. Holdings - View and manage your tokens'.cyan);
  console.log('3. Transaction History'.cyan);
  console.log('4. Configure Bot Settings'.cyan);
  console.log('5. Wallet Setup'.cyan);
  console.log('0. Exit Program'.cyan);
  
  console.log('');
  rl.question('Select an option (0-5): ', (choice) => {
    switch (choice) {
      case '0':
        console.log('Exiting program. Goodbye!'.yellow);
        rl.close();
        process.exit(0);
        break;
      case '1':
        navigateTo(MENU_STATE.BUY, 'Buy Token');
        break;
      case '2':
        navigateTo(MENU_STATE.HOLDINGS, 'Holdings');
        break;
      case '3':
        navigateTo(MENU_STATE.HISTORY, 'Transaction History');
        break;
      case '4':
        navigateTo(MENU_STATE.CONFIG, 'Configuration');
        break;
      case '5':
        navigateTo(MENU_STATE.SETUP, 'Setup');
        break;
      default:
        console.log('Invalid option. Please try again.'.red);
        setTimeout(renderCurrentMenu, 1500);
    }
  });
}

// Render buy menu
async function renderBuyMenu() {
  console.log('╔═════════════════════════════════════════════════╗'.cyan);
  console.log('║                  BUY TOKEN                      ║'.cyan);
  console.log('╚═════════════════════════════════════════════════╝'.cyan);
  console.log('');
  
  console.log('Enter token address or DEX URL:'.yellow);
  console.log('(Example: https://raydium.io/swap/?inputCurrency=sol&outputCurrency=ADDRESS)');
  console.log('(Example: https://jup.ag/swap/SOL-ADDRESS)');
  console.log('');
  console.log('0. Back to Main Menu'.gray);
  
  rl.question('> ', async (input) => {
    if (input === '0') {
      goBack();
      return;
    }
    
    if (input.trim() === '') {
      console.log('Input cannot be empty. Please try again.'.red);
      setTimeout(() => navigateTo(MENU_STATE.BUY, 'Buy Token'), 1500);
      return;
    }
    
    // Try to extract address from URL or use direct address
    const address = extractAddressFromInput(input);
    if (address) {
      console.log(`Buying token: ${address}`.cyan);
      await buyToken(address);
      
      console.log('');
      rl.question('Press Enter to continue...', () => {
        navigateTo(MENU_STATE.MAIN, 'Main Menu');
      });
    } else {
      console.log('Invalid token address format. Please provide a valid Solana address or URL.'.red);
      setTimeout(() => navigateTo(MENU_STATE.BUY, 'Buy Token'), 2000);
    }
  });
}

// Render holdings menu
async function renderHoldingsMenu() {
  console.log('╔═════════════════════════════════════════════════╗'.cyan);
  console.log('║                  HOLDINGS                       ║'.cyan);
  console.log('╚═════════════════════════════════════════════════╝'.cyan);
  console.log('');
  
  // Load holdings
  const holdings = loadHoldings();
  
  // If no holdings, show message
  if (Object.keys(holdings.tokens).length === 0) {
    console.log('No tokens in your holdings.'.yellow);
    console.log('');
    console.log('1. Buy your first token'.cyan);
    console.log('0. Back to Main Menu'.gray);
    
    rl.question('Select an option (0-1): ', (choice) => {
      if (choice === '1') {
        navigateTo(MENU_STATE.BUY, 'Buy Token');
      } else {
        navigateTo(MENU_STATE.MAIN, 'Main Menu');
      }
    });
    return;
  }
  
  // Display holdings in a table
  await displayHoldingsNumbered();
  
  console.log('');
  console.log('HOLDINGS MENU:'.yellow);
  console.log('1. Sell Token'.cyan);
  console.log('2. Refresh Holdings'.cyan);
  console.log('3. Buy New Token'.cyan);
  console.log('0. Back to Main Menu'.gray);
  
  rl.question('Select an option (0-3): ', async (choice) => {
    switch (choice) {
      case '0':
        goBack();
        break;
      case '1':
        rl.question('Select token number to sell: ', (tokenNum) => {
          const tokenIndex = parseInt(tokenNum) - 1;
          const tokens = Object.keys(holdings.tokens);
          
          if (isNaN(tokenIndex) || tokenIndex < 0 || tokenIndex >= tokens.length) {
            console.log('Invalid selection. Please try again.'.red);
            setTimeout(() => navigateTo(MENU_STATE.HOLDINGS, 'Holdings'), 1500);
          } else {
            const selectedTokenAddress = tokens[tokenIndex];
            breadcrumbPath.push('Sell Token');
            currentMenuState = MENU_STATE.SELL;
            showSellOptions(selectedTokenAddress);
          }
        });
        break;
      case '2':
        navigateTo(MENU_STATE.HOLDINGS, 'Holdings');
        break;
      case '3':
        navigateTo(MENU_STATE.BUY, 'Buy Token');
        break;
      default:
        console.log('Invalid option. Please try again.'.red);
        setTimeout(() => navigateTo(MENU_STATE.HOLDINGS, 'Holdings'), 1500);
    }
  });
}

// Render history menu
async function renderHistoryMenu() {
  console.log('╔═════════════════════════════════════════════════╗'.cyan);
  console.log('║             TRANSACTION HISTORY                 ║'.cyan);
  console.log('╚═════════════════════════════════════════════════╝'.cyan);
  console.log('');
  
  // Load holdings to get transactions
  const holdings = loadHoldings();
  
  if (!holdings.transactions || holdings.transactions.length === 0) {
    console.log('No transaction history found.'.yellow);
  } else {
    // Create a table for transactions
    const table = new Table({
      head: ['Date', 'Type', 'Token', 'Amount', 'Value (SOL)', 'P&L'],
      colWidths: [20, 8, 12, 14, 14, 14],
      style: {
        head: ['cyan'],
        border: ['gray']
      }
    });
    
    // Sort by newest first
    const sortedTx = [...holdings.transactions].sort((a, b) => b.time - a.time);
    
    for (const tx of sortedTx) {
      const date = new Date(tx.time).toLocaleString();
      const tokenAddr = tx.token.slice(0, 8) + '...';
      
      let profit = '';
      if (tx.type === 'sell' && tx.profit !== undefined) {
        const profitColor = tx.profit >= 0 ? 'green' : 'red';
        profit = `${tx.profit.toFixed(4)} (${tx.profitPercentage.toFixed(2)}%)`;
      }
      
      table.push([
        date,
        tx.type.toUpperCase(),
        tokenAddr,
        tx.type === 'buy' ? tx.amount.toFixed(4) : tx.amount.toFixed(4),
        tx.type === 'buy' ? tx.amount.toFixed(4) : tx.amountSol.toFixed(4),
        profit
      ]);
    }
    
    console.log(table.toString());
  }
  
  console.log('');
  console.log('0. Back to Main Menu'.gray);
  
  rl.question('Select an option (0): ', (choice) => {
    goBack();
  });
}

// Print banner
function printBanner() {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════╗'.green);
  console.log('║                                                   ║'.green);
  console.log('║           SOLANA MEME TRADING BOT                ║'.green);
  console.log('║                                                   ║'.green);
  console.log('╚═══════════════════════════════════════════════════╝'.green);
  console.log('');
}

// Display holdings in numbered list
async function displayHoldingsNumbered() {
  const holdings = loadHoldings();
  const config = loadConfig();
  const connection = new Connection(config.rpcUrl, 'confirmed');
  const jupiterQuoteApi = createJupiterApiClient();
  
  const tokens = Object.keys(holdings.tokens);
  
  // Create a table for holdings
  const table = new Table({
    head: ['#', 'Token', 'Amount', 'Value (SOL)', 'Buy Price', 'P&L', 'P&L %'],
    colWidths: [4, 12, 16, 14, 14, 14, 10],
    style: {
      head: ['cyan'],
      border: ['gray']
    }
  });
  
  let totalValue = 0;
  let totalProfit = 0;
  let totalInvestment = 0;
  
  const spinner = ora('Loading token values...').start();
  
  for (let i = 0; i < tokens.length; i++) {
    const address = tokens[i];
    const token = holdings.tokens[address];
    
    try {
      // Get current price
      const quoteResponse = await jupiterQuoteApi.quoteGet({
        inputMint: address,
        outputMint: 'So11111111111111111111111111111111111111112', // SOL
        amount: token.amount.toString(),
        slippageBps: config.slippage * 100
      });
      
      if (!quoteResponse || !quoteResponse.data) {
        table.push([
          (i+1).toString(),
          address.slice(0, 8) + '...',
          token.amount.toFixed(4),
          'N/A',
          token.buyPrice.toFixed(8),
          'N/A',
          'N/A'
        ]);
        continue;
      }
      
      const bestRoute = quoteResponse.data;
      const currentPrice = parseFloat(bestRoute.outAmount) / parseFloat(bestRoute.inAmount);
      const currentValue = parseFloat(bestRoute.outAmount) / LAMPORTS_PER_SOL;
      
      totalValue += currentValue;
      totalInvestment += token.buyAmountSol;
      
      const profit = currentValue - token.buyAmountSol;
      const profitPercentage = (profit / token.buyAmountSol) * 100;
      
      totalProfit += profit;
      
      // Format profit
      const profitColor = profit >= 0 ? 'green' : 'red';
      const profitText = `${profit.toFixed(4)}`;
      const profitPercentText = `${profitPercentage.toFixed(2)}%`;
      
      table.push([
        (i+1).toString(),
        address.slice(0, 8) + '...',
        token.amount.toFixed(4),
        currentValue.toFixed(4),
        token.buyPrice.toFixed(8),
        profitText,
        profitPercentText
      ]);
      
    } catch (error) {
      table.push([
        (i+1).toString(),
        address.slice(0, 8) + '...',
        token.amount.toFixed(4),
        'Error',
        token.buyPrice.toFixed(8),
        'N/A',
        'N/A'
      ]);
    }
  }
  
  spinner.stop();
  
  console.log(table.toString());
  
  console.log('\nSummary:'.cyan);
  const totalProfitColor = totalProfit >= 0 ? 'green' : 'red';
  console.log(`Total Investment: ${totalInvestment.toFixed(4)} SOL`);
  console.log(`Total Value: ${totalValue.toFixed(4)} SOL`);
  console.log(`Total P&L: ${totalProfit.toFixed(4)} SOL (${((totalProfit / totalInvestment) * 100).toFixed(2)}%)`[totalProfitColor]);
}

// Show sell options
async function showSellOptions(tokenAddress) {
  console.clear();
  printBanner();
  printBreadcrumbs();
  
  console.log('╔═════════════════════════════════════════════════╗'.cyan);
  console.log('║                  SELL TOKEN                      ║'.cyan);
  console.log('╚═════════════════════════════════════════════════╝'.cyan);
  console.log('');
  
  console.log(`Selected Token: ${tokenAddress.slice(0, 8)}...`.yellow);
  console.log('');
  console.log('SELL OPTIONS:'.yellow);
  console.log('1. Sell 25%'.cyan);
  console.log('2. Sell 50%'.cyan);
  console.log('3. Sell 75%'.cyan);
  console.log('4. Sell 100% (All)'.cyan);
  console.log('5. Custom percentage'.cyan);
  console.log('0. Back to Holdings'.gray);
  console.log('');
  
  rl.question('Select an option (0-5): ', async (input) => {
    const option = parseInt(input);
    
    if (option === 0) {
      navigateTo(MENU_STATE.HOLDINGS, 'Holdings');
      return;
    }
    
    if (isNaN(option) || option < 1 || option > 5) {
      console.log('Invalid option. Please try again.'.red);
      setTimeout(() => showSellOptions(tokenAddress), 1500);
      return;
    }
    
    let percentage;
    
    switch (option) {
      case 1:
        percentage = 25;
        break;
      case 2:
        percentage = 50;
        break;
      case 3:
        percentage = 75;
        break;
      case 4:
        percentage = 100;
        break;
      case 5:
        rl.question('Enter custom percentage (1-100): ', async (customInput) => {
          const customPercentage = parseInt(customInput);
          
          if (isNaN(customPercentage) || customPercentage < 1 || customPercentage > 100) {
            console.log('Invalid percentage. Please try again.'.red);
            setTimeout(() => showSellOptions(tokenAddress), 1500);
            return;
          }
          
          await sellToken(tokenAddress, { percentage: customPercentage });
          
          console.log('');
          rl.question('Press Enter to continue...', () => {
            navigateTo(MENU_STATE.HOLDINGS, 'Holdings');
          });
        });
        return;
    }
    
    if (percentage === 100) {
      await sellToken(tokenAddress, { all: true });
    } else {
      await sellToken(tokenAddress, { percentage });
    }
    
    console.log('');
    rl.question('Press Enter to continue...', () => {
      navigateTo(MENU_STATE.HOLDINGS, 'Holdings');
    });
  });
}

// Setup wallet
async function setupWallet() {
  console.clear();
  printBanner();
  
  if (currentMenuState === MENU_STATE.SETUP) {
    printBreadcrumbs();
  }
  
  console.log('╔═════════════════════════════════════════════════╗'.cyan);
  console.log('║                 WALLET SETUP                     ║'.cyan);
  console.log('╚═════════════════════════════════════════════════╝'.cyan);
  console.log('');
  
  console.log('WALLET SETUP OPTIONS:'.yellow);
  console.log('1. Import existing wallet (with private key)'.cyan);
  console.log('2. Create new wallet'.cyan);
  console.log('0. Back to Main Menu'.gray);
  console.log('');
  
  rl.question('Select an option (0-2): ', async (choice) => {
    switch (choice) {
      case '0':
        goBack();
        break;
      case '1':
        rl.question('Enter your private key: ', (privateKey) => {
          try {
            const decoded = bs58.decode(privateKey.trim());
            const keypair = Keypair.fromSecretKey(decoded);
            saveKeypair(keypair);
            
            console.log('Wallet imported successfully!'.green);
            console.log(`Your public key: ${keypair.publicKey.toString()}`.yellow);
            console.log('');
            
            rl.question('Press Enter to continue...', () => {
              goBack();
            });
          } catch (error) {
            console.log('Invalid private key. Please try again.'.red);
            setTimeout(() => navigateTo(MENU_STATE.SETUP, 'Setup'), 1500);
          }
        });
        break;
      case '2':
        console.log('Generating a new wallet...'.yellow);
        const keypair = Keypair.generate();
        saveKeypair(keypair);
        
        console.log('Wallet created successfully!'.green);
        console.log(`Your public key: ${keypair.publicKey.toString()}`.yellow);
        console.log('Backup your keypair.json file. Never share your private key!'.red);
        console.log('');
        
        rl.question('Press Enter to continue...', () => {
          goBack();
        });
        break;
      default:
        console.log('Invalid option. Please try again.'.red);
        setTimeout(() => navigateTo(MENU_STATE.SETUP, 'Setup'), 1500);
    }
  });
}

// Configure bot settings
async function configureBot() {
  console.clear();
  printBanner();
  printBreadcrumbs();
  
  // Load current config
  let config = DEFAULT_CONFIG;
  if (fs.existsSync(CONFIG_FILE)) {
    config = JSON.parse(fs.readFileSync(CONFIG_FILE));
  }
  
  console.log('╔═════════════════════════════════════════════════╗'.cyan);
  console.log('║               BOT CONFIGURATION                  ║'.cyan);
  console.log('╚═════════════════════════════════════════════════╝'.cyan);
  console.log('');
  
  // Display current settings
  console.log('CURRENT SETTINGS:'.yellow);
  console.log(`1. RPC URL: ${config.rpcUrl}`);
  console.log(`2. Anti-MEV: ${config.antiMEV ? 'ON' : 'OFF'}`);
  console.log(`3. Default fee level: ${config.defaultFee}`);
  console.log(`4. Default buy amount: ${config.defaultBuyAmount} SOL`);
  console.log(`5. Default sell percentage: ${config.defaultSellPercentage}%`);
  console.log(`6. Slippage: ${config.slippage}%`);
  console.log('');
  console.log('7. Save and return to main menu'.green);
  console.log('0. Cancel and return to main menu'.gray);
  console.log('');
  
  rl.question('Select a setting to change (0-7): ', async (choice) => {
    switch (choice) {
      case '0':
        goBack();
        break;
      case '1':
        rl.question('Enter new RPC URL: ', (rpcUrl) => {
          if (rpcUrl) config.rpcUrl = rpcUrl;
          fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
          navigateTo(MENU_STATE.CONFIG, 'Configuration');
        });
        break;
      case '2':
        rl.question('Anti-MEV (on/off): ', (antiMEV) => {
          if (antiMEV) config.antiMEV = antiMEV.toLowerCase() === 'on';
          fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
          navigateTo(MENU_STATE.CONFIG, 'Configuration');
        });
        break;
      case '3':
        rl.question('Default fee level (low/medium/high): ', (feeLevel) => {
          if (feeLevel && ['low', 'medium', 'high'].includes(feeLevel.toLowerCase())) {
            config.defaultFee = feeLevel.toLowerCase();
          }
          fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
          navigateTo(MENU_STATE.CONFIG, 'Configuration');
        });
        break;
      case '4':
        rl.question('Default buy amount (in SOL): ', (buyAmount) => {
          if (buyAmount && !isNaN(parseFloat(buyAmount))) {
            config.defaultBuyAmount = parseFloat(buyAmount);
          }
          fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
          navigateTo(MENU_STATE.CONFIG, 'Configuration');
        });
        break;
      case '5':
        rl.question('Default sell percentage: ', (sellPercentage) => {
          if (sellPercentage && !isNaN(parseFloat(sellPercentage))) {
            config.defaultSellPercentage = parseFloat(sellPercentage);
          }
          fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
          navigateTo(MENU_STATE.CONFIG, 'Configuration');
        });
        break;
      case '6':
        rl.question('Slippage percentage: ', (slippage) => {
          if (slippage && !isNaN(parseFloat(slippage))) {
            config.slippage = parseFloat(slippage);
          }
          fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
          navigateTo(MENU_STATE.CONFIG, 'Configuration');
        });
        break;
      case '7':
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
        console.log('Configuration saved!'.green);
        
        setTimeout(() => {
          goBack();
        }, 1000);
        break;
      default:
        console.log('Invalid option. Please try again.'.red);
        setTimeout(() => navigateTo(MENU_STATE.CONFIG, 'Configuration'), 1500);
    }
  });
}

// Extract address from input (URL or direct address)
function extractAddressFromInput(input) {
  // Check if it's already a valid address
  if (isValidSolanaAddress(input)) {
    return input;
  }
  
  // Try to extract from URL (common patterns in DEX links)
  try {
    // Raydium format: https://raydium.io/swap/?inputCurrency=sol&outputCurrency=ADDRESS
    if (input.includes('raydium.io') && input.includes('outputCurrency=')) {
      return input.split('outputCurrency=')[1].split('&')[0];
    }
    
    // Jupiter format: https://jup.ag/swap/SOL-ADDRESS
    if (input.includes('jup.ag/swap/') && input.includes('-')) {
      return input.split('-')[1].split('/')[0].split('?')[0];
    }
    
    // Birdeye format: https://birdeye.so/token/ADDRESS
    if (input.includes('birdeye.so/token/')) {
      return input.split('/token/')[1].split('?')[0].split('/')[0];
    }
    
    // Fallback: Try to find any 32-44 character base58 string in the URL
    const matches = input.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/g);
    if (matches && matches.length > 0) {
      // Verify it's a valid public key
      try {
        new PublicKey(matches[0]);
        return matches[0];
      } catch (e) {
        return null;
      }
    }
  } catch (error) {
    return null;
  }
  
  return null;
}

// Check if string is a valid Solana address
function isValidSolanaAddress(str) {
  try {
    new PublicKey(str);
    return true;
  } catch (error) {
    return false;
  }
}

// Get wallet address
function getWalletAddress() {
  const keypairData = JSON.parse(fs.readFileSync(KEYPAIR_FILE));
  return new PublicKey(keypairData.publicKey);
}

// Get wallet balance
async function getWalletBalance() {
  try {
    const config = loadConfig();
    const connection = new Connection(config.rpcUrl, 'confirmed');
    const address = getWalletAddress();
    const balance = await connection.getBalance(address);
    return balance / LAMPORTS_PER_SOL;
  } catch (error) {
    console.error('Error getting wallet balance:', error);
    return 0;
  }
}

// Helper function to load keypair
function loadKeypair() {
  const keypairData = JSON.parse(fs.readFileSync(KEYPAIR_FILE));
  return Keypair.fromSecretKey(new Uint8Array(keypairData.secretKey));
}

// Helper function to load config
function loadConfig() {
  if (fs.existsSync(CONFIG_FILE)) {
    return JSON.parse(fs.readFileSync(CONFIG_FILE));
  }
  return DEFAULT_CONFIG;
}

// Helper function to load holdings
function loadHoldings() {
  if (fs.existsSync(HOLDINGS_FILE)) {
    return JSON.parse(fs.readFileSync(HOLDINGS_FILE));
  }
  return { tokens: {}, transactions: [] };
}

// Helper function to save holdings
function saveHoldings(holdings) {
  fs.writeFileSync(HOLDINGS_FILE, JSON.stringify(holdings, null, 2));
}

// Save keypair to file
function saveKeypair(keypair) {
  const keypairData = {
    publicKey: keypair.publicKey.toString(),
    secretKey: Array.from(keypair.secretKey)
  };
  
  fs.writeFileSync(KEYPAIR_FILE, JSON.stringify(keypairData, null, 2));
  
  // Initialize holdings file if it doesn't exist
  if (!fs.existsSync(HOLDINGS_FILE)) {
    fs.writeFileSync(HOLDINGS_FILE, JSON.stringify({
      tokens: {},
      transactions: []
    }, null, 2));
  }
  
  // Initialize config file if it doesn't exist
  if (!fs.existsSync(CONFIG_FILE)) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2));
  }
}

// Buy token
async function buyToken(tokenAddress, options = {}) {
  const spinner = ora('Processing transaction...').start();
  
  try {
    // Validate token address
    const tokenPublicKey = new PublicKey(tokenAddress);
    
    // Load config and keypair
    const config = loadConfig();
    const keypair = loadKeypair();
    
    // Calculate amount
    const amount = options.amount ? parseFloat(options.amount) : config.defaultBuyAmount;
    
    // Connect to Solana
    const connection = new Connection(config.rpcUrl, 'confirmed');
    
    // Initialize Jupiter API client
    const jupiterQuoteApi = createJupiterApiClient();
    
    // Calculate fee level
    const computeLimit = config.feeLevels[config.defaultFee];
    
    // Get quotes
    const quoteResponse = await jupiterQuoteApi.quoteGet({
      inputMint: 'So11111111111111111111111111111111111111112', // SOL
      outputMint: tokenAddress,
      amount: (LAMPORTS_PER_SOL * amount).toString(), // Convert to lamports as string
      slippageBps: config.slippage * 100 // Convert percentage to basis points
    });
    
    if (!quoteResponse || !quoteResponse.data) {
      spinner.fail('No routes found for this token!');
      return;
    }
    
    // Select best route
    const bestRoute = quoteResponse.data;
    
    // Get swap instructions
    const swapParams = {
      quoteResponse: bestRoute,
      userPublicKey: keypair.publicKey.toString(),
      wrapUnwrapSOL: true
    };
    
    const swapResponse = await jupiterQuoteApi.swapPost({
      swapRequest: swapParams
    });
    
    // Create transaction
    const swapTransactionBuf = Buffer.from(swapResponse.data.swapTransaction, 'base64');
    const transaction = Transaction.from(swapTransactionBuf);
    
    // Add compute budget instruction if needed
    if (computeLimit) {
      // Add compute budget instruction
      // Note: Jupiter API v6 already includes this in most cases
    }
    
    // Set transaction options
    const options = config.antiMEV ? {
      skipPreflight: true,
      preflightCommitment: 'processed',
    } : {
      preflightCommitment: 'confirmed'
    };
    
    // Send and confirm transaction
    const result = await sendAndConfirmTransaction(
      connection,
      transaction,
      [keypair],
      options
    );
    
    // Update holdings
    const holdings = loadHoldings();
    
    // Get token details
    const tokenInfo = {
      address: tokenAddress,
      buyPrice: parseFloat(bestRoute.outAmount) / parseFloat(bestRoute.inAmount),
      amount: parseFloat(bestRoute.outAmount),
      buyTime: Date.now(),
      buyAmountSol: amount
    };
    
    // Add to holdings
    holdings.tokens[tokenAddress] = tokenInfo;
    
    // Add to transactions
    holdings.transactions.push({
      type: 'buy',
      token: tokenAddress,
      amount: amount,
      price: tokenInfo.buyPrice,
      time: Date.now(),
      txid: result
    });
    
    // Save holdings
    saveHoldings(holdings);
    
    spinner.succeed(`Successfully bought ${tokenInfo.amount} tokens for ${amount} SOL!`);
    console.log(`Transaction ID: ${result}`);
    
  } catch (error) {
    spinner.fail(`Error buying token: ${error.message}`);
    console.error(error);
  }
}

// Sell token
async function sellToken(tokenAddress, options = {}) {
  const spinner = ora('Processing transaction...').start();
  
  try {
    // Validate token address
    const tokenPublicKey = new PublicKey(tokenAddress);
    
    // Load config and keypair
    const config = loadConfig();
    const keypair = loadKeypair();
    
    // Load holdings
    const holdings = loadHoldings();
    
    // Check if we have this token
    if (!holdings.tokens[tokenAddress]) {
      spinner.fail('You don\'t own this token!');
      return;
    }
    
    // Get token info
    const tokenInfo = holdings.tokens[tokenAddress];
    
    // Calculate sell amount
    let sellPercentage = options.percentage ? parseFloat(options.percentage) : config.defaultSellPercentage;
    if (options.all) sellPercentage = 100;
    
    const sellAmount = tokenInfo.amount * (sellPercentage / 100);
    
    // Connect to Solana
    const connection = new Connection(config.rpcUrl, 'confirmed');
    
    // Initialize Jupiter API client
    const jupiterQuoteApi = createJupiterApiClient();
    
    // Calculate fee level
    const computeLimit = config.feeLevels[config.defaultFee];
    
    // Get quotes
    const quoteResponse = await jupiterQuoteApi.quoteGet({
      inputMint: tokenAddress,
      outputMint: 'So11111111111111111111111111111111111111112', // SOL
      amount: sellAmount.toString(),
      slippageBps: config.slippage * 100 // Convert percentage to basis points
    });
    
    if (!quoteResponse || !quoteResponse.data) {
      spinner.fail('No routes found for this token!');
      return;
    }
    
    // Select best route
    const bestRoute = quoteResponse.data;
    
    // Get swap instructions
    const swapParams = {
      quoteResponse: bestRoute,
      userPublicKey: keypair.publicKey.toString(),
      wrapUnwrapSOL: true
    };
    
    const swapResponse = await jupiterQuoteApi.swapPost({
      swapRequest: swapParams
    });
    
    // Create transaction
    const swapTransactionBuf = Buffer.from(swapResponse.data.swapTransaction, 'base64');
    const transaction = Transaction.from(swapTransactionBuf);
    
    // Add compute budget instruction if needed
    if (computeLimit) {
      // Add compute budget instruction
      // Note: Jupiter API v6 already includes this in most cases
    }
    
    // Set transaction options
    const options = config.antiMEV ? {
      skipPreflight: true,
      preflightCommitment: 'processed',
    } : {
      preflightCommitment: 'confirmed'
    };
    
    // Send and confirm transaction
    const result = await sendAndConfirmTransaction(
      connection,
      transaction,
      [keypair],
      options
    );
    
    // Update holdings
    const soldAmountSol = parseFloat(bestRoute.outAmount) / LAMPORTS_PER_SOL;
    const profit = soldAmountSol - (tokenInfo.buyAmountSol * (sellPercentage / 100));
    const profitPercentage = (profit / (tokenInfo.buyAmountSol * (sellPercentage / 100))) * 100;
    
    // Update token amount
    if (sellPercentage === 100) {
      delete holdings.tokens[tokenAddress];
    } else {
      tokenInfo.amount -= sellAmount;
    }
    
    // Add to transactions
    holdings.transactions.push({
      type: 'sell',
      token: tokenAddress,
      amount: sellAmount,
      amountSol: soldAmountSol,
      percentage: sellPercentage,
      profit: profit,
      profitPercentage: profitPercentage,
      time: Date.now(),
      txid: result
    });
    
    // Save holdings
    saveHoldings(holdings);
    
    spinner.succeed(`Successfully sold ${sellPercentage}% of ${tokenAddress.slice(0, 8)}... for ${soldAmountSol.toFixed(4)} SOL!`);
    console.log(`Profit: ${profit.toFixed(4)} SOL (${profitPercentage.toFixed(2)}%)`);
    console.log(`Transaction ID: ${result}`);
    
  } catch (error) {
    spinner.fail(`Error selling token: ${error.message}`);
    console.error(error);
  }
}

// Start the program
main().catch(console.error);
