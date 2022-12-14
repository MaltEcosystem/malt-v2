import { expect } from "chai";
import { ethers, waffle } from "hardhat";
import { Signer } from "ethers";
import { RewardDistributor } from "../type/RewardDistributor";
import { Bonding } from "../type/Bonding";
import { Malt } from "../type/Malt";
import { ERC20VestedMine } from "../type/ERC20VestedMine";
import { TransferService } from "../type/TransferService";
import { ERC20 } from "../type/ERC20";
import { ContractFactory, constants, utils, Contract, BigNumber } from 'ethers';
import { hardhatSnapshot, hardhatRevert, increaseTime } from "./helpers";
import IERC20 from "../artifacts/@openzeppelin/contracts/token/ERC20/IERC20.sol/IERC20.json";
import MaltArtifacts from "../artifacts/contracts/Malt.sol/Malt.json";
import BondingArtifacts from "../artifacts/contracts/Bonding.sol/Bonding.json";

const { deployMockContract } = waffle;

describe("Reward Distributor", function() {
  let accounts: Signer[];
  let owner: Signer;
  let admin: Signer;
  let throttler: Signer;
  let rewardMineSigner: Signer;

  let rewardDistributor: RewardDistributor;
  let dai: ERC20;
  let snapshotId: string;

  let mockForfeitor: any;
  let mockBonding: Bonding;
  let mockTransferService: TransferService;
  let mockRewardMine: ERC20VestedMine;
  const focalLength = 172800;

  beforeEach(async function() {
    snapshotId = await hardhatSnapshot();
    [owner, admin, throttler, rewardMineSigner, ...accounts] = await ethers.getSigners();

    const ownerAddress = await owner.getAddress();
    const adminAddress = await admin.getAddress();
    const throttlerAddress = await throttler.getAddress();

    mockTransferService = ((await deployMockContract(owner, [
      "function verifyTransferAndCall(address, address, uint256) returns (bool, string memory)"
    ])) as any) as TransferService;
    await mockTransferService.mock.verifyTransferAndCall.returns(true, "");
    mockRewardMine = ((await deployMockContract(owner, [
      "function totalReleasedReward() returns (uint256)",
      "function declareReward(uint256)",
      "function releaseReward(uint256)"
    ])) as any) as ERC20VestedMine;
    await mockRewardMine.mock.totalReleasedReward.returns(0);
    await mockRewardMine.mock.declareReward.returns();
    await mockRewardMine.mock.releaseReward.returns();

    const ERC20Factory = await ethers.getContractFactory("Malt");

    // Deploy ERC20 tokens
    dai = (await ERC20Factory.deploy(
      "Dai Stablecoin",
      "DAI",
      ownerAddress,
      adminAddress,
      mockTransferService.address,
    )) as Malt;
    await dai.deployed();
    await dai.initialSupplyControlSetup([ownerAddress], []);

    mockBonding = ((await deployMockContract(owner, BondingArtifacts.abi)) as any) as Bonding;
    mockForfeitor = (await deployMockContract(owner, ["function handleForfeit()"])) as any;

    // Deploy the SwingTrader
    const RewardDistributorFactory = await ethers.getContractFactory("RewardDistributor");

    rewardDistributor = (await RewardDistributorFactory.deploy(
      ownerAddress,
      adminAddress,
      dai.address,
    )) as RewardDistributor;
    await rewardDistributor.setupContracts(
      mockRewardMine.address,
      mockBonding.address,
      throttlerAddress,
      mockForfeitor.address,
    );

    // Add signer as REWARD_MINE_ROLE so methods can be called
    const REWARD_MINE_ROLE = utils.id("REWARD_MINE_ROLE");
    const rewardMineSignerAddress = await rewardMineSigner.getAddress();
    await rewardDistributor.assignRole(
      REWARD_MINE_ROLE,
      rewardMineSignerAddress
    );
  });

  afterEach(async function() {
    await hardhatRevert(snapshotId);
  });

  it("Has correct initial conditions", async function() {
    const throttlerAddress = await throttler.getAddress();

    expect(await rewardDistributor.focalID()).to.equal(1);
    expect(await rewardDistributor.focalLength()).to.equal(focalLength);
    expect(await rewardDistributor.rewardMine()).to.equal(mockRewardMine.address);
    expect(await rewardDistributor.throttler()).to.equal(throttlerAddress);
    expect(await rewardDistributor.forfeitor()).to.equal(mockForfeitor.address);
    expect(await rewardDistributor.rewardToken()).to.equal(dai.address);
    expect(await rewardDistributor.bonding()).to.equal(mockBonding.address);
  });

  it("Disallows non throttler from declaring reward", async function() {
    const [user] = accounts;
    const amountDai = utils.parseEther('2000');
    await dai.mint(rewardDistributor.address, amountDai);

    await expect(rewardDistributor.declareReward(amountDai)).to.be.reverted;
    await expect(rewardDistributor.connect(user).declareReward(amountDai)).to.be.reverted;
    await expect(rewardDistributor.connect(admin).declareReward(amountDai)).to.be.reverted;

    await mockBonding.mock.totalBonded.returns(1000);

    expect(await rewardDistributor.totalDeclaredReward()).to.equal(0);

    await rewardDistributor.connect(throttler).declareReward(amountDai);
    expect(await rewardDistributor.totalDeclaredReward()).to.equal(amountDai);
  });

  it("Disallows declaring 0 reward", async function() {
    const amountDai = utils.parseEther('2000');
    await dai.mint(rewardDistributor.address, amountDai);

    await expect(rewardDistributor.connect(throttler).declareReward(0)).to.be.reverted;
  });

  it("Disallows declaring reward greater than balance", async function() {
    await expect(rewardDistributor.connect(throttler).declareReward(100)).to.be.reverted;
  });

  it("Forfeits declared reward when there is 0 bonded", async function() {
    const amountDai = utils.parseEther('2000');
    await dai.mint(rewardDistributor.address, amountDai);

    await mockBonding.mock.totalBonded.returns(0);

    const initialBalance = await dai.balanceOf(mockForfeitor.address);
    expect(initialBalance).to.equal(0);
    expect(await rewardDistributor.totalDeclaredReward()).to.equal(0);

    // Should revert because the handleForfeit mock isn't implemented
    await expect(rewardDistributor.connect(throttler).declareReward(amountDai)).to.be.reverted;

    // Implement the handleForfeit mock
    await mockForfeitor.mock.handleForfeit.returns();

    await rewardDistributor.connect(throttler).declareReward(amountDai);

    const finalBalance = await dai.balanceOf(mockForfeitor.address);
    expect(finalBalance).to.equal(amountDai);

    expect(await rewardDistributor.totalDeclaredReward()).to.equal(0);
  });

  it("Disallows non reward mine from decrementingRewards", async function() {
    // Declare reward
    const amountDai = utils.parseEther('2000');
    await dai.mint(rewardDistributor.address, amountDai);
    await mockBonding.mock.totalBonded.returns(1000);
    await rewardDistributor.connect(throttler).declareReward(amountDai);

    await expect(rewardDistributor.decrementRewards(amountDai)).to.be.reverted;
    await expect(rewardDistributor.connect(admin).decrementRewards(amountDai)).to.be.reverted;
    await expect(rewardDistributor.connect(throttler).decrementRewards(amountDai)).to.be.reverted;

    expect(await rewardDistributor.totalDeclaredReward()).to.equal(amountDai);
    await rewardDistributor.connect(rewardMineSigner).decrementRewards(amountDai);
    expect(await rewardDistributor.totalDeclaredReward()).to.equal(0);
  });

  it("Disallows decrementing more than declaredBalance", async function() {
    // Declare reward
    const amountDai = utils.parseEther('2000');
    await dai.mint(rewardDistributor.address, amountDai);
    await mockBonding.mock.totalBonded.returns(1000);
    await rewardDistributor.connect(throttler).declareReward(amountDai);

    expect(await rewardDistributor.totalDeclaredReward()).to.equal(amountDai);

    await expect(rewardDistributor.connect(rewardMineSigner).decrementRewards(amountDai.mul(2))).to.be.reverted;

    expect(await rewardDistributor.totalDeclaredReward()).to.equal(amountDai);
  });

  it("Correctly decrements declared rewards", async function() {
    // Declare reward
    const amountDai = utils.parseEther('2000');
    await dai.mint(rewardDistributor.address, amountDai);
    await mockBonding.mock.totalBonded.returns(1000);
    await rewardDistributor.connect(throttler).declareReward(amountDai);

    expect(await rewardDistributor.totalDeclaredReward()).to.equal(amountDai);

    await rewardDistributor.connect(rewardMineSigner).decrementRewards(amountDai.div(2));
    expect(await rewardDistributor.totalDeclaredReward()).to.be.withinPercent(amountDai.div(2));

    await rewardDistributor.connect(rewardMineSigner).decrementRewards(amountDai.div(4));
    expect(await rewardDistributor.totalDeclaredReward()).to.be.withinPercent(amountDai.div(4));

    await rewardDistributor.connect(rewardMineSigner).decrementRewards(amountDai.div(4));
    expect(await rewardDistributor.totalDeclaredReward()).to.be.withinPercent(BigNumber.from(0));
  });

  it("Correctly decrement declared rewards by 0", async function() {
    // Declare reward
    const amountDai = utils.parseEther('2000');
    await dai.mint(rewardDistributor.address, amountDai);
    await mockBonding.mock.totalBonded.returns(1000);
    await rewardDistributor.connect(throttler).declareReward(amountDai);

    expect(await rewardDistributor.totalDeclaredReward()).to.equal(amountDai);

    await rewardDistributor.connect(rewardMineSigner).decrementRewards(0);
    expect(await rewardDistributor.totalDeclaredReward()).to.equal(amountDai);
  });

  it("Disallows non reward mine from forfeiting", async function() {
    // Declare reward
    const amountDai = utils.parseEther('2000');
    await dai.mint(rewardDistributor.address, amountDai);
    await mockBonding.mock.totalBonded.returns(1000);
    await rewardDistributor.connect(throttler).declareReward(amountDai);

    // Implement the handleForfeit mock
    await mockForfeitor.mock.handleForfeit.returns();

    await expect(rewardDistributor.forfeit(amountDai)).to.be.reverted;
    await expect(rewardDistributor.connect(admin).forfeit(amountDai)).to.be.reverted;
    await expect(rewardDistributor.connect(throttler).forfeit(amountDai)).to.be.reverted;

    const initialBalance = await dai.balanceOf(mockForfeitor.address);
    expect(initialBalance).to.equal(0);

    expect(await rewardDistributor.totalDeclaredReward()).to.equal(amountDai);
    await rewardDistributor.connect(rewardMineSigner).forfeit(amountDai);
    expect(await rewardDistributor.totalDeclaredReward()).to.equal(0);

    const finalBalance = await dai.balanceOf(mockForfeitor.address);
    expect(finalBalance).to.equal(amountDai);
  });

  it("Handles forfeiting 0", async function() {
    // Declare reward
    const amountDai = utils.parseEther('2000');
    await dai.mint(rewardDistributor.address, amountDai);
    await mockBonding.mock.totalBonded.returns(1000);
    await rewardDistributor.connect(throttler).declareReward(amountDai);

    // Implement the handleForfeit mock
    await mockForfeitor.mock.handleForfeit.returns();

    expect(await rewardDistributor.totalDeclaredReward()).to.equal(amountDai);
    await rewardDistributor.connect(rewardMineSigner).forfeit(0);
    expect(await rewardDistributor.totalDeclaredReward()).to.equal(amountDai);

    const finalBalance = await dai.balanceOf(mockForfeitor.address);
    expect(finalBalance).to.equal(0);
  });

  it("Correctly handles external forfeiting", async function() {
    // Declare reward
    const amountDai = utils.parseEther('2000');
    await dai.mint(rewardDistributor.address, amountDai);
    await mockBonding.mock.totalBonded.returns(1000);
    await rewardDistributor.connect(throttler).declareReward(amountDai);

    const initialBalance = await dai.balanceOf(mockForfeitor.address);
    expect(initialBalance).to.equal(0);

    // Implement the handleForfeit mock
    await mockForfeitor.mock.handleForfeit.returns();

    expect(await rewardDistributor.totalDeclaredReward()).to.equal(amountDai);
    await rewardDistributor.connect(rewardMineSigner).forfeit(amountDai.div(2));
    expect(await rewardDistributor.totalDeclaredReward()).to.be.withinPercent(amountDai.div(2));

    await rewardDistributor.connect(rewardMineSigner).forfeit(amountDai.div(4));
    expect(await rewardDistributor.totalDeclaredReward()).to.be.withinPercent(amountDai.div(4));

    await rewardDistributor.connect(rewardMineSigner).forfeit(amountDai.div(4));
    expect(await rewardDistributor.totalDeclaredReward()).to.be.withinPercent(BigNumber.from(0));

    const finalBalance = await dai.balanceOf(mockForfeitor.address);
    expect(finalBalance).to.equal(amountDai);
  });

  it("Disallows externally forfeiting more than declared balance", async function() {
    // Declare reward
    const amountDai = utils.parseEther('2000');
    await dai.mint(rewardDistributor.address, amountDai);
    await mockBonding.mock.totalBonded.returns(1000);
    await rewardDistributor.connect(throttler).declareReward(amountDai);

    // Implement the handleForfeit mock
    await mockForfeitor.mock.handleForfeit.returns();

    const initialBalance = await dai.balanceOf(mockForfeitor.address);
    expect(initialBalance).to.equal(0);

    await expect(rewardDistributor.connect(rewardMineSigner).forfeit(amountDai.mul(4))).to.be.reverted;
    expect(await rewardDistributor.totalDeclaredReward()).to.equal(amountDai);

    const finalBalance = await dai.balanceOf(mockForfeitor.address);
    expect(finalBalance).to.equal(0);
  });

  it("Handles vesting correctly", async function() {
    // Declare reward
    const amountDai = utils.parseEther('2000');
    await dai.mint(rewardDistributor.address, amountDai);
    await mockBonding.mock.totalBonded.returns(1000);
    await rewardDistributor.connect(throttler).declareReward(amountDai);

    let mineBalance = await dai.balanceOf(mockRewardMine.address);
    expect(mineBalance).to.equal(0);
    let distributorBalance = await dai.balanceOf(rewardDistributor.address);
    expect(distributorBalance).to.equal(amountDai);
    let declaredReward = await rewardDistributor.totalDeclaredReward();
    expect(declaredReward).to.equal(amountDai);

    // Quarter through a vesting
    await increaseTime(focalLength / 4);

    await rewardDistributor.vest();

    // A quarter should have been vested
    mineBalance = await dai.balanceOf(mockRewardMine.address);
    expect(mineBalance).to.be.withinPercent(amountDai.div(4));

    // 3 quarters left
    distributorBalance = await dai.balanceOf(rewardDistributor.address);
    expect(distributorBalance).to.be.withinPercent(amountDai.mul(3).div(4));

    declaredReward = await rewardDistributor.totalDeclaredReward();
    expect(declaredReward).to.equal(amountDai);

    // Half way through a vesting
    await increaseTime(focalLength / 4);

    await rewardDistributor.vest();

    // A half should have been vested
    mineBalance = await dai.balanceOf(mockRewardMine.address);
    expect(mineBalance).to.be.withinPercent(amountDai.div(2));

    // half left in distributor
    distributorBalance = await dai.balanceOf(rewardDistributor.address);
    expect(distributorBalance).to.be.withinPercent(amountDai.div(2));

    declaredReward = await rewardDistributor.totalDeclaredReward();
    expect(declaredReward).to.equal(amountDai);

    // Way past end of vesting
    await increaseTime(focalLength * 10);

    await rewardDistributor.vest();

    // All vested
    mineBalance = await dai.balanceOf(mockRewardMine.address);
    expect(mineBalance).to.equal(amountDai);

    distributorBalance = await dai.balanceOf(rewardDistributor.address);
    expect(distributorBalance).to.equal(0);

    declaredReward = await rewardDistributor.totalDeclaredReward();
    expect(declaredReward).to.equal(amountDai);
  });

  it("Handles vesting correctly with multiple reward declarations", async function() {
    // Declare reward
    const amountDai = utils.parseEther('2000');
    await dai.mint(rewardDistributor.address, amountDai);
    await mockBonding.mock.totalBonded.returns(1000);
    await rewardDistributor.connect(throttler).declareReward(amountDai);

    let mineBalance = await dai.balanceOf(mockRewardMine.address);
    expect(mineBalance).to.equal(0);
    let distributorBalance = await dai.balanceOf(rewardDistributor.address);
    expect(distributorBalance).to.equal(amountDai);
    let declaredReward = await rewardDistributor.totalDeclaredReward();
    expect(declaredReward).to.equal(amountDai);

    // Quarter through a vesting
    await increaseTime(focalLength / 4);

    await rewardDistributor.vest();

    // A quarter should have been vested
    mineBalance = await dai.balanceOf(mockRewardMine.address);
    await mockRewardMine.mock.totalReleasedReward.returns(mineBalance);
    expect(mineBalance).to.be.withinPercent(amountDai.div(4), 0.01);

    // 3 quarters left
    distributorBalance = await dai.balanceOf(rewardDistributor.address);
    expect(distributorBalance).to.be.withinPercent(amountDai.mul(3).div(4), 0.01);

    declaredReward = await rewardDistributor.totalDeclaredReward();
    expect(declaredReward).to.equal(amountDai);

    // Declare another reward
    const secondAmountDai = utils.parseEther('3000');
    await dai.mint(rewardDistributor.address, secondAmountDai);
    await rewardDistributor.connect(throttler).declareReward(secondAmountDai);

    // Half way through a vesting period
    await increaseTime(focalLength / 4);

    await rewardDistributor.vest();

    /*
     * At this point we are halfway through the focal period. So half of the first reward
     * should be vested.
     *
     * The second reward was added with 3/4 of the period left. We are now another quarter
     * into the future so a third of the second reward should be vested.
     */

    // Half should have been vested from first reward and a third from the second
    mineBalance = await dai.balanceOf(mockRewardMine.address);
    await mockRewardMine.mock.totalReleasedReward.returns(mineBalance);
    expect(mineBalance).to.be.withinPercent(amountDai.div(2).add(secondAmountDai.div(3)), 0.01);

    // Half left of initial + 2/3 left of second reward
    distributorBalance = await dai.balanceOf(rewardDistributor.address);
    expect(distributorBalance).to.be.withinPercent(amountDai.div(2).add(secondAmountDai.mul(2).div(3)), 0.01);

    declaredReward = await rewardDistributor.totalDeclaredReward();
    expect(declaredReward).to.equal(amountDai.add(secondAmountDai));

    // 3 quarters through. 2/3 of second reward vested
    await increaseTime(focalLength / 4);

    await rewardDistributor.vest();

    mineBalance = await dai.balanceOf(mockRewardMine.address);
    await mockRewardMine.mock.totalReleasedReward.returns(mineBalance);
    expect(mineBalance).to.be.withinPercent(amountDai.mul(3).div(4).add(secondAmountDai.mul(2).div(3)), 0.01);

    distributorBalance = await dai.balanceOf(rewardDistributor.address);
    expect(distributorBalance).to.be.withinPercent(amountDai.mul(1).div(4).add(secondAmountDai.mul(1).div(3)), 0.01);

    declaredReward = await rewardDistributor.totalDeclaredReward();
    expect(declaredReward).to.equal(amountDai.add(secondAmountDai));
  });

  it("Handles vesting across multiple focal periods with multiple reward declarations", async function() {
    // Declare reward
    const amountDai = utils.parseEther('2000');
    await dai.mint(rewardDistributor.address, amountDai);
    await mockBonding.mock.totalBonded.returns(1000);
    await rewardDistributor.connect(throttler).declareReward(amountDai);

    let mineBalance = await dai.balanceOf(mockRewardMine.address);
    expect(mineBalance).to.equal(0);
    let distributorBalance = await dai.balanceOf(rewardDistributor.address);
    expect(distributorBalance).to.equal(amountDai);
    let declaredReward = await rewardDistributor.totalDeclaredReward();
    expect(declaredReward).to.equal(amountDai);

    // Half way through a vesting period. Start of next focal period
    await increaseTime(focalLength / 2);

    await rewardDistributor.vest();

    // A half should have been vested
    mineBalance = await dai.balanceOf(mockRewardMine.address);
    await mockRewardMine.mock.totalReleasedReward.returns(mineBalance);
    expect(mineBalance).to.be.withinPercent(amountDai.div(2), 0.01);

    // half left
    distributorBalance = await dai.balanceOf(rewardDistributor.address);
    expect(distributorBalance).to.be.withinPercent(amountDai.div(2), 0.01);

    declaredReward = await rewardDistributor.totalDeclaredReward();
    expect(declaredReward).to.equal(amountDai);

    // Declare another reward. This should go towards the next focal period
    const secondAmountDai = utils.parseEther('3000');
    await dai.mint(rewardDistributor.address, secondAmountDai);
    await rewardDistributor.connect(throttler).declareReward(secondAmountDai);

    // 3/4 through first period. 1/4 through the second
    await increaseTime(focalLength / 4);

    await rewardDistributor.vest();

    mineBalance = await dai.balanceOf(mockRewardMine.address);
    await mockRewardMine.mock.totalReleasedReward.returns(mineBalance);
    expect(mineBalance).to.be.withinPercent(amountDai.mul(3).div(4).add(secondAmountDai.div(4)), 0.01);

    distributorBalance = await dai.balanceOf(rewardDistributor.address);
    expect(distributorBalance).to.be.withinPercent(amountDai.div(4).add(secondAmountDai.mul(3).div(4)), 0.01);

    declaredReward = await rewardDistributor.totalDeclaredReward();
    expect(declaredReward).to.equal(amountDai.add(secondAmountDai));

    // Finished first period. Half way through the second
    await increaseTime(focalLength / 4);

    await rewardDistributor.vest();

    mineBalance = await dai.balanceOf(mockRewardMine.address);
    await mockRewardMine.mock.totalReleasedReward.returns(mineBalance);
    expect(mineBalance).to.be.withinPercent(amountDai.add(secondAmountDai.div(2)), 0.01);

    distributorBalance = await dai.balanceOf(rewardDistributor.address);
    expect(distributorBalance).to.be.withinPercent(secondAmountDai.div(2), 0.01);

    declaredReward = await rewardDistributor.totalDeclaredReward();
    expect(declaredReward).to.equal(amountDai.add(secondAmountDai));

    // Finish everything
    await increaseTime(focalLength / 2);

    await rewardDistributor.vest();

    mineBalance = await dai.balanceOf(mockRewardMine.address);
    await mockRewardMine.mock.totalReleasedReward.returns(mineBalance);
    expect(mineBalance).to.be.withinPercent(amountDai.add(secondAmountDai), 0.01);

    distributorBalance = await dai.balanceOf(rewardDistributor.address);
    expect(distributorBalance).to.equal(0);

    declaredReward = await rewardDistributor.totalDeclaredReward();
    expect(declaredReward).to.equal(amountDai.add(secondAmountDai));
  });

  it("Still passes reward check when balance is in rewardMine instead", async function() {
    let declaredReward = await rewardDistributor.totalDeclaredReward();
    expect(declaredReward).to.equal(0);

    // Declare reward
    const amountDai = utils.parseEther('2000');
    await mockRewardMine.mock.totalReleasedReward.returns(amountDai);
    await mockBonding.mock.totalBonded.returns(1000);
    await rewardDistributor.connect(throttler).declareReward(amountDai);

    declaredReward = await rewardDistributor.totalDeclaredReward();
    expect(declaredReward).to.equal(amountDai);
  });

  it("Only allows admin to set focal length", async function() {
    const [user] = accounts;
    const newFocalLength = 60 * 60 * 23;
    await expect(rewardDistributor.connect(user).setFocalLength(newFocalLength)).to.be.reverted;
    await expect(rewardDistributor.connect(throttler).setFocalLength(newFocalLength)).to.be.reverted;

    await rewardDistributor.connect(admin).setFocalLength(newFocalLength);
    expect(await rewardDistributor.focalLength()).to.equal(newFocalLength);

    const newFocalLength2 = 60 * 60 * 35;
    await rewardDistributor.setFocalLength(newFocalLength2);
    expect(await rewardDistributor.focalLength()).to.equal(newFocalLength2);
  });

  it("Only allows admin to set throttler", async function() {
    const [newContract, newContract2, user] = accounts;
    const newAddress = await newContract.getAddress();
    const new2Address = await newContract2.getAddress();

    await expect(rewardDistributor.connect(user).setThrottler(newAddress)).to.be.reverted;
    await expect(rewardDistributor.connect(throttler).setThrottler(newAddress)).to.be.reverted;

    await rewardDistributor.connect(admin).setThrottler(newAddress);
    expect(await rewardDistributor.throttler()).to.equal(newAddress);

    await rewardDistributor.setThrottler(new2Address);
    expect(await rewardDistributor.throttler()).to.equal(new2Address);
  });

  it("Only allows admin to set reward mine", async function() {
    const [newContract, newContract2, user] = accounts;
    const newAddress = await newContract.getAddress();
    const new2Address = await newContract2.getAddress();

    await expect(rewardDistributor.connect(user).setRewardMine(newAddress)).to.be.reverted;
    await expect(rewardDistributor.connect(throttler).setRewardMine(newAddress)).to.be.reverted;

    await rewardDistributor.connect(admin).setRewardMine(newAddress);
    expect(await rewardDistributor.rewardMine()).to.equal(newAddress);

    await rewardDistributor.setRewardMine(new2Address);
    expect(await rewardDistributor.rewardMine()).to.equal(new2Address);
  });

  it("Only allows admin to set forfeitor", async function() {
    const [newContract, newContract2, user] = accounts;
    const newAddress = await newContract.getAddress();
    const new2Address = await newContract2.getAddress();

    await expect(rewardDistributor.connect(user).setForfeitor(newAddress)).to.be.reverted;
    await expect(rewardDistributor.connect(throttler).setForfeitor(newAddress)).to.be.reverted;

    await rewardDistributor.connect(admin).setForfeitor(newAddress);
    expect(await rewardDistributor.forfeitor()).to.equal(newAddress);

    await rewardDistributor.setForfeitor(new2Address);
    expect(await rewardDistributor.forfeitor()).to.equal(new2Address);
  });

  it("Only allows admin to set Bonding", async function() {
    const [newContract, newContract2, user] = accounts;
    const newAddress = await newContract.getAddress();
    const new2Address = await newContract2.getAddress();

    await expect(rewardDistributor.connect(user).setBonding(newAddress)).to.be.reverted;
    await expect(rewardDistributor.connect(throttler).setBonding(newAddress)).to.be.reverted;

    await rewardDistributor.connect(admin).setBonding(newAddress);
    expect(await rewardDistributor.bonding()).to.equal(newAddress);

    await rewardDistributor.setBonding(new2Address);
    expect(await rewardDistributor.bonding()).to.equal(new2Address);
  });

  it("Only allows admin to set add or remove focal length updaters", async function() {
    const [newContract, newContract2, user] = accounts;
    const newAddress = await newContract.getAddress();
    const new2Address = await newContract2.getAddress();

    const newFocalLength = 60 * 60 * 23;
    await expect(rewardDistributor.connect(user).addFocalLengthUpdater(newAddress)).to.be.reverted;
    await expect(rewardDistributor.connect(throttler).addFocalLengthUpdater(newAddress)).to.be.reverted;
    await expect(rewardDistributor.connect(newContract).setFocalLength(newFocalLength)).to.be.reverted;

    // Add new updater
    await rewardDistributor.connect(admin).addFocalLengthUpdater(newAddress);

    await rewardDistributor.connect(newContract).setFocalLength(newFocalLength);
    expect(await rewardDistributor.focalLength()).to.equal(newFocalLength);

    await expect(rewardDistributor.connect(user).removeFocalLengthUpdater(newAddress)).to.be.reverted;
    await expect(rewardDistributor.connect(throttler).removeFocalLengthUpdater(newAddress)).to.be.reverted;

    // Remove the new updater
    await rewardDistributor.connect(admin).removeFocalLengthUpdater(newAddress);

    const newestFocalLength = 60 * 60 * 23;
    await expect(rewardDistributor.connect(newContract).setFocalLength(newestFocalLength)).to.be.reverted;
    expect(await rewardDistributor.focalLength()).to.equal(newFocalLength);
  });

  it("Handles additional rewards being sent maliciously to the distributor without declaring", async function() {
    // If extra reward tokens are sent to the distributor contract
    // maliciously it should not break the functionality.
    // During the v2 testnet funds where sent to the contract
    // without declaring them. Those rewards mistakenly got
    // vested to the reward mine due to a bug that didn't
    // decrease rewards in focal objects.

    // Declare real reward
    const amountDai = utils.parseEther('2000');
    await dai.mint(rewardDistributor.address, amountDai);
    await mockBonding.mock.totalBonded.returns(1000);
    await rewardDistributor.connect(throttler).declareReward(amountDai);

    const maliciousAmount = utils.parseEther('1000');
    await dai.mint(rewardDistributor.address, maliciousAmount);

    // Half way through a vesting
    await increaseTime(focalLength / 2);
    await rewardDistributor.vest();
    await mockRewardMine.mock.totalReleasedReward.returns(amountDai.div(2));

    // Half should have been vested
    let mineBalance = await dai.balanceOf(mockRewardMine.address);
    expect(mineBalance).to.be.withinPercent(amountDai.div(2));

    // Implement the handleForfeit mock
    await mockForfeitor.mock.handleForfeit.returns();

    expect(await rewardDistributor.totalDeclaredReward()).to.equal(amountDai);
    // Forfeit half the rewards
    await rewardDistributor.connect(rewardMineSigner).forfeit(amountDai.div(2));
    const totalDeclared = amountDai.div(2);
    // Now that half is forfeited total declared should be halved
    expect(await rewardDistributor.totalDeclaredReward()).to.equal(totalDeclared);

    // Move to end of original focal length and vest again
    await increaseTime(focalLength / 2);
    await rewardDistributor.vest();

    // No more should have vested
    // Above we showed totalDeclared to be amountDai.div(2)
    // which is the same as mineBalance above
    // if balance in mine now is larger than means that
    // the released rewards is greater than declared which
    // is undesireable
    let totalReleased = await dai.balanceOf(mockRewardMine.address);
    expect(totalReleased).to.be.lte(mineBalance);
  });

  it("Correctly returns % of both focals that are unvested", async function() {
    // Declare real reward
    const amountDai = utils.parseEther('2000');
    await dai.mint(rewardDistributor.address, amountDai);
    await mockBonding.mock.totalBonded.returns(1000);
    await rewardDistributor.connect(throttler).declareReward(amountDai);

    let result = await rewardDistributor.getAllFocalUnvestedBps();

    expect(result.currentUnvestedBps).to.be.near(10000, 1);
    // Vesting focal doesn't exit yet
    expect(result.vestingUnvestedBps).to.equal(0);

    // Move 40% through vesting period
    await increaseTime(focalLength * 0.4);

    result = await rewardDistributor.getAllFocalUnvestedBps();

    // 40% through vesting period = 60% unvested
    expect(result.currentUnvestedBps).to.be.near(6000, 1);
    // Vesting focal doesn't exit yet
    expect(result.vestingUnvestedBps).to.equal(0);

    // A further 40% in. This brings the other focal into play
    await increaseTime(focalLength * 0.4);
    await dai.mint(rewardDistributor.address, amountDai);
    await rewardDistributor.connect(throttler).declareReward(amountDai);

    result = await rewardDistributor.getAllFocalUnvestedBps();

    // 80% into the previous focal puts us 30% into the new one
    // 30% vested = 70% unvested
    expect(result.currentUnvestedBps).to.be.near(7000, 1);
    // Vesting focal is the previoud current focal.
    // 80% through vesting = 20% unvested
    expect(result.vestingUnvestedBps).to.be.near(2000, 1);
  });

  it("Correctly returns % of active focal", async function() {
    // Declare real reward
    const amountDai = utils.parseEther('2000');
    await dai.mint(rewardDistributor.address, amountDai);
    await mockBonding.mock.totalBonded.returns(1000);
    await rewardDistributor.connect(throttler).declareReward(amountDai);

    let unvestedBps = await rewardDistributor.getFocalUnvestedBps(1);

    expect(unvestedBps).to.be.near(10000, 1);

    // Move 40% through vesting period
    await increaseTime(focalLength * 0.4);

    unvestedBps = await rewardDistributor.getFocalUnvestedBps(1);

    // 40% through vesting period = 60% unvested
    expect(unvestedBps).to.be.near(6000, 1);

    // A further 40% in. This brings the other focal into play
    await increaseTime(focalLength * 0.4);
    await dai.mint(rewardDistributor.address, amountDai);
    await rewardDistributor.connect(throttler).declareReward(amountDai);

    unvestedBps = await rewardDistributor.getFocalUnvestedBps(1);
    let newUnvestedBps = await rewardDistributor.getFocalUnvestedBps(2);

    // 80% through vesting = 20% unvested
    expect(unvestedBps).to.be.near(2000, 1);
    // 30% through vesting = 70% unvested
    expect(newUnvestedBps).to.be.near(7000, 1);
  });
});
