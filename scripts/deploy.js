const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");

  // Base Sepolia testnet USDC address (Circle)
  // https://developers.circle.com/stablecoins/usdc-on-test-networks
  const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

  const MoltBond = await ethers.getContractFactory("MoltBond");
  const moltBond = await MoltBond.deploy(USDC_BASE_SEPOLIA);
  await moltBond.waitForDeployment();

  const address = await moltBond.getAddress();
  console.log("MoltBond deployed to:", address);
  console.log("\nVerify on BaseScan:");
  console.log(`npx hardhat verify --network baseSepolia ${address} ${USDC_BASE_SEPOLIA}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
