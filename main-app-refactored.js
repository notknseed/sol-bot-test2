#!/usr/bin/env node

// Import core modules
const { Connection, PublicKey, Keypair, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { createJupiterApiClient } = require('@jup-ag/api');
const bs58 = require('bs58');
const fs = require('fs');
const readline = require('readline');
const colors = require('colors');
const Table = require('cli-table');
const dotenv = require('dotenv');
const ora = require('ora');

// Import our custom modules
const { buyToken } = require('./buyToken');
const { sellToken } = require('./sellToken');
const { 
  loadConfig, 
  loadKeypair, 
  loadHoldings, 
  saveHoldings, 
  getWalletAddress,
  extractAddressFromInput,
  isValidSolanaAddress
} = require('./utils');

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

// DEFAULT_CONFIG
const DEFAULT_CONFIG = {
  rpcUrl: 'https://api.mainnet-beta.solana.com',
  feeLevels: {
    low: 5000,
    medium: 10000,
    high: 20000,
    urgent: 30000,   // Add urgent level
    custom: 0        // Default value for custom
  },
  defaultFee: 'medium',
  priorityFeeMultiplier: 1.0, // Multiplier factor to adjust based on network conditions
  dynamicFee: false,        // Dynamic fee feature based on network conditions
  antiMEV: true,
  defaultBuyAmount: 0.1,    // in SOL
  defaultSellPercentage: 20, // 20%
  slippage: 1,              // 1%
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
  const holdings = loadHoldings(HOLDINGS_FILE);
  
  // Calculate portfolio summary
  let totalTokens = Object.keys(holdings.tokens).length;
  let totalValue = 0;
  let totalProfit = 0;
  
  // If we have tokens, calculate total value and profit
  if (totalTokens > 0) {
    const config = loadConfig(CONFIG_FILE);
    const connection = new Connection(config.rpcUrl, 'confirmed');
    const jupiterQuoteApi = createJupiterApiClient();
    
    for (const address of Object.keys(holdings.tokens)) {
      const token = holdings.tokens[address];
      
      try {
        // Get current price
        const quoteResponse = await jupiterQuoteApi.quoteGet({
          inputMint: address,
          outputMint: 'So11111111111111111111111111111111111111112', // SOL
          amount: token.amount.toString(),
          slippageBps: config.slippage * 100
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
  console.log(`Address: ${getWalletAddress(KEYPAIR_FILE).toString()}`);
  console.log(`Balance: ${balance.toFixed(4)} SOL`);
  
  // Network info
  const config = loadConfig(CONFIG_FILE);
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
    
    // Try to extract address from input (URL or direct address)
    const address = extractAddressFromInput(input);
    if (address) {
      console.log(`Buying token: ${address}`.cyan);
      
      // Setup path config and options
      const pathConfig = {
        CONFIG_FILE,
        KEYPAIR_FILE,
        HOLDINGS_FILE
      };
      
      const options = {
        verbose: true, // Enable for debugging
        // Other options can be passed here: amount, feeType, etc.
      };
      
      // Call the buyToken module
      const result = await buyToken(address, options, pathConfig);
      
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

// Get wallet balance
async function getWalletBalance() {
  try {
    const config = loadConfig(CONFIG_FILE);
    const connection = new Connection(config.rpcUrl, 'confirmed');
    const address = getWalletAddress(KEYPAIR_FILE);
    const balance = await connection.getBalance(address);
    return balance / LAMPORTS_PER_SOL;
  } catch (error) {
    console.error('Error getting wallet balance:', error);
    return 0;
  }
}

// Display holdings in numbered list
async function displayHoldingsNumbered() {
  const holdings = loadHoldings(HOLDINGS_FILE);
  const config = loadConfig(CONFIG_FILE);
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

// Render holdings menu
async function renderHoldingsMenu() {
  console.log('╔═════════════════════════════════════════════════╗'.cyan);
  console.log('║                  HOLDINGS                       ║'.cyan);
  console.log('╚═════════════════════════════════════════════════╝'.cyan);
  console.log('');
  
  // Load holdings
  const holdings = loadHoldings(HOLDINGS_FILE);
  
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
          
          // Setup path config and options
          const pathConfig = {
            CONFIG_FILE,
            KEYPAIR_FILE,
            HOLDINGS_FILE
          };
          
          const options = {
            verbose: true,
            percentage: customPercentage
          };
          
          // Call sellToken from imported module
          await sellToken(tokenAddress, options, pathConfig);
          
          console.log('');
          rl.question('Press Enter to continue...', () => {
            navigateTo(MENU_STATE.HOLDINGS, 'Holdings');
          });
        });
        return;
    }
    
    // Setup path config and options
    const pathConfig = {
      CONFIG_FILE,
      KEYPAIR_FILE,
      HOLDINGS_FILE
    };
    
    const options = {
      verbose: true,
      percentage: percentage,
      all: percentage === 100
    };
    
    // Call sellToken from imported module
    await sellToken(tokenAddress, options, pathConfig);
    
    console.log('');
    rl.question('Press Enter to continue...', () => {
      navigateTo(MENU_STATE.HOLDINGS, 'Holdings');
    });
  });
}

// [Setup Wallet, Configure Bot, and other functions continue...]

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

// Render history menu
async function renderHistoryMenu() {
  console.log('╔═════════════════════════════════════════════════╗'.cyan);
  console.log('║             TRANSACTION HISTORY                 ║'.cyan);
  console.log('╚═════════════════════════════════════════════════╝'.cyan);
  console.log('');
  
  // Load holdings to get transactions
  const holdings = loadHoldings(HOLDINGS_FILE);
  
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
  console.log(`7. Fee settings`.yellow);
  console.log(`   a. Low fee: ${config.feeLevels.low}`);
  console.log(`   b. Medium fee: ${config.feeLevels.medium}`);
  console.log(`   c. High fee: ${config.feeLevels.high}`);
  console.log(`   d. Urgent fee: ${config.feeLevels.urgent || 30000}`);
  console.log(`   e. Custom fee: ${config.feeLevels.custom || 0}`);
  console.log(`   f. Dynamic fee: ${config.dynamicFee ? 'ON' : 'OFF'}`);
  console.log(`   g. Priority fee multiplier: ${config.priorityFeeMultiplier || 1.0}x`);
  console.log('');
  console.log('8. Save and return to main menu'.green);
  console.log('0. Cancel and return to main menu'.gray);
  console.log('');
  
  rl.question('Select a setting to change (0-8 or 7a-7g): ', async (choice) => {
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
        rl.question('Default fee level (low/medium/high/urgent): ', (feeLevel) => {
          if (feeLevel && ['low', 'medium', 'high', 'urgent'].includes(feeLevel.toLowerCase())) {
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
      case '7a':
        rl.question('Enter new Low fee (recommended: 3000-5000): ', (fee) => {
          const feeValue = parseInt(fee);
          if (!isNaN(feeValue) && feeValue > 0) {
            config.feeLevels.low = feeValue;
          }
          fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
          navigateTo(MENU_STATE.CONFIG, 'Configuration');
        });
        break;
      case '7b':
        rl.question('Enter new Medium fee (recommended: 8000-12000): ', (fee) => {
          const feeValue = parseInt(fee);
          if (!isNaN(feeValue) && feeValue > 0) {
            config.feeLevels.medium = feeValue;
          }
          fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
          navigateTo(MENU_STATE.CONFIG, 'Configuration');
        });
        break;
      case '7c':
        rl.question('Enter new High fee (recommended: 15000-25000): ', (fee) => {
          const feeValue = parseInt(fee);
          if (!isNaN(feeValue) && feeValue > 0) {
            config.feeLevels.high = feeValue;
          }
          fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
          navigateTo(MENU_STATE.CONFIG, 'Configuration');
        });
        break;
      case '7d':
        rl.question('Enter new Urgent fee (recommended: 30000-50000): ', (fee) => {
          const feeValue = parseInt(fee);
          if (!isNaN(feeValue) && feeValue > 0) {
            config.feeLevels.urgent = feeValue;
          }
          fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
          navigateTo(MENU_STATE.CONFIG, 'Configuration');
        });
        break;
      case '7e':
        rl.question('Enter custom fee value: ', (fee) => {
          const feeValue = parseInt(fee);
          if (!isNaN(feeValue) && feeValue >= 0) {
            config.feeLevels.custom = feeValue;
          }
          fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
          navigateTo(MENU_STATE.CONFIG, 'Configuration');
        });
        break;
      case '7f':
        rl.question('Enable dynamic fee (on/off): ', (dynamicFee) => {
          config.dynamicFee = dynamicFee.toLowerCase() === 'on';
          fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
          navigateTo(MENU_STATE.CONFIG, 'Configuration');
        });
        break;
      case '7g':
        rl.question('Enter priority fee multiplier (0.5-5.0): ', (multiplier) => {
          const value = parseFloat(multiplier);
          if (!isNaN(value) && value > 0) {
            config.priorityFeeMultiplier = value;
          }
          fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
          navigateTo(MENU_STATE.CONFIG, 'Configuration');
        });
        break;
      case '8':
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

// Start the program
main().catch(console.error);
