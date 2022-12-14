import { expect } from "chai";
import { ethers, waffle } from "hardhat";
import { Signer } from "ethers";
import { UniswapHandler } from "../type/UniswapHandler";
import { Malt } from "../type/Malt";
import { MaltDataLab } from "../type/MaltDataLab";
import { ERC20 } from "../type/ERC20";
import { TransferService } from "../type/TransferService";
import { ContractFactory, constants, utils, Contract, BigNumber } from 'ethers';
import { hardhatSnapshot, hardhatRevert, increaseTime } from "./helpers";
import IERC20 from "../artifacts/@openzeppelin/contracts/token/ERC20/IERC20.sol/IERC20.json";
import MaltArtifacts from "../artifacts/contracts/Malt.sol/Malt.json";
import UniswapV2RouterBuild from "@uniswap/v2-periphery/build/UniswapV2Router02.json";
import UniswapV2FactoryBuild from "@uniswap/v2-core/build/UniswapV2Factory.json";
import WETHBuild from "@uniswap/v2-periphery/build/WETH9.json";

const UniswapV2FactoryBytecode = UniswapV2FactoryBuild.bytecode;
const UniswapV2FactoryAbi = UniswapV2FactoryBuild.abi;

const UniswapV2RouterBytecode = UniswapV2RouterBuild.bytecode;
const UniswapV2RouterAbi = UniswapV2RouterBuild.abi;
const WETHBytecode = WETHBuild.bytecode;
const WETHAbi = WETHBuild.abi;

const { deployMockContract } = waffle;

describe("Uniswap Handler", function() {
  let accounts: Signer[];
  let owner: Signer;
  let admin: Signer;
  let timelock: Signer;

  let uniswapHandler: UniswapHandler;
  let dai: ERC20;
  let malt: ERC20;
  let LPToken: ERC20;
  let snapshotId: string;

  let weth: Contract;
  let router: any;
  let factory: any;
  let mockTransferService: TransferService;
  let mockDataLab: MaltDataLab;

  const initialReserves = utils.parseEther('100000');
  const BUYER_ROLE = utils.id("BUYER_ROLE");
  const SELLER_ROLE = utils.id("SELLER_ROLE");

  beforeEach(async function() {
    snapshotId = await hardhatSnapshot();
    [owner, admin, timelock, ...accounts] = await ethers.getSigners();
    const user = accounts[0];

    const ownerAddress = await owner.getAddress();
    const adminAddress = await admin.getAddress();
    const timelockAddress = await timelock.getAddress();
    const userAddress = await user.getAddress();

    const ERC20Factory = await ethers.getContractFactory("Malt");

    // Deploy Uniswap Contracts
    const routerContract = new ContractFactory(UniswapV2RouterAbi, UniswapV2RouterBytecode, owner);
    const wethContract = new ContractFactory(WETHAbi, WETHBytecode, owner);

    const factoryContract = new ContractFactory(UniswapV2FactoryAbi, UniswapV2FactoryBytecode, owner);
    factory = await factoryContract.deploy(constants.AddressZero);

    weth = await wethContract.deploy();
    await weth.deployed();
    router = await routerContract.deploy(factory.address, weth.address);
    await router.deployed();

    mockTransferService = ((await deployMockContract(owner, [
      "function verifyTransferAndCall(address, address, uint256) returns (bool, string memory)"
    ])) as any) as TransferService;
    await mockTransferService.mock.verifyTransferAndCall.returns(true, "");

    // Deploy ERC20 tokens
    malt = (await ERC20Factory.deploy(
      "Malt Stablecoin",
      "MALT",
      ownerAddress,
      adminAddress,
      mockTransferService.address,
    )) as Malt;
    dai = (await ERC20Factory.deploy(
      "Dai Stablecoin",
      "DAI",
      ownerAddress,
      adminAddress,
      mockTransferService.address,
    )) as Malt;

    await dai.deployed();
    await malt.deployed();

    await factory.createPair(malt.address, dai.address);
    let pair = await factory.getPair(malt.address, dai.address);

    LPToken = (new Contract(pair, IERC20.abi, owner)) as ERC20;

    mockDataLab = ((await deployMockContract(owner, [
      "function maltPriceAverage(uint256) returns (uint256)",
      "function poolReservesAverage(uint256) returns (uint256, uint256)",
    ])) as any) as MaltDataLab;
    await mockDataLab.mock.maltPriceAverage.returns(utils.parseEther('1'));

    // Deploy the UniswapHandler
    const UniswapHandlerFactory = await ethers.getContractFactory("UniswapHandler");

    uniswapHandler = (await UniswapHandlerFactory.deploy(
      timelockAddress,
      adminAddress,
      malt.address,
      dai.address,
      LPToken.address,
      router.address,
      mockDataLab.address
    )) as UniswapHandler;
    await uniswapHandler.deployed();

    const LIQUIDITY_ADDER_ROLE = utils.id("LIQUIDITY_ADDER_ROLE");
    await uniswapHandler.connect(admin).grantRole(LIQUIDITY_ADDER_ROLE, userAddress);

    await malt.initialSupplyControlSetup([ownerAddress], []);
    await dai.initialSupplyControlSetup([ownerAddress], []);
  });

  afterEach(async function() {
    await hardhatRevert(snapshotId);
  });

  it("Has correct initial conditions", async function() {
    expect(await uniswapHandler.malt()).to.equal(malt.address);
    expect(await uniswapHandler.rewardToken()).to.equal(dai.address);
    expect(await uniswapHandler.lpToken()).to.equal(LPToken.address);
    expect(await uniswapHandler.router()).to.equal(router.address);
  });

  it("Can add liquidity", async function() {
    const user = accounts[0];
    const userAddress = await user.getAddress();

    const amountMalt = utils.parseEther('1000');
    const amountDai = utils.parseEther('2000');

    await malt.mint(uniswapHandler.address, amountMalt);
    await dai.mint(uniswapHandler.address, amountDai);

    const lpBalance = await LPToken.balanceOf(userAddress);

    expect(lpBalance).to.equal(0);

    await uniswapHandler.connect(user).addLiquidity(amountMalt, amountDai, 10000);
    await mockDataLab.mock.maltPriceAverage.returns(utils.parseEther('2'));

    const lpBalanceAfter = await LPToken.balanceOf(userAddress);

    expect(lpBalanceAfter).to.be.above(0);

    const poolMalt = await malt.balanceOf(LPToken.address);
    const poolDai = await dai.balanceOf(LPToken.address);

    expect(poolMalt).to.equal(amountMalt);
    expect(poolDai).to.equal(amountDai);

    const userMalt = await malt.balanceOf(userAddress);
    const userDai = await dai.balanceOf(userAddress);

    expect(userMalt).to.equal(0);
    expect(userDai).to.equal(0);

    const handlerMalt = await malt.balanceOf(uniswapHandler.address);
    const handlerDai = await dai.balanceOf(uniswapHandler.address);
    const handlerLP = await LPToken.balanceOf(uniswapHandler.address);

    expect(handlerMalt).to.equal(0);
    expect(handlerDai).to.equal(0);
    expect(handlerLP).to.equal(0);
  });

  it("Can remove liquidity", async function() {
    const user = accounts[0];
    const userAddress = await user.getAddress();

    const amountMalt = utils.parseEther('1000');
    const amountDai = utils.parseEther('2000');

    await malt.mint(uniswapHandler.address, amountMalt);
    await dai.mint(uniswapHandler.address, amountDai);
    await uniswapHandler.connect(user).addLiquidity(amountMalt, amountDai, 10000)
    await mockDataLab.mock.maltPriceAverage.returns(utils.parseEther('2'));

    const handlerLP = await LPToken.balanceOf(uniswapHandler.address);
    expect(handlerLP).to.equal(0);

    const userLP = await LPToken.balanceOf(userAddress);
    expect(userLP).to.be.above(0);

    await LPToken.connect(user).transfer(uniswapHandler.address, userLP);

    await mockDataLab.mock.poolReservesAverage.returns(amountMalt, amountDai);

    const LIQUIDITY_REMOVER_ROLE = utils.id("LIQUIDITY_REMOVER_ROLE");
    await uniswapHandler.connect(admin).grantRole(LIQUIDITY_REMOVER_ROLE, userAddress);
    await uniswapHandler.connect(user).removeLiquidity(userLP, 500);

    const userMalt = await malt.balanceOf(userAddress);
    const userDai = await dai.balanceOf(userAddress);

    // It won't be exact as uniswap keeps a tiny min balance
    expect(userMalt).to.be.near(amountMalt);
    expect(userDai).to.be.near(amountDai);
  });

  it("Disallows non buyer role from calling buyMalt", async function() {
    const user = accounts[0];
    const userAddress = await user.getAddress();

    const amountMalt = utils.parseEther('1000');
    const amountDai = utils.parseEther('2000');

    await malt.mint(uniswapHandler.address, amountMalt);
    await dai.mint(uniswapHandler.address, amountDai);
    await uniswapHandler.connect(user).addLiquidity(amountMalt, amountDai, 10000);
    await mockDataLab.mock.maltPriceAverage.returns(utils.parseEther('2'));

    const purchaseCapital = utils.parseEther('20');
    await dai.mint(uniswapHandler.address, purchaseCapital);

    let userMalt = await malt.balanceOf(userAddress);
    expect(userMalt).to.equal(0);

    await expect(uniswapHandler.connect(user).buyMalt(purchaseCapital, 500)).to.be.revertedWith("Must have buyer privs");
  });

  it("Can buy malt", async function() {
    const user = accounts[0];
    const userAddress = await user.getAddress();

    await uniswapHandler.connect(admin).grantRole(BUYER_ROLE, userAddress);

    const amountMalt = utils.parseEther('1000');
    const amountDai = utils.parseEther('2000');

    await malt.mint(uniswapHandler.address, amountMalt);
    await dai.mint(uniswapHandler.address, amountDai);
    await uniswapHandler.connect(user).addLiquidity(amountMalt, amountDai, 10000);
    await mockDataLab.mock.maltPriceAverage.returns(utils.parseEther('2'));
    await mockDataLab.mock.maltPriceAverage.returns(utils.parseEther('2'));

    const purchaseCapital = utils.parseEther('20');
    await dai.mint(uniswapHandler.address, purchaseCapital);

    let userMalt = await malt.balanceOf(userAddress);
    expect(userMalt).to.equal(0);

    await uniswapHandler.connect(user).buyMalt(purchaseCapital, 500)

    userMalt = await malt.balanceOf(userAddress);
    const userDai = await dai.balanceOf(userAddress);

    // A little slippage
    expect(userMalt).to.equal(utils.parseEther('9.871580343970612988'));
    expect(userDai).to.equal(0);
  });

  it("Can sell malt", async function() {
    const user = accounts[0];
    const userAddress = await user.getAddress();

    const amountMalt = utils.parseEther('1000');
    const amountDai = utils.parseEther('2000');

    await malt.mint(uniswapHandler.address, amountMalt);
    await dai.mint(uniswapHandler.address, amountDai);
    await uniswapHandler.connect(user).addLiquidity(amountMalt, amountDai, 10000);
    await mockDataLab.mock.maltPriceAverage.returns(utils.parseEther('2'));

    const purchaseCapital = utils.parseEther('20');
    await malt.mint(uniswapHandler.address, purchaseCapital);

    let userDai = await dai.balanceOf(userAddress);
    expect(userDai).to.equal(0);

    await uniswapHandler.connect(admin).grantRole(SELLER_ROLE, userAddress);
    await uniswapHandler.connect(user).sellMalt(purchaseCapital, 500);

    const userMalt = await malt.balanceOf(userAddress);
    userDai = await dai.balanceOf(userAddress);

    expect(userMalt).to.equal(0);
    // A little slippage
    expect(userDai).to.equal(utils.parseEther('39.100339235641312234'));
  });

  it("Buying malt without sending DAI does nothing", async function() {
    const user = accounts[0];
    const userAddress = await user.getAddress();

    await uniswapHandler.connect(admin).grantRole(BUYER_ROLE, userAddress);

    const amountMalt = utils.parseEther('1000');
    const amountDai = utils.parseEther('2000');

    await malt.mint(uniswapHandler.address, amountMalt);
    await dai.mint(uniswapHandler.address, amountDai);
    await uniswapHandler.connect(user).addLiquidity(amountMalt, amountDai, 10000);
    await mockDataLab.mock.maltPriceAverage.returns(utils.parseEther('2'));

    let userMalt = await malt.balanceOf(userAddress);
    expect(userMalt).to.equal(0);

    await uniswapHandler.connect(user).buyMalt(0, 500)

    userMalt = await malt.balanceOf(userAddress);
    const userDai = await dai.balanceOf(userAddress);

    expect(userMalt).to.equal(0);
    expect(userDai).to.equal(0);
  });

  it("Selling malt without sending the malt does nothing", async function() {
    const user = accounts[0];
    const userAddress = await user.getAddress();

    const amountMalt = utils.parseEther('1000');
    const amountDai = utils.parseEther('2000');

    await malt.mint(uniswapHandler.address, amountMalt);
    await dai.mint(uniswapHandler.address, amountDai);
    await uniswapHandler.connect(user).addLiquidity(amountMalt, amountDai, 10000)
    await mockDataLab.mock.maltPriceAverage.returns(utils.parseEther('2'));

    let userDai = await dai.balanceOf(userAddress);
    expect(userDai).to.equal(0);

    await uniswapHandler.connect(admin).grantRole(SELLER_ROLE, userAddress);
    await uniswapHandler.connect(user).sellMalt(0, 500);

    const userMalt = await malt.balanceOf(userAddress);
    userDai = await dai.balanceOf(userAddress);

    expect(userMalt).to.equal(0);
    expect(userDai).to.equal(0);
  });

  it("Can return reserves", async function() {
    const user = accounts[0];
    const userAddress = await user.getAddress();

    const amountMalt = utils.parseEther('1000');
    const amountDai = utils.parseEther('2000');

    await malt.mint(uniswapHandler.address, amountMalt);
    await dai.mint(uniswapHandler.address, amountDai);
    await uniswapHandler.connect(user).addLiquidity(amountMalt, amountDai, 10000)
    await mockDataLab.mock.maltPriceAverage.returns(utils.parseEther('2'));

    const {maltSupply, rewardSupply} = await uniswapHandler.connect(user).reserves();

    expect(maltSupply).to.equal(amountMalt);
    expect(rewardSupply).to.equal(amountDai);
  });

  it("Can return live malt market price above 1", async function() {
    const user = accounts[0];
    const userAddress = await user.getAddress();

    const amountMalt = utils.parseEther('1000');
    const amountDai = utils.parseEther('2000');

    await malt.mint(uniswapHandler.address, amountMalt);
    await dai.mint(uniswapHandler.address, amountDai);
    await uniswapHandler.connect(user).addLiquidity(amountMalt, amountDai, 10000)
    await mockDataLab.mock.maltPriceAverage.returns(utils.parseEther('2'));

    const {price, decimals} = await uniswapHandler.connect(user).maltMarketPrice();

    const maltDecimals = await malt.decimals();

    expect(decimals).to.equal(maltDecimals);
    // 1000 Malt and 2000 DAI = $2 per Malt
    expect(price).to.equal(utils.parseEther('2'));
  });

  it("Can return live malt market price below 1", async function() {
    const user = accounts[0];
    const userAddress = await user.getAddress();

    const amountMalt = utils.parseEther('2000');
    const amountDai = utils.parseEther('1000');

    await malt.mint(uniswapHandler.address, amountMalt);
    await dai.mint(uniswapHandler.address, amountDai);
    await uniswapHandler.connect(user).addLiquidity(amountMalt, amountDai, 10000)
    await mockDataLab.mock.maltPriceAverage.returns(utils.parseEther('0.5'));

    const {price, decimals} = await uniswapHandler.connect(user).maltMarketPrice();

    const maltDecimals = await malt.decimals();

    expect(decimals).to.equal(maltDecimals);
    // 2000 Malt and 1000 DAI = $0.5 per Malt
    expect(price).to.equal(utils.parseEther('0.5'));
  });

  it("Can return optimal live liquidity", async function() {
    const user = accounts[0];
    const userAddress = await user.getAddress();

    const amountMalt = utils.parseEther('2000');
    const amountDai = utils.parseEther('1000');

    await malt.mint(uniswapHandler.address, amountMalt);
    await dai.mint(uniswapHandler.address, amountDai);
    await uniswapHandler.connect(user).addLiquidity(amountMalt, amountDai, 10000)
    await mockDataLab.mock.maltPriceAverage.returns(utils.parseEther('0.5'));

    const maltLiquidity = await uniswapHandler.connect(user).getOptimalLiquidity(
      malt.address,
      dai.address,
      amountDai.mul(2)
    );

    expect(maltLiquidity).to.equal(amountMalt.mul(2));

    const daiLiquidity = await uniswapHandler.connect(user).getOptimalLiquidity(
      dai.address,
      malt.address,
      amountMalt.mul(2)
    );

    expect(daiLiquidity).to.equal(amountDai.mul(2));
  });

  it("Minting trade size is 0 when price is at target", async function() {
    const user = accounts[0];
    const userAddress = await user.getAddress();

    const amountMalt = utils.parseEther('2000');
    const amountDai = utils.parseEther('2000');

    await malt.mint(uniswapHandler.address, amountMalt);
    await dai.mint(uniswapHandler.address, amountDai);
    await uniswapHandler.connect(user).addLiquidity(amountMalt, amountDai, 10000)

    const priceTarget = utils.parseEther('1');
    const tradeSize = await uniswapHandler.connect(user).calculateMintingTradeSize(priceTarget);

    expect(tradeSize).to.equal(0);
  });

  it("Minting trade size is 0 when price is below target", async function() {
    const user = accounts[0];
    const userAddress = await user.getAddress();

    const amountMalt = utils.parseEther('5000');
    const amountDai = utils.parseEther('2000');

    await malt.mint(uniswapHandler.address, amountMalt);
    await dai.mint(uniswapHandler.address, amountDai);
    await uniswapHandler.connect(user).addLiquidity(amountMalt, amountDai, 10000)
    await mockDataLab.mock.maltPriceAverage.returns(utils.parseEther('0.4'));

    const priceTarget = utils.parseEther('1');
    const tradeSize = await uniswapHandler.connect(user).calculateMintingTradeSize(priceTarget);

    expect(tradeSize).to.equal(0);
  });

  it("Burning trade size is 0 when price is at target", async function() {
    const user = accounts[0];
    const userAddress = await user.getAddress();

    const amountMalt = utils.parseEther('2000');
    const amountDai = utils.parseEther('2000');

    await malt.mint(uniswapHandler.address, amountMalt);
    await dai.mint(uniswapHandler.address, amountDai);
    await uniswapHandler.connect(user).addLiquidity(amountMalt, amountDai, 10000)

    const priceTarget = utils.parseEther('1');
    const tradeSize = await uniswapHandler.connect(user).calculateBurningTradeSize(priceTarget);

    expect(tradeSize).to.equal(0);
  });

  it("Burning trade size is 0 when price is above target", async function() {
    const user = accounts[0];
    const userAddress = await user.getAddress();

    const amountMalt = utils.parseEther('2000');
    const amountDai = utils.parseEther('5000');

    await malt.mint(uniswapHandler.address, amountMalt);
    await dai.mint(uniswapHandler.address, amountDai);
    await uniswapHandler.connect(user).addLiquidity(amountMalt, amountDai, 10000)
    await mockDataLab.mock.maltPriceAverage.returns(utils.parseEther('2.5'));

    const priceTarget = utils.parseEther('1');
    const tradeSize = await uniswapHandler.connect(user).calculateBurningTradeSize(priceTarget);

    expect(tradeSize).to.equal(0);
  });

  it("Minting trade size is correct when price is above target", async function() {
    const user = accounts[0];
    const userAddress = await user.getAddress();

    const amountMalt = utils.parseEther('1000');
    const amountDai = utils.parseEther('2000');

    await malt.mint(uniswapHandler.address, amountMalt);
    await dai.mint(uniswapHandler.address, amountDai);
    await uniswapHandler.connect(user).addLiquidity(amountMalt, amountDai, 10000)
    await mockDataLab.mock.maltPriceAverage.returns(utils.parseEther('2'));

    const priceTarget = utils.parseEther('1');
    const tradeSize = await uniswapHandler.connect(user).calculateMintingTradeSize(priceTarget);

    expect(tradeSize).to.be.near(utils.parseEther('413.330640570018326894'));
  });

  it("Burning trade size is correct when price is below target", async function() {
    const user = accounts[0];
    const userAddress = await user.getAddress();

    const amountMalt = utils.parseEther('2000');
    const amountDai = utils.parseEther('1000');

    await malt.mint(uniswapHandler.address, amountMalt);
    await dai.mint(uniswapHandler.address, amountDai);
    await uniswapHandler.connect(user).addLiquidity(amountMalt, amountDai, 10000)
    await mockDataLab.mock.maltPriceAverage.returns(utils.parseEther('0.5'));

    const priceTarget = utils.parseEther('1');
    const tradeSize = await uniswapHandler.connect(user).calculateBurningTradeSize(priceTarget);

    expect(tradeSize).to.be.near(utils.parseEther('413.330640570018326894'));
  });
});
