const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("MoltBond", function () {
  let moltBond, usdc;
  let deployer, alice, bob, charlie;
  const USDC = (n) => ethers.parseUnits(n.toString(), 6);

  beforeEach(async function () {
    [deployer, alice, bob, charlie] = await ethers.getSigners();

    // Deploy MockUSDC
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    usdc = await MockUSDC.deploy();

    // Deploy MoltBond
    const MoltBond = await ethers.getContractFactory("MoltBond");
    moltBond = await MoltBond.deploy(await usdc.getAddress());

    // Mint USDC to agents
    await usdc.mint(alice.address, USDC(10000));
    await usdc.mint(bob.address, USDC(10000));
    await usdc.mint(charlie.address, USDC(10000));

    // Approve MoltBond
    const bondAddr = await moltBond.getAddress();
    await usdc.connect(alice).approve(bondAddr, ethers.MaxUint256);
    await usdc.connect(bob).approve(bondAddr, ethers.MaxUint256);
    await usdc.connect(charlie).approve(bondAddr, ethers.MaxUint256);
  });

  describe("Agent Registration", function () {
    it("should register an agent", async function () {
      await moltBond.connect(alice).registerAgent("Alice");
      const agent = await moltBond.agents(alice.address);
      expect(agent.name).to.equal("Alice");
      expect(agent.exists).to.be.true;
    });

    it("should reject duplicate registration", async function () {
      await moltBond.connect(alice).registerAgent("Alice");
      await expect(
        moltBond.connect(alice).registerAgent("Alice2")
      ).to.be.revertedWith("Already registered");
    });

    it("should reject empty name", async function () {
      await expect(
        moltBond.connect(alice).registerAgent("")
      ).to.be.revertedWith("Invalid name length");
    });

    it("should track agent count", async function () {
      await moltBond.connect(alice).registerAgent("Alice");
      await moltBond.connect(bob).registerAgent("Bob");
      expect(await moltBond.getAgentCount()).to.equal(2);
    });
  });

  describe("Staking", function () {
    beforeEach(async function () {
      await moltBond.connect(alice).registerAgent("Alice");
    });

    it("should allow staking USDC", async function () {
      await moltBond.connect(alice).stake(USDC(100));
      const agent = await moltBond.agents(alice.address);
      expect(agent.staked).to.equal(USDC(100));
    });

    it("should reject stake below minimum", async function () {
      await expect(
        moltBond.connect(alice).stake(USDC(0.5))
      ).to.be.revertedWith("Below minimum stake");
    });

    it("should reject unregistered agent", async function () {
      await expect(
        moltBond.connect(charlie).stake(USDC(100))
      ).to.be.revertedWith("Not registered");
    });

    it("should allow multiple stakes", async function () {
      await moltBond.connect(alice).stake(USDC(50));
      await moltBond.connect(alice).stake(USDC(50));
      const agent = await moltBond.agents(alice.address);
      expect(agent.staked).to.equal(USDC(100));
    });
  });

  describe("Unstaking", function () {
    beforeEach(async function () {
      await moltBond.connect(alice).registerAgent("Alice");
      await moltBond.connect(alice).stake(USDC(100));
    });

    it("should enforce cooldown period", async function () {
      await moltBond.connect(alice).requestUnstake();
      await expect(
        moltBond.connect(alice).unstake(USDC(50))
      ).to.be.revertedWith("Cooldown not elapsed");
    });

    it("should allow unstake after cooldown", async function () {
      await moltBond.connect(alice).requestUnstake();
      await time.increase(86400); // 1 day
      await moltBond.connect(alice).unstake(USDC(50));
      const agent = await moltBond.agents(alice.address);
      expect(agent.staked).to.equal(USDC(50));
    });

    it("should return USDC on unstake", async function () {
      const balBefore = await usdc.balanceOf(alice.address);
      await moltBond.connect(alice).requestUnstake();
      await time.increase(86400);
      await moltBond.connect(alice).unstake(USDC(100));
      const balAfter = await usdc.balanceOf(alice.address);
      expect(balAfter - balBefore).to.equal(USDC(100));
    });

    it("should reject unstake without request", async function () {
      await expect(
        moltBond.connect(alice).unstake(USDC(50))
      ).to.be.revertedWith("No unstake requested");
    });
  });

  describe("Escrow Deals", function () {
    beforeEach(async function () {
      await moltBond.connect(alice).registerAgent("Alice");
      await moltBond.connect(bob).registerAgent("Bob");
      await moltBond.connect(alice).stake(USDC(100));
      await moltBond.connect(bob).stake(USDC(100));
    });

    it("should create a deal", async function () {
      await moltBond.connect(alice).createDeal(bob.address, USDC(50), "Build a bot", 0);
      expect(await moltBond.getDealCount()).to.equal(1);
      const deal = await moltBond.deals(0);
      expect(deal.creator).to.equal(alice.address);
      expect(deal.counterparty).to.equal(bob.address);
      expect(deal.amount).to.equal(USDC(50));
    });

    it("should escrow USDC from creator", async function () {
      const balBefore = await usdc.balanceOf(alice.address);
      await moltBond.connect(alice).createDeal(bob.address, USDC(50), "Task", 0);
      const balAfter = await usdc.balanceOf(alice.address);
      expect(balBefore - balAfter).to.equal(USDC(50));
    });

    it("should reject self-deals", async function () {
      await expect(
        moltBond.connect(alice).createDeal(alice.address, USDC(50), "Self", 0)
      ).to.be.revertedWith("Cannot deal with self");
    });

    it("should complete deal with dual confirmation", async function () {
      await moltBond.connect(alice).createDeal(bob.address, USDC(50), "Task", 0);

      await moltBond.connect(alice).confirmDeal(0);
      let deal = await moltBond.deals(0);
      expect(deal.status).to.equal(0); // Still Active

      const bobBalBefore = await usdc.balanceOf(bob.address);
      await moltBond.connect(bob).confirmDeal(0);
      deal = await moltBond.deals(0);
      expect(deal.status).to.equal(1); // Completed

      const bobBalAfter = await usdc.balanceOf(bob.address);
      expect(bobBalAfter - bobBalBefore).to.equal(USDC(50));
    });

    it("should update stats on completion", async function () {
      await moltBond.connect(alice).createDeal(bob.address, USDC(50), "Task", 0);
      await moltBond.connect(alice).confirmDeal(0);
      await moltBond.connect(bob).confirmDeal(0);

      const aliceAgent = await moltBond.agents(alice.address);
      const bobAgent = await moltBond.agents(bob.address);
      expect(aliceAgent.dealsCompleted).to.equal(1);
      expect(bobAgent.dealsCompleted).to.equal(1);
      expect(aliceAgent.totalVolume).to.equal(USDC(50));
    });
  });

  describe("Disputes", function () {
    beforeEach(async function () {
      await moltBond.connect(alice).registerAgent("Alice");
      await moltBond.connect(bob).registerAgent("Bob");
      await moltBond.connect(alice).stake(USDC(100));
      await moltBond.connect(bob).stake(USDC(100));
      await moltBond.connect(alice).createDeal(bob.address, USDC(50), "Task", 0);
    });

    it("should allow creator to dispute", async function () {
      await moltBond.connect(alice).disputeDeal(0);
      const deal = await moltBond.deals(0);
      expect(deal.status).to.equal(2); // Disputed
    });

    it("should return escrowed funds to creator on dispute", async function () {
      const balBefore = await usdc.balanceOf(alice.address);
      await moltBond.connect(alice).disputeDeal(0);
      const balAfter = await usdc.balanceOf(alice.address);
      // Gets back 50 USDC escrow + 10 USDC slash (10% of bob's 100 stake)
      expect(balAfter - balBefore).to.equal(USDC(60));
    });

    it("should slash counterparty stake on creator dispute", async function () {
      await moltBond.connect(alice).disputeDeal(0);
      const bobAgent = await moltBond.agents(bob.address);
      expect(bobAgent.staked).to.equal(USDC(90)); // 100 - 10% slash
      expect(bobAgent.dealsFailed).to.equal(1);
    });

    it("should slash creator stake on counterparty dispute", async function () {
      await moltBond.connect(bob).disputeDeal(0);
      const aliceAgent = await moltBond.agents(alice.address);
      expect(aliceAgent.staked).to.equal(USDC(90)); // 100 - 10% slash
    });
  });

  describe("Expiry", function () {
    beforeEach(async function () {
      await moltBond.connect(alice).registerAgent("Alice");
      await moltBond.connect(bob).registerAgent("Bob");
      await moltBond.connect(alice).stake(USDC(100));
      await moltBond.connect(bob).stake(USDC(100));
    });

    it("should allow cancelling expired deals", async function () {
      await moltBond.connect(alice).createDeal(bob.address, USDC(50), "Task", 0);
      await time.increase(7 * 86400 + 1); // 7 days + 1 second
      await moltBond.connect(charlie).cancelExpiredDeal(0);
      const deal = await moltBond.deals(0);
      expect(deal.status).to.equal(4); // Expired
    });

    it("should return funds on expiry", async function () {
      const balBefore = await usdc.balanceOf(alice.address);
      await moltBond.connect(alice).createDeal(bob.address, USDC(50), "Task", 0);
      await time.increase(7 * 86400 + 1);
      await moltBond.cancelExpiredDeal(0);
      const balAfter = await usdc.balanceOf(alice.address);
      expect(balAfter).to.equal(balBefore);
    });

    it("should reject early cancellation", async function () {
      await moltBond.connect(alice).createDeal(bob.address, USDC(50), "Task", 0);
      await expect(moltBond.cancelExpiredDeal(0)).to.be.revertedWith("Deal not expired");
    });
  });

  describe("Reputation", function () {
    it("should return 0 for unregistered", async function () {
      expect(await moltBond.getReputation(charlie.address)).to.equal(0);
    });

    it("should give stake-based rep for new agents", async function () {
      await moltBond.connect(alice).registerAgent("Alice");
      await moltBond.connect(alice).stake(USDC(10));
      // 10 USDC * 10pts = 100, capped at 200
      expect(await moltBond.getReputation(alice.address)).to.equal(100);
    });

    it("should give combined rep after deals", async function () {
      await moltBond.connect(alice).registerAgent("Alice");
      await moltBond.connect(bob).registerAgent("Bob");
      await moltBond.connect(alice).stake(USDC(10));
      await moltBond.connect(bob).stake(USDC(10));

      await moltBond.connect(alice).createDeal(bob.address, USDC(50), "Task", 0);
      await moltBond.connect(alice).confirmDeal(0);
      await moltBond.connect(bob).confirmDeal(0);

      const rep = await moltBond.getReputation(alice.address);
      // completion: 500 (1/1 = 100%), volume: 0 (50 < 100 threshold), stake: 100
      expect(rep).to.equal(600);
    });
  });
});
