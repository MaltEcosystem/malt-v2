import { expect } from "chai";
import { ethers, waffle } from "hardhat";
import { Signer } from "ethers";
import { MaltDataLab } from "../type/MaltDataLab";
import { StabilizerNode } from "../type/StabilizerNode";
import { Auction } from "../type/Auction";
import { PoolTransferVerification } from "../type/PoolTransferVerification";
import { ContractFactory, constants, utils, Contract, BigNumber } from 'ethers';
import { hardhatSnapshot, hardhatRevert, increaseTime } from "./helpers";
import IERC20 from "../artifacts/@openzeppelin/contracts/token/ERC20/IERC20.sol/IERC20.json";
import MaltArtifacts from "../artifacts/contracts/Malt.sol/Malt.json";

const { deployMockContract } = waffle;

describe("Transfer Verification", function() {
  let accounts: Signer[];
  let owner: Signer;
  let admin: Signer;
  let pool: Signer;

  let verifier: PoolTransferVerification;
  let snapshotId: string;

  let mockDataLab: MaltDataLab;
  let mockStabilizerNode: StabilizerNode;
  let mockAuction: Auction;

  let thresholdBps = 200; // 2%
  let lookbackAbove = 60 * 10; // 10 minutes
  let lookbackBelow = 30; // 30 seconds
  let priceTarget = utils.parseEther('1');

  beforeEach(async function() {
    snapshotId = await hardhatSnapshot();
    [owner, admin, pool, ...accounts] = await ethers.getSigners();

    const ownerAddress = await owner.getAddress();
    const adminAddress = await admin.getAddress();
    const poolAddress = await pool.getAddress();

    mockDataLab = ((await deployMockContract(owner, [
      "function priceTarget() returns(uint256)",
      "function maltPriceAverage(uint256) returns(uint256)",
    ])) as any) as MaltDataLab;
    mockStabilizerNode = ((await deployMockContract(owner, [
      "function stabilize()",
    ])) as any) as StabilizerNode;
    mockAuction = ((await deployMockContract(owner, [
      "function hasOngoingAuction() returns(bool)",
    ])) as any) as Auction;
    await mockDataLab.mock.priceTarget.returns(priceTarget);
    // await mockStabilizerNode.mock.stabilize.returns();

    // Deploy the PoolTransferVerification
    const PoolTransferVerificationFactory = await ethers.getContractFactory("PoolTransferVerification");

    verifier = (await PoolTransferVerificationFactory.deploy(
      ownerAddress,
      adminAddress,
      thresholdBps,
      thresholdBps,
      mockDataLab.address,
      lookbackAbove,
      lookbackBelow,
      poolAddress,
      mockStabilizerNode.address,
      mockAuction.address
    )) as PoolTransferVerification;

    expect(await verifier.paused()).to.equal(true);
    await verifier.togglePause();
    expect(await verifier.paused()).to.equal(false);
    await verifier.toggleKillswitch();
  });

  afterEach(async function() {
    await hardhatRevert(snapshotId);
  });

  it("Has correct initial conditions", async function() {
    const poolAddress = await pool.getAddress();

    expect(await verifier.upperThresholdBps()).to.equal(thresholdBps);
    expect(await verifier.lowerThresholdBps()).to.equal(thresholdBps);
    expect(await verifier.maltDataLab()).to.equal(mockDataLab.address);
    expect(await verifier.priceLookbackAbove()).to.equal(lookbackAbove);
    expect(await verifier.priceLookbackBelow()).to.equal(lookbackBelow);
    expect(await verifier.pool()).to.equal(poolAddress);
    expect(await verifier.paused()).to.equal(false);
  });

  it("Only allows admin to add an address to the whitelist", async function() {
    const [user, user1, user2] = accounts;
    const userAddress = await user.getAddress();
    const userOneAddress = await user1.getAddress();
    const userTwoAddress = await user2.getAddress();

    await expect(verifier.connect(user).addToWhitelist(userAddress)).to.be.reverted;
    await expect(verifier.connect(user1).addToWhitelist(userAddress)).to.be.reverted;

    expect(await verifier.isWhitelisted(userAddress)).to.equal(false);
    expect(await verifier.isWhitelisted(userOneAddress)).to.equal(false);
    expect(await verifier.isWhitelisted(userTwoAddress)).to.equal(false);

    await verifier.connect(admin).addToWhitelist(userAddress);
    // owner is timelock for these tests
    await verifier.addToWhitelist(userOneAddress);

    expect(await verifier.isWhitelisted(userAddress)).to.equal(true);
    expect(await verifier.isWhitelisted(userOneAddress)).to.equal(true);
    expect(await verifier.isWhitelisted(userTwoAddress)).to.equal(false);
  });

  it("Only allows admin to remove an address from the whitelist", async function() {
    const [user, user1, user2] = accounts;
    const userAddress = await user.getAddress();
    const userOneAddress = await user1.getAddress();
    const userTwoAddress = await user2.getAddress();

    await verifier.connect(admin).addToWhitelist(userAddress);
    // owner is timelock for these tests
    await verifier.addToWhitelist(userOneAddress);

    expect(await verifier.isWhitelisted(userAddress)).to.equal(true);
    expect(await verifier.isWhitelisted(userOneAddress)).to.equal(true);

    await expect(verifier.connect(user).removeFromWhitelist(userAddress)).to.be.reverted;
    await expect(verifier.connect(user1).removeFromWhitelist(userAddress)).to.be.reverted;

    expect(await verifier.isWhitelisted(userAddress)).to.equal(true);
    expect(await verifier.isWhitelisted(userOneAddress)).to.equal(true);

    await verifier.connect(admin).removeFromWhitelist(userAddress);
    // owner is timelock for these tests
    await verifier.removeFromWhitelist(userOneAddress);

    expect(await verifier.isWhitelisted(userAddress)).to.equal(false);
    expect(await verifier.isWhitelisted(userOneAddress)).to.equal(false);
  });

  it("Always returns true when from address is not the pool", async function() {
    const [user1, user2] = accounts;
    const userOneAddress = await user1.getAddress();
    const userTwoAddress = await user2.getAddress();
    const amount = utils.parseEther('2307');

    const [successOne, stringOne] = await verifier.verifyTransfer(userOneAddress, userTwoAddress, amount);
    const [successTwo, stringTwo] = await verifier.verifyTransfer(userOneAddress, userTwoAddress, amount);
    expect(successOne).to.equal(true);
    expect(stringOne).to.equal("");
    expect(successTwo).to.equal(true);
    expect(stringTwo).to.equal("");
  });

  it("Always returns true on pool transfers when at peg", async function() {
    await mockDataLab.mock.maltPriceAverage.returns(utils.parseEther('1'));
    const poolAddress = await pool.getAddress();
    const [user1, user2] = accounts;
    const userOneAddress = await user1.getAddress();
    const userTwoAddress = await user2.getAddress();
    const amount = utils.parseEther('2307');

    await mockAuction.mock.hasOngoingAuction.returns(false);

    const [successOne] = await verifier.verifyTransfer(poolAddress, userOneAddress, amount);
    const [successTwo] = await verifier.verifyTransfer(poolAddress, userTwoAddress, amount);
    expect(successOne).to.equal(true);
    expect(successTwo).to.equal(true);
  });

  it("Returns false for non-whitelisted transfers from pool when under peg", async function() {
    await mockDataLab.mock.maltPriceAverage.returns(utils.parseEther('0.5'));
    const poolAddress = await pool.getAddress();
    const [user1, user2] = accounts;
    const userOneAddress = await user1.getAddress();
    const userTwoAddress = await user2.getAddress();
    const amount = utils.parseEther('2307');

    await mockAuction.mock.hasOngoingAuction.returns(false);

    const [successOne, stringOne] = await verifier.verifyTransfer(poolAddress, userOneAddress, amount);
    const [successTwo, stringTwo] = await verifier.verifyTransfer(poolAddress, userTwoAddress, amount);
    expect(successOne).to.equal(false);
    expect(stringOne).to.equal("Malt: BELOW PEG");
    expect(successTwo).to.equal(false);
    expect(stringTwo).to.equal("Malt: BELOW PEG");
  });

  it("Allows whitelisted address to transfer under peg", async function() {
    await mockDataLab.mock.maltPriceAverage.returns(utils.parseEther('0.5'));
    const poolAddress = await pool.getAddress();
    const [user1, user2] = accounts;
    const userOneAddress = await user1.getAddress();
    const userTwoAddress = await user2.getAddress();
    const amount = utils.parseEther('2307');

    await mockAuction.mock.hasOngoingAuction.returns(false);

    await verifier.connect(admin).addToWhitelist(userOneAddress);

    const [successOne] = await verifier.verifyTransfer(poolAddress, userOneAddress, amount);
    const [successTwo] = await verifier.verifyTransfer(poolAddress, userTwoAddress, amount);
    expect(successOne).to.equal(true);
    expect(successTwo).to.equal(false);
  });

  it("It only allows admins to update price lookback period", async function() {
    expect(await verifier.priceLookbackAbove()).to.equal(lookbackAbove);
    expect(await verifier.priceLookbackBelow()).to.equal(lookbackBelow);

    const [user, user1] = accounts;

    await expect(verifier.connect(user).setPriceLookback(10, 88)).to.be.reverted;
    await expect(verifier.connect(user1).setPriceLookback(10, 88)).to.be.reverted;

    const newLookbackAbove = 356;
    const newLookbackBelow = 838;
    await verifier.connect(admin).setPriceLookback(newLookbackAbove, newLookbackBelow);
    expect(await verifier.priceLookbackAbove()).to.equal(newLookbackAbove);
    expect(await verifier.priceLookbackBelow()).to.equal(newLookbackBelow);

    // Default signer has the Timelock role
    await verifier.setPriceLookback(422, 392);
    expect(await verifier.priceLookbackAbove()).to.equal(422);
    expect(await verifier.priceLookbackBelow()).to.equal(392);
  });

  it("It only allows admins to update price threshold", async function() {
    expect(await verifier.upperThresholdBps()).to.equal(thresholdBps);
    expect(await verifier.lowerThresholdBps()).to.equal(thresholdBps);

    const [user, user1] = accounts;

    await expect(verifier.connect(user).setThresholds(10, 5)).to.be.reverted;
    await expect(verifier.connect(user1).setThresholds(10, 5)).to.be.reverted;

    const newUpperThreshold = 356;
    const newLowerThreshold = 323;
    await verifier.connect(admin).setThresholds(newUpperThreshold, newLowerThreshold);
    expect(await verifier.upperThresholdBps()).to.equal(newUpperThreshold);
    expect(await verifier.lowerThresholdBps()).to.equal(newLowerThreshold);

    // Default signer has the Timelock role
    await verifier.setThresholds(422, 28);
    expect(await verifier.upperThresholdBps()).to.equal(422);
    expect(await verifier.lowerThresholdBps()).to.equal(28);
  });

  it("Only allows admin to set pool", async function() {
    const [newContract, newContract2, user, user2] = accounts;
    const newAddress = await newContract.getAddress();
    const new2Address = await newContract2.getAddress();

    await expect(verifier.connect(user).setPool(newAddress)).to.be.reverted;
    await expect(verifier.connect(user2).setPool(newAddress)).to.be.reverted;

    await verifier.connect(admin).setPool(newAddress);
    expect(await verifier.pool()).to.equal(newAddress);

    await verifier.setPool(new2Address);
    expect(await verifier.pool()).to.equal(new2Address);
  });
});
