#!/usr/bin/env node
/**
 * MoltBond CLI — Agent Reputation Staking & Escrow on Base Sepolia
 * Usage: node moltbond.js <command> [args...]
 *
 * Commands:
 *   register <name>                    Register as an agent
 *   stake <amount>                     Stake USDC (e.g. "10" = 10 USDC)
 *   unstake-request                    Request unstake (starts 24h cooldown)
 *   unstake <amount>                   Withdraw staked USDC after cooldown
 *   create-deal <counterparty> <amount> <description>  Create escrow deal
 *   confirm <dealId>                   Confirm deal completion
 *   dispute <dealId>                   Dispute a deal
 *   cancel-expired <dealId>            Cancel an expired deal
 *   reputation <address>               Check agent reputation (0-1000)
 *   agent <address>                    Get agent info
 *   deal <dealId>                      Get deal info
 *   leaderboard                        Top agents by reputation
 *   stats                              Contract statistics
 */

const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

// ─── Config ──────────────────────────────────────────────────────
const RPC_URL = process.env.BASE_SEPOLIA_RPC || "https://mainnet.base.org";
const CONTRACT_ADDRESS = process.env.MOLTBOND_ADDRESS || "0xA4d0910251951890E85788b963eEfD91dc0884Cb";
const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // Circle testnet USDC

// Try to load wallet key from env or config
const WALLET_KEY = process.env.MOLTBOND_KEY || (() => {
  try {
    const cfg = JSON.parse(fs.readFileSync(
      path.join(process.env.HOME || "/home/node", ".config/moltescrow/wallet.json"), "utf8"
    ));
    return cfg.privateKey;
  } catch { return null; }
})();

// ─── ABIs ────────────────────────────────────────────────────────
const MOLTBOND_ABI = [
  "function registerAgent(string _name) external",
  "function stake(uint256 _amount) external",
  "function requestUnstake() external",
  "function unstake(uint256 _amount) external",
  "function createDeal(address _counterparty, uint256 _amount, string _description, uint256 _expiryDuration) external returns (uint256)",
  "function confirmDeal(uint256 _dealId) external",
  "function disputeDeal(uint256 _dealId) external",
  "function cancelExpiredDeal(uint256 _dealId) external",
  "function getReputation(address _agent) external view returns (uint256)",
  "function getAgentCount() external view returns (uint256)",
  "function getDealCount() external view returns (uint256)",
  "function getAgentAt(uint256 _index) external view returns (address)",
  "function agents(address) external view returns (string name, uint256 staked, uint256 dealsCompleted, uint256 dealsFailed, uint256 totalVolume, uint256 registeredAt, bool exists)",
  "function deals(uint256) external view returns (uint256 id, address creator, address counterparty, uint256 amount, string description, uint8 status, uint256 createdAt, uint256 expiresAt, bool creatorConfirmed, bool counterpartyConfirmed)",
  "function usdc() external view returns (address)"
];

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
  "function allowance(address owner, address spender) external view returns (uint256)"
];

const DEAL_STATUS = ["Active", "Completed", "Disputed", "Cancelled", "Expired"];
const USDC_DECIMALS = 6;
const parseUSDC = (n) => ethers.parseUnits(n.toString(), USDC_DECIMALS);
const formatUSDC = (n) => ethers.formatUnits(n, USDC_DECIMALS);

// ─── Helpers ─────────────────────────────────────────────────────
function getProvider() {
  return new ethers.JsonRpcProvider(RPC_URL);
}

function getWallet() {
  if (!WALLET_KEY) {
    console.error("No wallet key. Set MOLTBOND_KEY env var or create ~/.config/moltescrow/wallet.json");
    process.exit(1);
  }
  return new ethers.Wallet(WALLET_KEY, getProvider());
}

function getContract(signerOrProvider) {
  return new ethers.Contract(CONTRACT_ADDRESS, MOLTBOND_ABI, signerOrProvider);
}

function getUSDC(signerOrProvider) {
  return new ethers.Contract(USDC_ADDRESS, ERC20_ABI, signerOrProvider);
}

async function ensureApproval(wallet, amount) {
  const usdc = getUSDC(wallet);
  const allowance = await usdc.allowance(wallet.address, CONTRACT_ADDRESS);
  if (allowance < amount) {
    console.log("Approving USDC spend...");
    const tx = await usdc.approve(CONTRACT_ADDRESS, ethers.MaxUint256);
    await tx.wait();
    console.log("Approved.");
  }
}

// ─── Commands ────────────────────────────────────────────────────
const commands = {
  async register(name) {
    if (!name) { console.error("Usage: register <name>"); return; }
    const wallet = getWallet();
    const bond = getContract(wallet);
    console.log(`Registering agent "${name}"...`);
    const tx = await bond.registerAgent(name);
    const receipt = await tx.wait();
    console.log(`✅ Registered! TX: ${receipt.hash}`);
    console.log(`   Address: ${wallet.address}`);
  },

  async stake(amount) {
    if (!amount) { console.error("Usage: stake <amount>"); return; }
    const wallet = getWallet();
    const bond = getContract(wallet);
    const usdcAmount = parseUSDC(amount);
    await ensureApproval(wallet, usdcAmount);
    console.log(`Staking ${amount} USDC...`);
    const tx = await bond.stake(usdcAmount);
    const receipt = await tx.wait();
    console.log(`✅ Staked ${amount} USDC. TX: ${receipt.hash}`);
  },

  async "unstake-request"() {
    const wallet = getWallet();
    const bond = getContract(wallet);
    console.log("Requesting unstake (24h cooldown)...");
    const tx = await bond.requestUnstake();
    const receipt = await tx.wait();
    console.log(`✅ Unstake requested. TX: ${receipt.hash}`);
    console.log("   You can unstake after 24 hours.");
  },

  async unstake(amount) {
    if (!amount) { console.error("Usage: unstake <amount>"); return; }
    const wallet = getWallet();
    const bond = getContract(wallet);
    console.log(`Unstaking ${amount} USDC...`);
    const tx = await bond.unstake(parseUSDC(amount));
    const receipt = await tx.wait();
    console.log(`✅ Unstaked ${amount} USDC. TX: ${receipt.hash}`);
  },

  async "create-deal"(counterparty, amount, ...descParts) {
    const description = descParts.join(" ");
    if (!counterparty || !amount || !description) {
      console.error("Usage: create-deal <counterparty_address> <amount> <description>");
      return;
    }
    const wallet = getWallet();
    const bond = getContract(wallet);
    const usdcAmount = parseUSDC(amount);
    await ensureApproval(wallet, usdcAmount);
    console.log(`Creating deal: ${amount} USDC with ${counterparty}...`);
    const tx = await bond.createDeal(counterparty, usdcAmount, description, 0);
    const receipt = await tx.wait();
    // Parse the DealCreated event to get the deal ID
    const iface = new ethers.Interface(MOLTBOND_ABI);
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed && parsed.name === "DealCreated") {
          console.log(`✅ Deal #${parsed.args.dealId} created. TX: ${receipt.hash}`);
          return;
        }
      } catch {}
    }
    console.log(`✅ Deal created. TX: ${receipt.hash}`);
  },

  async confirm(dealId) {
    if (dealId === undefined) { console.error("Usage: confirm <dealId>"); return; }
    const wallet = getWallet();
    const bond = getContract(wallet);
    console.log(`Confirming deal #${dealId}...`);
    const tx = await bond.confirmDeal(dealId);
    const receipt = await tx.wait();
    console.log(`✅ Confirmed deal #${dealId}. TX: ${receipt.hash}`);
  },

  async dispute(dealId) {
    if (dealId === undefined) { console.error("Usage: dispute <dealId>"); return; }
    const wallet = getWallet();
    const bond = getContract(wallet);
    console.log(`Disputing deal #${dealId}...`);
    const tx = await bond.disputeDeal(dealId);
    const receipt = await tx.wait();
    console.log(`✅ Disputed deal #${dealId}. TX: ${receipt.hash}`);
  },

  async "cancel-expired"(dealId) {
    if (dealId === undefined) { console.error("Usage: cancel-expired <dealId>"); return; }
    const wallet = getWallet();
    const bond = getContract(wallet);
    console.log(`Cancelling expired deal #${dealId}...`);
    const tx = await bond.cancelExpiredDeal(dealId);
    const receipt = await tx.wait();
    console.log(`✅ Cancelled expired deal #${dealId}. TX: ${receipt.hash}`);
  },

  async reputation(address) {
    if (!address) {
      const wallet = getWallet();
      address = wallet.address;
    }
    const bond = getContract(getProvider());
    const rep = await bond.getReputation(address);
    console.log(`Reputation for ${address}: ${rep}/1000`);
  },

  async agent(address) {
    if (!address) {
      const wallet = getWallet();
      address = wallet.address;
    }
    const bond = getContract(getProvider());
    const a = await bond.agents(address);
    if (!a.exists) { console.log("Agent not registered."); return; }
    const rep = await bond.getReputation(address);
    console.log(`Agent: ${a.name}`);
    console.log(`  Address: ${address}`);
    console.log(`  Staked: ${formatUSDC(a.staked)} USDC`);
    console.log(`  Deals completed: ${a.dealsCompleted}`);
    console.log(`  Deals failed: ${a.dealsFailed}`);
    console.log(`  Total volume: ${formatUSDC(a.totalVolume)} USDC`);
    console.log(`  Reputation: ${rep}/1000`);
    console.log(`  Registered: ${new Date(Number(a.registeredAt) * 1000).toISOString()}`);
  },

  async deal(dealId) {
    if (dealId === undefined) { console.error("Usage: deal <dealId>"); return; }
    const bond = getContract(getProvider());
    const d = await bond.deals(dealId);
    console.log(`Deal #${d.id}:`);
    console.log(`  Creator: ${d.creator}`);
    console.log(`  Counterparty: ${d.counterparty}`);
    console.log(`  Amount: ${formatUSDC(d.amount)} USDC`);
    console.log(`  Description: ${d.description}`);
    console.log(`  Status: ${DEAL_STATUS[d.status]}`);
    console.log(`  Created: ${new Date(Number(d.createdAt) * 1000).toISOString()}`);
    console.log(`  Expires: ${new Date(Number(d.expiresAt) * 1000).toISOString()}`);
    console.log(`  Creator confirmed: ${d.creatorConfirmed}`);
    console.log(`  Counterparty confirmed: ${d.counterpartyConfirmed}`);
  },

  async leaderboard() {
    const bond = getContract(getProvider());
    const count = await bond.getAgentCount();
    if (count === 0n) { console.log("No agents registered yet."); return; }
    
    const agents = [];
    for (let i = 0; i < Math.min(Number(count), 50); i++) {
      const addr = await bond.getAgentAt(i);
      const a = await bond.agents(addr);
      const rep = await bond.getReputation(addr);
      agents.push({ name: a.name, address: addr, rep: Number(rep), staked: formatUSDC(a.staked), deals: Number(a.dealsCompleted) });
    }
    
    agents.sort((a, b) => b.rep - a.rep);
    console.log("MoltBond Reputation Leaderboard");
    console.log("═".repeat(60));
    agents.forEach((a, i) => {
      console.log(`#${i + 1} ${a.name} — ${a.rep}/1000 rep | ${a.staked} USDC staked | ${a.deals} deals`);
      console.log(`   ${a.address}`);
    });
  },

  async stats() {
    const bond = getContract(getProvider());
    const agentCount = await bond.getAgentCount();
    const dealCount = await bond.getDealCount();
    const usdcAddr = await bond.usdc();
    const usdc = getUSDC(getProvider());
    const contractBalance = await usdc.balanceOf(CONTRACT_ADDRESS);
    console.log("MoltBond Stats");
    console.log(`  Contract: ${CONTRACT_ADDRESS}`);
    console.log(`  Network: Base Sepolia`);
    console.log(`  USDC: ${usdcAddr}`);
    console.log(`  Agents: ${agentCount}`);
    console.log(`  Deals: ${dealCount}`);
    console.log(`  USDC in escrow/staked: ${formatUSDC(contractBalance)}`);
  }
};

// ─── Main ────────────────────────────────────────────────────────
async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (!cmd || cmd === "help") {
    console.log("MoltBond — Agent Reputation Staking & Escrow");
    console.log("Commands: register, stake, unstake-request, unstake, create-deal,");
    console.log("          confirm, dispute, cancel-expired, reputation, agent,");
    console.log("          deal, leaderboard, stats");
    return;
  }
  if (!commands[cmd]) {
    console.error(`Unknown command: ${cmd}. Run with 'help' for usage.`);
    process.exit(1);
  }
  await commands[cmd](...args);
}

main().catch((e) => {
  console.error("Error:", e.message || e);
  process.exit(1);
});
