// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "./IAction.sol";
import "../utils/Constants.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface IAddressProvider {
    function get_address(uint256) external view returns (address);
}

interface ISwapper {
    function exchange(
        address _pool,
        address _from,
        address _to,
        uint256 _amount,
        uint256 _expected,
        address _receiver
    ) external payable returns (uint256);
}

interface IRegistry {
    function get_coin_indices(
        address,
        address,
        address
    )
        external
        view
        returns (
            int128,
            int128,
            bool
        );
}

/*
    https://curve.readthedocs.io/registry-exchanges.html
    
    The other way to do it is to locate the pool and then do a direct exchange https://curve.readthedocs.io/exchange-pools.html#StableSwap.exchange

    runtimeParams.triggerData must be in decimals = 8
    Notes with examples: 
    ETH/USD -> USD per ETH -> ETH Price in USD -> triggerData = ["eth", "usd"] -> Must use when tokenIn = ETH and tokenOut = USD (i.e. buying USD with ETH)
    USD/ETH -> ETH per USD -> USD Price in ETH -> triggerData = ["usd", "eth"] -> Must use when tokenIn = USD* and tokenOut = ETH (i.e. buying ETH with USD)
 
    action.data must be in the form of (address)

 */
contract SwapCurveAction is IAction, Ownable {
    using SafeERC20 for IERC20;

    IAddressProvider address_provider;

    constructor(address _address_provider) {
        // should be 0x0000000022D53366457F9d5E68Ec105046FC4383, per https://curve.readthedocs.io/registry-address-provider.html
        address_provider = IAddressProvider(address_provider);
    }

    function _getRegistry() internal view returns (address) {
        return address_provider.get_address(0);
    }

    function _getSwapper() internal view returns (address) {
        return address_provider.get_address(2);
    }

    function validate(Action calldata action) external view returns (bool) {
        address poolAddr = abi.decode(action.data, (address));
        IRegistry registry = IRegistry(_getRegistry());

        // TODO: reverts if poolAddr does not match in/out tokens
        (int128 i, int128 j, bool exchange_underlying) = registry.get_coin_indices(
            poolAddr,
            action.inputToken,
            action.outputToken
        );

        return true;
    }

    function perform(Action calldata action, ActionRuntimeParams calldata runtimeParams)
        external
        payable
        returns (uint256)
    {
        address poolAddr = abi.decode(action.data, (address));
        ISwapper swapper = ISwapper(_getSwapper());
        uint256 amountOut = swapper.exchange(
            poolAddr,
            action.inputToken,
            action.outputToken,
            runtimeParams.totalCollateralAmount,
            (runtimeParams.triggerData * runtimeParams.totalCollateralAmount) / 10**8,
            msg.sender
        );

        return amountOut;
    }
}
