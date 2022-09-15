// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "../Constants.sol";
import "./TokenTypes.sol";

library TokenLib {
    using SafeERC20 for IERC20;

    function equals(Token memory t1, Token memory t2) public pure returns (bool) {
        return (t1.t == t2.t && t1.addr == t2.addr);
    }

    function approve(
        Token memory token,
        address to,
        uint256 amount
    ) public returns (uint256 ethCollateral) {
        if (token.t == TokenType.ERC20) {
            SafeERC20.safeIncreaseAllowance(IERC20(token.addr), to, amount);
        } else if (token.t == TokenType.NATIVE) {
            ethCollateral = amount;
        } else if (token.t == TokenType.ERC721) {
            IERC721(token.addr).approve(to, amount);
        } else {
            revert(Constants.TOKEN_TYPE_NOT_RECOGNIZED);
        }
    }

    function send(
        Token memory token,
        address receiver,
        uint256 balance
    ) public {
        if (token.t == TokenType.ERC20) {
            IERC20(token.addr).safeTransfer(receiver, balance);
        } else if (token.t == TokenType.NATIVE) {
            payable(receiver).transfer(balance);
        } else if (token.t == TokenType.ERC721) {
            IERC721(token.addr).safeTransferFrom(address(this), receiver, balance);
        } else {
            revert("Wrong token type!");
        }
    }

    function take(
        Token memory token,
        address sender,
        uint256 amount
    ) public {
        if (token.t == TokenType.ERC20) {
            IERC20(token.addr).safeTransferFrom(sender, address(this), amount);
        } else if (token.t == TokenType.ERC721) {
            IERC721(token.addr).safeTransferFrom(sender, address(this), amount);
        } else if (token.t != TokenType.NATIVE) {
            revert("Wrong token type!");
        }
    }
}