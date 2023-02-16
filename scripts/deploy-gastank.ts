import hre, { ethers } from "hardhat";
async function main() {
  let tx, receipt;
  const owner = "0x7306aC7A32eb690232De81a9FFB44Bb346026faB";
  const verifyingSigner = "0x416B03E2E5476B6a2d1dfa627B404Da1781e210d";

  const FallbackGasTank = await ethers.getContractFactory(
    "FallbackGasTank"
  );
  const gasTank = await FallbackGasTank.deploy(
    owner,
    verifyingSigner
  );
  tx = await gasTank.deployed();
  console.log("FallbackGasTank deployed at: ", gasTank.address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
